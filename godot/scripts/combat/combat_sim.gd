class_name CombatSim
extends Node3D
## Small infantry fight for the close battle: two squads (player = NATO, enemy = Russia) advancing on each other,
## line of sight over the real relief, rifle bursts, mortar rounds, casualties, mouse orders and a HUD.
## Stand-in until the strategy game's tactical simulation drives the units (docs/BATALHA_GODOT.md, D2).

const PER_SQUAD := 8
const MORTAR_COOLDOWN := 30.0
const MORTAR_ROUNDS := 6
const MORTAR_RADIUS := 12.0

var terrain: Terrain3D
var fx: CombatFx
var rig: CameraRig
var squads: Array[Squad] = []
var selected: Squad
var time := 0.0                    # simulation seconds (used by the AI for memory and timers)
var mortars := [MORTAR_ROUNDS, MORTAR_ROUNDS]
var _next_mortar := [8.0, 8.0]
var _hud_t := 0.0
var _hud: Label
var _ring: MeshInstance3D
var started := false
var cover := CoverMap.new()
var tanks: Array[Tank] = []
var air: Array[Aircraft] = []
var events: Array[String] = []
var _next_heli := [25.0, 40.0]
var _next_jet := [50.0, 70.0]
# turn that puts each model's nose on +Z
var yaw_fix := {"attack_heli": 0.0, "fighter_f16": 0.0, "fighter_su35": 0.0}


func setup(t: Terrain3D, camera_rig: CameraRig, start: Vector3, toward: Vector3, world := {}, trees: TreeField = null) -> void:
	cover.build(world, trees, start.lerp(toward, 0.5), 450.0)
	print("COVER trees ", cover.trees, " houses ", cover._houses.size())
	terrain = t
	rig = camera_rig
	fx = CombatFx.new()
	add_child(fx)
	fx.camera = rig.cam
	var dir := (toward - start)
	dir.y = 0
	dir = dir.normalized()
	var enemy_pos := start + dir * 220.0
	enemy_pos.y = terrain.data.get_height(enemy_pos)
	squads.append(_spawn(0, "1º Pelotão OTAN", "res://assets/soldiers/nsoldier.glb", start - dir * 10.0, dir))
	squads.append(_spawn(1, "Pelotão russo", "res://assets/soldiers/nsoldier_ru.glb", enemy_pos, -dir))
	selected = squads[0]
	for i in 2:
		var tk := Tank.new()
		add_child(tk)
		tk.setup(i, self)
		var f: Vector3 = dir if i == 0 else -dir
		var at: Vector3 = (start if i == 0 else enemy_pos) + f.cross(Vector3.UP) * 24.0 - f * 10.0
		at.y = terrain.data.get_height(at)
		tk.global_position = at
		tk.rotation.y = atan2(f.x, f.z)
		tanks.append(tk)
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
	squads[0].order_move(squads[1].centre().lerp(squads[0].centre(), 0.45), true, false)
	squads[1].order_move(squads[0].centre().lerp(squads[1].centre(), 0.55), true, false)


func _spawn(side: int, label: String, model: String, at: Vector3, facing: Vector3) -> Squad:
	var s := Squad.new()
	s.side = side
	s.name = label
	s.sim = self
	s.home = at
	var right := facing.cross(Vector3.UP).normalized()
	for i in PER_SQUAD:
		var u := Soldier.new()
		add_child(u)
		u.squad = s
		u.setup(model, side, terrain, fx)
		u.team = i % 2
		u.role = Soldier.Role.LEADER if i == 0 else (Soldier.Role.GUNNER if i == 1 else Soldier.Role.RIFLE)
		u.courage = randf_range(0.7, 1.0)
		u.morale = u.courage
		var p := at + right * ((i - (PER_SQUAD - 1) * 0.5) * 4.0) + facing * randf_range(-2.0, 2.0)
		p.y = terrain.data.get_height(p)
		u.global_position = p
		u.rotation.y = atan2(facing.x, facing.z)
		if i == 2 or i == 3:
			u.rockets = 2
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
	if cover.house_between(a, b) and a.y < terrain.data.get_height(a) + 6.0:
		return false
	for k in range(1, 16):
		var p := a.lerp(b, k / 16.0)
		var h := terrain.data.get_height(p)
		if not is_nan(h) and h > p.y:
			return false
	return true


func on_casualty(_s: Squad) -> void:
	_update_hud()


## Where the enemy probably is (a squad that knows nothing walks towards the other side's centre): INF if none.
func enemy_guess(side: int) -> Vector3:
	var c := Vector3.ZERO
	var n := 0
	for s in squads:
		if s.side != side and not s.alive().is_empty():
			c += s.centre()
			n += 1
	return c / n if n > 0 else Vector3.INF


func log_event(t: String) -> void:
	events.append("%.0f s: %s" % [time, t])
	print("EVENTO ", events[-1])


## Damage to men around a burst (cover halves it).
func blast(p: Vector3, radius: float, power: float) -> void:
	for sq in squads:
		for m in sq.alive():
			var d := m.global_position.distance_to(p)
			if d < radius:
				var k := 1.0 - d / radius
				if m.stance == Soldier.Stance.PRONE:
					k *= 0.7
				if cover.score(m.global_position, p - m.global_position) > 0.0:
					k *= 0.4
				var dir := (m.global_position - p + Vector3(0.0, 0.6, 0.0)).normalized()
				m.hit(power * k, dir * (k * 400.0), true)


## Tank cannon: against armour a direct hit or miss, against men a high-explosive burst.
func shell(from: Tank, muzzle: Vector3, aim: Vector3, foe: Tank) -> void:
	var p := aim + Vector3(randf_range(-4, 4), 0, randf_range(-4, 4))
	var hit_armour := foe != null and randf() < 0.5
	if hit_armour:
		p = foe.global_position
	p.y = terrain.data.get_height(p)
	fx._tracer(muzzle, p + Vector3(0, 1.0, 0))
	get_tree().create_timer(muzzle.distance_to(p) / 500.0 + 0.15).timeout.connect(func():
		fx.explosion(p + Vector3(0, 1.2 if hit_armour else 0.0, 0), 1.2)
		if hit_armour:
			foe.damage(randf_range(35.0, 55.0))
		blast(p, 8.0, 110.0))


## The anti-tank man fires at enemy armour or a hovering helicopter in range and in sight.
func fire_rocket(u: Soldier) -> bool:
	if time < 15.0 or randf() > 0.15:             # takes a moment to get the launcher on target
		return false
	var target: Node3D = null
	for t in tanks:
		if t.side != u.side and t.alive() and u.global_position.distance_to(t.global_position) < 230.0:
			target = t
	for a in air:
		if is_instance_valid(a) and a.side != u.side and not a.jet and a.flying() and u.global_position.distance_to(a.global_position) < 230.0:
			target = a
	if target == null or not line_of_sight(u.eye() + Vector3(0, 0.5, 0), target.global_position + Vector3(0, 2.0, 0)):
		return false
	var from := u.eye()
	var to := target.global_position + Vector3(0, 1.5, 0)
	fx._flash(from)
	fx._tracer(from, to)
	var chance := 0.65 if target is Tank else 0.35
	var delay := from.distance_to(to) / 150.0
	get_tree().create_timer(delay).timeout.connect(func():
		if not is_instance_valid(target):
			return
		if randf() < chance:
			fx.explosion(target.global_position + Vector3(0, 1.5, 0), 1.1)
			target.damage(randf_range(40.0, 65.0))
		else:
			var q := to + Vector3(randf_range(-8, 8), 0, randf_range(-8, 8))
			q.y = terrain.data.get_height(q)
			fx.explosion(q, 0.7))
	return true


## What a helicopter shoots at: enemy tank, else the enemy infantry.
func air_target(side: int) -> Vector3:
	for t in tanks:
		if t.side != side and t.alive():
			return t.global_position
	for s in squads:
		if s.side != side and not s.alive().is_empty():
			return s.alive().pick_random().global_position
	return Vector3.INF


func air_rocket(from: Aircraft, muzzle: Vector3, aim: Vector3) -> void:
	var p := aim + Vector3(randf_range(-7, 7), 0, randf_range(-7, 7))
	p.y = terrain.data.get_height(p)
	fx._tracer(muzzle, p)
	get_tree().create_timer(muzzle.distance_to(p) / 200.0).timeout.connect(func():
		fx.explosion(p, 1.1)
		for t in tanks:
			if t.side != from.side and t.alive() and t.global_position.distance_to(p) < 7.0:
				t.damage(randf_range(25.0, 45.0))
		blast(p, 8.0, 90.0))


func bomb(p: Vector3) -> void:
	fx.explosion(p, 3.0)
	for t in tanks:
		if t.alive() and t.global_position.distance_to(p) < 14.0:
			t.damage(100.0)
	blast(p, 20.0, 160.0)
	log_event("bomba")


## Sorties, and rifle / machine-gun fire at helicopters.
func _air_war() -> void:
	air = air.filter(func(a): return is_instance_valid(a))
	for side in 2:
		var own := squads[side]
		var foe := squads[1 - side]
		if own.alive().is_empty() or foe.alive().is_empty():
			continue
		var back := own.home - foe.home
		back.y = 0
		if time >= _next_heli[side]:
			_next_heli[side] = time + 75.0
			_launch(side, false, foe.centre(), back)
		if time >= _next_jet[side]:
			_next_jet[side] = time + 60.0
			var d := own.centre().distance_to(foe.centre())
			if d > 60.0:                              # not on top of the own men
				_launch(side, true, foe.centre(), back)


func _launch(side: int, jet: bool, target: Vector3, from: Vector3) -> void:
	var a := Aircraft.new()
	add_child(a)
	a.setup(side, self, jet, target, from)
	air.append(a)
	log_event("%s da %s" % ["caça" if jet else "helicóptero", "OTAN" if side == 0 else "Rússia"])


## A squad asks for mortar fire on a spot: refused if no rounds, in cooldown, or own men are within 40 m of it.
func request_fire(squad: Squad, pos: Vector3) -> bool:
	var side := squad.side
	if mortars[side] <= 0 or time < _next_mortar[side]:
		return false
	for m in squad.alive():
		if m.global_position.distance_to(pos) < 40.0:
			return false
	mortars[side] -= 1
	_next_mortar[side] = time + MORTAR_COOLDOWN
	var p := pos + Vector3(randf_range(-12, 12), 0, randf_range(-12, 12))
	p.y = terrain.data.get_height(p)
	get_tree().create_timer(4.0).timeout.connect(_impact.bind(p))     # flight time
	return true


func _physics_process(dt: float) -> void:
	if not started:
		return
	time += dt
	for sq in squads:
		sq.think(dt)
	_air_war()
	for a in air:
		if not is_instance_valid(a) or a.jet or not a.flying():
			continue
		for e in enemies_of(a.side):
			if e.global_position.distance_to(a.global_position) < 250.0 and randf() < dt * 0.04:
				fx._tracer(e.eye(), a.global_position)
				a.damage(randf_range(4.0, 12.0))
	_hud_t -= dt
	if _hud_t <= 0.0:
		_hud_t = 1.0
		_update_hud()
	if selected:
		_ring.visible = not selected.alive().is_empty()
		var c := selected.centre()
		_ring.global_position = c + Vector3(0, 0.3, 0)


func _impact(p: Vector3) -> void:
	fx.explosion(p, 1.0)
	for t in tanks:
		if t.alive() and t.global_position.distance_to(p) < 5.0:
			t.damage(35.0)
	blast(p, MORTAR_RADIUS, 140.0)
	cover.add(p, 2.0, 0.5)                          # the crater


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and e.keycode == KEY_G and selected:
		selected.release()
		return
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
		t += "%s: %d/%d · %s · moral %d%%\n" % [s.name, s.alive().size(), s.members.size(), Squad.MODE_NAMES[s.mode], int(s.average("morale") * 100.0)]
	t += "Clique: selecionar · Botão direito: mover (Shift = andando) · G: devolver à IA · WASD/roda: câmera"
	_hud.text = t
