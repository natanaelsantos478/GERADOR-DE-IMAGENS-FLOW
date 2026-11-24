class_name CombatSim
extends Node3D
## Small infantry fight for the close battle: two squads (player = NATO, enemy = Russia) advancing on each other,
## line of sight over the real relief, rifle bursts, mortar rounds, casualties, mouse orders and a HUD.
## Stand-in until the strategy game's tactical simulation drives the units (docs/BATALHA_GODOT.md, D2).

const PER_SQUAD := 8
const MORTAR_EVERY := Vector2(10.0, 20.0)
const MORTAR_RADIUS := 12.0

var terrain: Terrain3D
var fx: CombatFx
var rig: CameraRig
var squads: Array[Squad] = []
var selected: Squad
var _mortar_t := 6.0
var _hud: Label
var _ring: MeshInstance3D
var started := false


func setup(t: Terrain3D, camera_rig: CameraRig, start: Vector3, toward: Vector3) -> void:
	terrain = t
	rig = camera_rig
	fx = CombatFx.new()
	add_child(fx)
	fx.camera = rig.cam
	var dir := (toward - start)
	dir.y = 0
	dir = dir.normalized()
	var enemy_pos := start + dir * 300.0
	enemy_pos.y = terrain.data.get_height(enemy_pos)
	squads.append(_spawn(0, "1º Pelotão OTAN", "res://assets/soldiers/nsoldier.glb", start - dir * 10.0, dir))
	squads.append(_spawn(1, "Pelotão russo", "res://assets/soldiers/nsoldier_ru.glb", enemy_pos, -dir))
	selected = squads[0]
	_build_hud()
	_ring = MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 13.0
	tm.outer_radius = 14.0
	_ring.mesh = tm
	var rm := StandardMaterial3D.new()
	rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rm.albedo_color = Color(0.3, 1.0, 0.4, 0.6)
	rm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_ring.material_override = rm
	_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_ring)


func start() -> void:
	started = true
	# both advance towards each other; they stop and fight when they see the enemy
	squads[0].order_move(squads[1].centre().lerp(squads[0].centre(), 0.45), true)
	squads[1].order_move(squads[0].centre().lerp(squads[1].centre(), 0.55), true)


func _spawn(side: int, label: String, model: String, at: Vector3, facing: Vector3) -> Squad:
	var s := Squad.new()
	s.side = side
	s.name = label
	s.sim = self
	var right := facing.cross(Vector3.UP).normalized()
	for i in PER_SQUAD:
		var u := Soldier.new()
		add_child(u)
		u.squad = s
		u.setup(model, side, terrain, fx)
		var p := at + right * ((i - (PER_SQUAD - 1) * 0.5) * 4.0) + facing * randf_range(-2.0, 2.0)
		p.y = terrain.data.get_height(p)
		u.global_position = p
		u.rotation.y = atan2(facing.x, facing.z)
		s.members.append(u)
	return s


func enemies_of(side: int) -> Array[Soldier]:
	var out: Array[Soldier] = []
	for s in squads:
		if s.side != side:
			out.append_array(s.alive())
	return out


## Line of sight over the relief (16 samples between the two eyes).
func line_of_sight(a: Vector3, b: Vector3) -> bool:
	for k in range(1, 16):
		var p := a.lerp(b, k / 16.0)
		var h := terrain.data.get_height(p)
		if not is_nan(h) and h > p.y:
			return false
	return true


func on_casualty(_s: Squad) -> void:
	_update_hud()


func _physics_process(dt: float) -> void:
	if not started:
		return
	_mortar_t -= dt
	if _mortar_t <= 0.0:
		_mortar_t = randf_range(MORTAR_EVERY.x, MORTAR_EVERY.y)
		var firing := squads[randi() % 2]
		var targets := enemies_of(firing.side)
		if not targets.is_empty():
			var t: Soldier = targets[randi() % targets.size()]
			var p := t.global_position + Vector3(randf_range(-25, 25), 0, randf_range(-25, 25))
			p.y = terrain.data.get_height(p)
			# flight time ~4 s
			get_tree().create_timer(4.0).timeout.connect(_impact.bind(p))
	if selected:
		_ring.visible = not selected.alive().is_empty()
		var c := selected.centre()
		_ring.global_position = c + Vector3(0, 0.3, 0)


func _impact(p: Vector3) -> void:
	fx.explosion(p, 1.0)
	for s in squads:
		for m in s.alive():
			var d := m.global_position.distance_to(p)
			if d < MORTAR_RADIUS:
				m.hit(140.0 * (1.0 - d / MORTAR_RADIUS))


func _unhandled_input(e: InputEvent) -> void:
	if not (e is InputEventMouseButton and e.pressed):
		return
	var hitp = _ground_under_mouse(e.position)
	if hitp == null:
		return
	if e.button_index == MOUSE_BUTTON_LEFT:
		for s in squads:
			if s.side == 0 and s.centre().distance_to(hitp) < 25.0:
				selected = s
	elif e.button_index == MOUSE_BUTTON_RIGHT and selected:
		selected.order_move(hitp, not Input.is_key_pressed(KEY_SHIFT))


## Ray-march from the camera over the relief.
func _ground_under_mouse(mp: Vector2):
	var cam := rig.cam
	var o := cam.project_ray_origin(mp)
	var d := cam.project_ray_normal(mp)
	var t := 0.0
	while t < 6000.0:
		var p := o + d * t
		var h := terrain.data.get_height(p)
		if not is_nan(h) and p.y <= h:
			return Vector3(p.x, h, p.z)
		t += maxf(1.0, t * 0.01)
	return null


func _build_hud() -> void:
	var cl := CanvasLayer.new()
	add_child(cl)
	_hud = Label.new()
	_hud.position = Vector2(16, 12)
	_hud.add_theme_font_size_override("font_size", 18)
	_hud.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	_hud.add_theme_constant_override("outline_size", 5)
	cl.add_child(_hud)
	_update_hud()


func _update_hud() -> void:
	if _hud == null:
		return
	var t := ""
	for s in squads:
		t += "%s: %d/%d\n" % [s.name, s.alive().size(), s.members.size()]
	t += "Clique: selecionar · Botão direito: mover (Shift = andando) · WASD/roda: câmera"
	_hud.text = t
