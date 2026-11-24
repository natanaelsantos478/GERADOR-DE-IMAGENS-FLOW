extends Node3D
## Close battle: reads the battle pack and builds the field from scratch behind a loading screen.
## Usage: Godot --path godot -- --battle <pack dir> [--shots <dir>]
## Without --battle it opens the test pack res://packs/ardennes.


var pack: BattlePack
var terrain: Terrain3D
var rig: CameraRig
var grass: GrassField
var _shots_dir := ""
var _start := Vector3.ZERO
var _bridge_spot := []
var combat: CombatSim
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
		# bridges first: their embankments change the terrain that roads and houses sit on
		var bridges := BridgeField.new()
		add_child(bridges)
		bridges.plan(world, terrain)
		var roads := RoadField.new()
		add_child(roads)
		roads.build_all(world, terrain)
		var bmat := ShaderMaterial.new()
		bmat.shader = load("res://shaders/building.gdshader")
		bmat.set_shader_parameter("alb", load("res://assets/buildings/building_alb.png"))
		bmat.set_shader_parameter("nrm", load("res://assets/buildings/building_nrm.png"))
		var rmat := ShaderMaterial.new()
		rmat.shader = load("res://shaders/road.gdshader")
		rmat.set_shader_parameter("alb", load("res://assets/buildings/road_alb.png"))
		rmat.set_shader_parameter("nrm", load("res://assets/buildings/road_nrm.png"))
		bridges.build(bmat, rmat)
		_bridge_spot = bridges.view_spot()
		var bld := BuildingField.new()
		add_child(bld)
		bld.build_all(world, terrain)
		var signs := SignField.new()
		add_child(signs)
		signs.build_all(world, terrain)
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
	combat = CombatSim.new()
	add_child(combat)
	combat.setup(terrain, rig, _start, _start + _open_direction(_start) * 300.0)

	await _step(ls, "Preparando gráficos", 0.95)
	for i in 30:
		await get_tree().process_frame
	times.total = Time.get_ticks_msec() - t0
	print("LOAD ms ", times)
	ls.queue_free()
	combat.start()
	if _shots_dir != "":
		_take_shots()


## Direction from p with the most open meadow over 300 m (where the two squads meet).
func _open_direction(p: Vector3) -> Vector3:
	var best := Vector3.FORWARD
	var bs := -INF
	for k in 16:
		var a := k * TAU / 16.0
		var d := Vector3(sin(a), 0, -cos(a))
		var s := 0.0
		for i in range(1, 16):
			var q := p + d * i * 20.0
			var c := pack.landcover.get_pixelv(pack.map_px(pack.landcover, q.x, q.z))
			var cls := int(round(c.r * 255.0))
			s += 1.0 if cls == BattlePack.LandCover.MEADOW else (-2.0 if cls in [BattlePack.LandCover.ROAD, BattlePack.LandCover.ROOF, BattlePack.LandCover.BUILT_UP] else 0.0)
		if s > bs:
			bs = s
			best = d
	return best


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
				elif cls == BattlePack.LandCover.BUILT_UP or cls == BattlePack.LandCover.ROOF or cls == BattlePack.LandCover.ROAD:
					paved += 1.0
				elif cls == BattlePack.LandCover.BROADLEAF or cls == BattlePack.LandCover.CONIFER:
					wood += 1.0
			var score := meadow - 3.0 * paved + minf(wood, 12.0) * 0.6 - p.length() * 0.0005
			if score > best_score:
				best_score = score
				best = p
	best.y = terrain.data.get_height(best)
	return best


func _take_shots() -> void:
	DirAccess.make_dir_recursive_absolute(_shots_dir)
	var vp := get_viewport().get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(vp, true)
	var town := Vector3(0, 0, 0)
	town.y = terrain.data.get_height(town)
	var views := [["01_chao", _start, 35.0, 9.0, 0.05], ["02_perto", _start, 35.0, 30.0, 0.0], ["03_medio", _start, 120.0, 180.0, 0.0],
		["04_alto", _start, 200.0, 1200.0, 0.0], ["05_rua", town, 60.0, 14.0, 0.05], ["06_cidade", town, 150.0, 350.0, 0.0]]
	if not _bridge_spot.is_empty():
		views.append(["08_ponte", _bridge_spot[0], 70.0, 45.0, 0.0])
		views.append(["09_ponte_baixo", _bridge_spot[0], 160.0, 14.0, -0.08])
	# a street corner with paint, a crossing and signs
	for n in pack.load_world().get("nodes", []):
		if n.k == "zebra":
			var q := Vector3(n.p[0], 0, n.p[1])
			q.y = terrain.data.get_height(q)
			views.append(["07_cruzamento", q, 30.0, 16.0, 0.08])
			break
	# the fight first: close to the NATO squad, then from the side between the lines, then over the enemy
	var only_combat: bool = _args().get("views", "") == "combat"
	var c0 := combat.squads[0].centre()
	var c1 := combat.squads[1].centre()
	var yaw := rad_to_deg(atan2(-(c1 - c0).x, -(c1 - c0).z))
	var mid := c0.lerp(c1, 0.5)
	var combat_views := [["10_combate", c0, yaw, 16.0, 0.02, 360], ["11_tiroteio", mid, yaw + 90.0, 70.0, 0.0, 300],
		["12_morteiro", c1, yaw + 180.0, 45.0, 0.0, 300],
		["13_mira", c0, yaw, 7.0, 0.12, 120], ["14_caidos", c0, yaw + 40.0, 9.0, 0.3, 60]]
	var only_rag: bool = _args().get("views", "") == "ragdoll"
	var only_ai: bool = _args().get("views", "") == "ai"
	views = [] if (only_rag or only_ai) else (combat_views if only_combat else combat_views + views)
	for v in views:
		if v[0] == "11_tiroteio":
			v[1] = combat.squads[0].centre().lerp(combat.squads[1].centre(), 0.5)
		elif v[0] == "12_morteiro":
			v[1] = combat.squads[1].centre()
		elif v[0] == "13_mira":
			v[1] = combat.squads[0].centre()
		elif v[0] == "14_caidos":
			# the first fallen soldier of either squad (ragdoll check); the centre of the NATO squad if nobody fell
			var spot: Vector3 = combat.squads[0].centre()
			for sq in combat.squads:
				for m in sq.members:
					if not m.alive():
						spot = m.global_position
						break
			v[1] = spot
		rig.place(v[1], v[2], v[3], v[4])
		for i in (v[5] if v.size() > 5 else 90):
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
	if only_rag or _args().get("views", "") == "combat":
		await _ragdoll_test()
	if only_ai:
		await _ai_test()
	get_tree().quit()


## Ragdoll check: a mortar shell lands 3 m beside the NATO squad; pictures right after, at 1.2 s and at 3.5 s, and a report
## of how many physical bodies each fallen soldier got and how far they moved (a body with 0 bodies just freezes).
func _ragdoll_test() -> void:
	var sq = combat.squads[0]
	var mem: Array = sq.alive()
	var centre: Vector3 = sq.centre()
	var impact := centre + Vector3(3.0, 0.0, 0.0)
	impact.y = terrain.data.get_height(impact)
	rig.place(centre, 90.0, 16.0, 0.25)
	for i in 30:
		await get_tree().process_frame
	combat._impact(impact)
	var t0 := Time.get_ticks_msec()
	var start := {}
	for mk in [["15_ragdoll_a", 0.25], ["15_ragdoll_b", 1.2], ["15_ragdoll_c", 3.5]]:
		while (Time.get_ticks_msec() - t0) / 1000.0 < mk[1]:
			await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png(_shots_dir.path_join("%s.png" % mk[0]))
		for m in mem:
			if m.alive():
				continue
			var pelvis = m._skeleton.find_child("PB_pelvis", true, false) if m._skeleton else null
			if pelvis == null:
				continue
			if not start.has(m):
				start[m] = pelvis.global_position
			print("RAGDOLL %s t=%.2f soldier %d pelvis %.2f %.2f %.2f moved %.2f m" % [mk[0], mk[1], m.get_instance_id() % 1000, pelvis.global_position.x - impact.x, pelvis.global_position.y - impact.y, pelvis.global_position.z - impact.z, pelvis.global_position.distance_to(start[m])])
	var dead := 0
	for m in mem:
		if not m.alive():
			dead += 1
			print("RAGDOLL bodies for soldier %d: %d" % [m.get_instance_id() % 1000, m._skeleton.find_children("PB_*", "PhysicalBone3D", true, false).size() if m._skeleton else -1])
	print("RAGDOLL dead %d of %d" % [dead, mem.size()])


## AI check (`--views ai`): the two squads fight by themselves, sped up. Prints a status line every 10 s of simulation
## (mode, losses, morale, tasks, contacts, distance) and a summary; takes a picture the first time each tactic shows up.
func _ai_test() -> void:
	seed(20260524)
	Engine.time_scale = 3.0
	var snaps := {}
	var t0: float = combat.time
	var closest := 1e9
	var first_contact := -1.0
	var first_loss := -1.0
	var last_print := -99.0
	var limit := 240.0
	# --dist N: start the fight with the squads N metres apart (tests the close tactics: flank, assault)
	var dist_arg := float(_args().get("dist", 0.0))
	if dist_arg > 0.0:
		var a0: Squad = combat.squads[0]
		var b0: Squad = combat.squads[1]
		var dir0 := b0.centre() - a0.centre()
		dir0.y = 0.0
		var shift := dir0.length() - dist_arg
		dir0 = dir0.normalized()
		for m in b0.members:
			var p0 := m.global_position - dir0 * shift
			p0.y = terrain.data.get_height(p0)
			m.global_position = p0
	while combat.time - t0 < limit:
		await get_tree().process_frame
		var a: Squad = combat.squads[0]
		var b: Squad = combat.squads[1]
		if a.alive().is_empty() or b.alive().is_empty():
			break
		var dist := a.centre().distance_to(b.centre())
		closest = minf(closest, dist)
		var t: float = combat.time - t0
		if first_contact < 0.0 and (a.has_contact() or b.has_contact()):
			first_contact = t
		if first_loss < 0.0 and (a.alive().size() < a.members.size() or b.alive().size() < b.members.size()):
			first_loss = t
		if t - last_print >= 10.0:
			last_print = t
			var line := "AI t=%3.0f dist=%4.0f" % [t, dist]
			for s: Squad in [a, b]:
				var tasks := {}
				var cover := 0
				var ammo := 0
				for m in s.alive():
					tasks[Soldier.Task.keys()[m.task]] = int(tasks.get(Soldier.Task.keys()[m.task], 0)) + 1
					cover += 1 if m.in_cover else 0
					ammo += m.mag + m.reserve
				line += " | %s %d/%d %s moral %.2f cob %d mun %d %s" % [("OTAN" if s.side == 0 else "RUS"), s.alive().size(), s.members.size(), Squad.MODE_NAMES[s.mode], s.average("morale"), cover, ammo, str(tasks)]
			print(line)
		# one picture the first time each tactic appears
		for s: Squad in [a, b]:
			var bounding := false
			var watching := false
			for m in s.alive():
				bounding = bounding or m.task == Soldier.Task.BOUND
				watching = watching or m.task == Soldier.Task.OVERWATCH
			var ev := ""
			if bounding and watching and t > 9.0 and not snaps.has("bounds"):
				ev = "bounds"
			elif s.mode == Squad.Mode.FLANK and not snaps.has("flank"):
				ev = "flank"
			elif s.mode == Squad.Mode.WITHDRAW and not snaps.has("withdraw"):
				ev = "withdraw"
			if ev != "":
				snaps[ev] = true
				var other: Squad = b if s == a else a
				var yaw := rad_to_deg(atan2(-(other.centre() - s.centre()).x, -(other.centre() - s.centre()).z))
				rig.place(s.centre(), yaw + 90.0, 30.0, 0.25)
				for i in 20:
					await get_tree().process_frame
				get_viewport().get_texture().get_image().save_png(_shots_dir.path_join("20_%s.png" % ev))
				print("AI foto 20_%s t=%.0f squad=%s" % [ev, t, s.name])
	Engine.time_scale = 1.0
	var a2: Squad = combat.squads[0]
	var b2: Squad = combat.squads[1]
	var focus: Squad = a2 if not a2.alive().is_empty() else b2
	rig.place(focus.centre(), 90.0, 28.0, 0.3)
	for i in 30:
		await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png(_shots_dir.path_join("20_fim.png"))
	print("AI RESUMO duração=%.0f s primeiro contato=%.0f s primeira baixa=%.0f s menor distância=%.0f m" % [combat.time - t0, first_contact, first_loss, closest])
	for s: Squad in [a2, b2]:
		print("AI RESUMO %s vivos %d/%d moral %.2f modos %s stats %s" % [s.name, s.alive().size(), s.members.size(), s.average("morale"), str(s.modes_seen.keys()), str(s.stats)])
	print("AI RESUMO morteiros restantes %s animações ausentes %s" % [str(combat.mortars), str(Soldier.missing.keys())])
