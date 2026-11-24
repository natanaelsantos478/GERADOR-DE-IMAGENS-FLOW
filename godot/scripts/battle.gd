extends Node3D
## Close battle: reads the battle pack and builds the field from scratch behind a loading screen.
## Usage: Godot --path godot -- --battle <pack dir> [--shots <dir>]
## Without --battle it opens the test pack res://packs/ardennes.

const SOLDIERS := ["nsoldier", "nsoldier_ru", "nsoldier_des", "nsoldier_urb"]

var pack: BattlePack
var terrain: Terrain3D
var rig: CameraRig
var grass: GrassField
var _shots_dir := ""
var _start := Vector3.ZERO
var _debug_flags: PackedStringArray = []  # --off grass,msaa,ssao,shadow,fog : profiling only


func _ready() -> void:
	var args := _args()
	var dir: String = args.get("battle", ProjectSettings.globalize_path("res://packs/ardennes"))
	_shots_dir = args.get("shots", "")
	_debug_flags = String(args.get("off", "")).split(",", false)
	if _debug_flags.has("msaa"):
		get_viewport().msaa_3d = Viewport.MSAA_DISABLED
	pack = BattlePack.open(dir)
	if pack == null:
		get_tree().quit(1)
		return
	var ls := LoadingScreen.new(pack.meta.get("name", "Batalha"))
	add_child(ls)
	var t0 := Time.get_ticks_msec()
	var times := {}

	await _step(ls, "Lendo relevo e mapas", 0.05)
	pack.load_height()
	pack.load_maps()
	times.read = Time.get_ticks_msec() - t0

	await _step(ls, "Céu, sol e atmosfera", 0.15)
	var eb := EnvironmentBuilder.new()
	eb.build(self, pack)
	var env := eb.world_env.environment
	env.ssao_enabled = env.ssao_enabled and not _debug_flags.has("ssao")
	env.fog_enabled = env.fog_enabled and not _debug_flags.has("fog")
	eb.sun.shadow_enabled = not _debug_flags.has("shadow")

	await _step(ls, "Construindo o terreno", 0.25)
	var tb := TerrainBuilder.new()
	terrain = tb.create(self)
	tb.import_pack(pack)
	await _step(ls, "Materiais do solo", 0.55)
	tb.set_textures()
	times.terrain = Time.get_ticks_msec() - t0

	rig = CameraRig.new()
	rig.terrain = terrain
	rig.limit = pack.size_m * 0.5
	add_child(rig)
	terrain.set_camera(rig.cam)
	_start = _find_start()
	rig.place(_start, 35.0, 28.0)

	await _step(ls, "Estradas e construções", 0.62)
	var world := pack.load_world()
	if not _debug_flags.has("city"):
		var roads := RoadField.new()
		add_child(roads)
		roads.build_all(world, terrain)
		var bld := BuildingField.new()
		add_child(bld)
		bld.build_all(world, terrain)
	times.city = Time.get_ticks_msec() - t0

	await _step(ls, "Vegetação", 0.7)
	grass = GrassField.new()
	add_child(grass)
	grass.setup(pack, terrain, rig)
	if _debug_flags.has("grass"):
		grass.queue_free()
	else:
		grass.build_all()
	times.grass = Time.get_ticks_msec() - t0

	await _step(ls, "Matas e árvores", 0.78)
	var trees := TreeField.new()
	add_child(trees)
	trees.setup(pack, terrain, rig)
	if not _debug_flags.has("trees"):
		trees.plant_all()
		trees.build_near_now()
	times.trees = Time.get_ticks_msec() - t0

	await _step(ls, "Tropas", 0.85)
	_place_soldiers(_start)

	await _step(ls, "Preparando gráficos", 0.95)
	for i in 30:
		await get_tree().process_frame
	times.total = Time.get_ticks_msec() - t0
	print("LOAD ms ", times)
	ls.queue_free()
	if _shots_dir != "":
		_take_shots()


func _step(ls: LoadingScreen, text: String, p: float) -> void:
	ls.show_step(text, p)
	await get_tree().process_frame
	await get_tree().process_frame


func _args() -> Dictionary:
	var out := {}
	var a := OS.get_cmdline_user_args()
	for i in a.size():
		if a[i].begins_with("--") and i + 1 < a.size():
			out[a[i].substr(2)] = a[i + 1]
	return out


## Open countryside for the first view: meadow all around, no town (buildings only arrive in F3), woods in sight.
func _find_start() -> Vector3:
	var lc := pack.landcover
	var best := Vector3.ZERO
	var best_score := -INF
	for gz in range(-16, 17):
		for gx in range(-16, 17):
			var p := Vector3(gx * 280.0, 0, gz * 280.0)
			var meadow := 0.0
			var paved := 0.0
			var wood := 0.0
			for k in 64:
				var a := k * 2.39996
				var r := 25.0 + 12.0 * sqrt(k)
				var c := lc.get_pixelv(pack.map_px(lc, p.x + cos(a) * r, p.z + sin(a) * r))
				var cls := int(round(c.r * 255.0))
				if cls == BattlePack.LandCover.MEADOW:
					meadow += c.g
				elif cls == BattlePack.LandCover.PAVED or cls == BattlePack.LandCover.ROOF:
					paved += 1.0
				elif cls == BattlePack.LandCover.BROADLEAF or cls == BattlePack.LandCover.CONIFER:
					wood += 1.0
			var score := meadow - 3.0 * paved + minf(wood, 12.0) * 0.6 - p.length() * 0.0005
			if score > best_score:
				best_score = score
				best = p
	best.y = terrain.data.get_height(best)
	return best


func _place_soldiers(at: Vector3) -> void:
	# Godot drops the "_Loop" suffix of glTF clip names on import (and marks them looping)
	var poses := [["Idle", 0.0], ["Crouch_Idle", 0.3], ["Pistol_Aim_Neutral", 0.6], ["Walk", 0.1], ["Idle", 0.8], ["Jog_Fwd", 0.2]]
	for i in 6:
		var scene: PackedScene = load("res://assets/soldiers/%s.glb" % SOLDIERS[i % 2])
		var s := scene.instantiate() as Node3D
		add_child(s)
		var off := Vector3((i % 3) * 3.2 - 3.2, 0, (i / 3) * 4.0 - 2.0)
		var p := at + off
		p.y = terrain.data.get_height(p)
		s.global_position = p
		s.rotation.y = deg_to_rad(200.0 + i * 9.0)
		var ap := s.find_children("*", "AnimationPlayer", true, false)
		if ap.size() > 0:
			var player := ap[0] as AnimationPlayer
			var anim: String = poses[i][0]
			if player.has_animation(anim):
				player.get_animation(anim).loop_mode = Animation.LOOP_LINEAR
				player.play(anim)
				player.seek(poses[i][1] * player.current_animation_length, true)


func _take_shots() -> void:
	DirAccess.make_dir_recursive_absolute(_shots_dir)
	var vp := get_viewport().get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(vp, true)
	var town := Vector3(0, 0, 0)
	town.y = terrain.data.get_height(town)
	var views := [["01_chao", _start, 35.0, 9.0, 0.05], ["02_perto", _start, 35.0, 30.0, 0.0], ["03_medio", _start, 120.0, 180.0, 0.0],
		["04_alto", _start, 200.0, 1200.0, 0.0], ["05_rua", town, 60.0, 14.0, 0.05], ["06_cidade", town, 150.0, 350.0, 0.0]]
	for v in views:
		rig.place(v[1], v[2], v[3], v[4])
		for i in 90:
			await get_tree().process_frame
		var gpu := 0.0
		var cpu := 0.0
		var t := Time.get_ticks_usec()
		for i in 30:
			await get_tree().process_frame
			gpu += RenderingServer.viewport_get_measured_render_time_gpu(vp)
			cpu += RenderingServer.viewport_get_measured_render_time_cpu(vp)
		var frame_ms := (Time.get_ticks_usec() - t) / 30000.0
		var img := get_viewport().get_texture().get_image()
		img.save_png(_shots_dir.path_join("%s.png" % v[0]))
		print("SHOT %s frame %.1f ms gpu %.1f ms render-cpu %.1f ms draws %d prims %d" % [v[0], frame_ms, gpu / 30.0, cpu / 30.0,
			RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
			RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME)])
	get_tree().quit()
