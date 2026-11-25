class_name Aircraft
extends Node3D
## Helicopter (comes in, holds off, fires rockets, leaves; can be shot down and crashes) or jet (fast low pass that
## drops one bomb). One object per sortie; CombatSim launches them.

var side := 0
var sim: CombatSim
var jet := false
var hp := 100.0
var _dir := Vector3.FORWARD
var _station := Vector3.ZERO
var _target := Vector3.ZERO
var _t := 0.0
var _shots := 4
var _cool := 1.0
var _bombed := false
var _rotor: MeshInstance3D
var _fall := 0.0
var _wreck := false


func setup(s: int, world: CombatSim, is_jet: bool, target: Vector3, from_dir: Vector3) -> void:
	side = s
	sim = world
	jet = is_jet
	_target = target
	_dir = -from_dir.normalized()
	var tint := Color(0.3, 0.34, 0.3) if s == 0 else Color(0.26, 0.28, 0.2)
	if jet:
		add_child(WarModel.make("res://assets/vehicles/%s.glb" % ("fighter_f16" if s == 0 else "fighter_su35"), 17.0,
			sim.yaw_fix["fighter_f16" if s == 0 else "fighter_su35"], Color(0.4, 0.43, 0.47)))
		global_position = target - _dir * 900.0 + Vector3(0, 75, 0)
	else:
		var n := "attack_heli"
		add_child(WarModel.make("res://assets/vehicles/%s.glb" % n, 15.0, sim.yaw_fix[n], tint))
		_station = target - _dir * 170.0 + Vector3(0, 35, 0)
		global_position = _station - _dir * 600.0 + Vector3(0, 20, 0)
		_rotor = MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(13.0, 0.04, 0.35)
		_rotor.mesh = bm
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.05, 0.05, 0.05, 0.7)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_rotor.material_override = m
		add_child(_rotor)
		_rotor.position = Vector3(0, 4.3, 0)
	rotation.y = atan2(_dir.x, _dir.z)


func flying() -> bool:
	return hp > 0.0 and not _wreck


func _physics_process(dt: float) -> void:
	if _wreck:
		return
	_t += dt
	if _rotor:
		_rotor.rotation.y += dt * 31.0
	if jet:
		global_position += _dir * 130.0 * dt
		if not _bombed and (_target - global_position).dot(_dir) < 130.0:
			_bombed = true
			var p := _target + Vector3(randf_range(-10, 10), 0, randf_range(-10, 10))
			p.y = sim.terrain.data.get_height(p)
			get_tree().create_timer(1.2).timeout.connect(sim.bomb.bind(p))
		if _t > 16.0:
			queue_free()
		return
	if hp <= 0.0:                                   # shot down: spins and falls
		_fall += 9.0 * dt
		global_position += _dir * 6.0 * dt - Vector3(0, _fall * dt, 0)
		rotation.y += 5.0 * dt
		rotation.z = lerpf(rotation.z, 0.5, dt)
		var g := sim.terrain.data.get_height(global_position)
		if global_position.y <= g + 0.5:
			global_position.y = g
			_wreck = true
			sim.fx.explosion(global_position, 2.4)
			sim.blast(global_position, 14.0, 120.0)
			WarModel.paint(self, Color(0.035, 0.03, 0.028))
			WarModel.burn(self, sim.fx._soft, Vector3(0, 1.5, 0))
		return
	var leaving := _shots <= 0 or _t > 45.0
	var goal := _station - _dir * 900.0 + Vector3(0, 30, 0) if leaving else _station + Vector3(sin(_t * 0.5) * 12.0, sin(_t * 1.3) * 1.5, 0)
	var to := goal - global_position
	var speed := minf(38.0, to.length())
	global_position += to.normalized() * speed * dt
	var look := to if leaving else _target - global_position
	rotation.y = lerp_angle(rotation.y, atan2(look.x, look.z), dt * 1.5)
	rotation.x = lerpf(rotation.x, clampf(speed / 38.0, 0.0, 1.0) * 0.2, dt * 2.0)
	if leaving:
		if to.length() < 40.0:
			queue_free()
		return
	_cool -= dt
	if _cool <= 0.0 and to.length() < 25.0:
		_cool = 2.5
		_shots -= 1
		var aim := sim.air_target(side)
		if aim != Vector3.INF:
			_target = aim
			var muzzle := global_position + (aim - global_position).normalized() * 6.0
			sim.fx._flash(muzzle)
			sim.air_rocket(self, muzzle, aim)


func damage(d: float) -> void:
	if hp <= 0.0 or jet:
		return
	hp -= d
	if hp <= 0.0:
		sim.fx.explosion(global_position, 1.2)
		WarModel.burn(self, sim.fx._soft, Vector3(0, 2.5, 0))
		sim.log_event("helicóptero abatido (%s)" % ("OTAN" if side == 0 else "Rússia"))
