class_name Tank
extends Node3D
## A tank of one side: drives with its infantry, turns the turret, shells enemy armour first and infantry second,
## machine-guns men who come close, and when destroyed blows up, throws its turret and burns (the wreck is cover).

const KEEP := 80.0        # does not drive closer than this to the enemy

var side := 0
var sim: CombatSim
var hp := 160.0
var _model: Node3D
var _turret: Node3D
var _cool := 4.0
var _mg := 2.0


func setup(s: int, world: CombatSim) -> void:
	side = s
	sim = world
	_model = WarModel.make("res://assets/vehicles/near_mbt.glb", 8.5, 0.0,
		Color(0.28, 0.33, 0.2) if s == 0 else Color(0.2, 0.22, 0.14))
	add_child(_model)
	_turret = _model.find_child("turret", true, false) as Node3D
	_cool = randf_range(8.0, 14.0)


func alive() -> bool:
	return hp > 0.0


func _physics_process(dt: float) -> void:
	if not alive() or not sim.started:
		return
	_cool -= dt
	_mg -= dt
	var foe: Tank = null
	for t in sim.tanks:
		if t.side != side and t.alive():
			foe = t
	var man: Soldier = null
	var md := 350.0
	for e in sim.enemies_of(side):
		var d := global_position.distance_to(e.global_position)
		if d < md and sim.line_of_sight(global_position + Vector3(0, 2.6, 0), e.eye()):
			md = d
			man = e
	var aim := Vector3.INF
	if foe and sim.line_of_sight(global_position + Vector3(0, 2.6, 0), foe.global_position + Vector3(0, 1.8, 0)):
		aim = foe.global_position
	elif man:
		aim = man.global_position
	var goal := aim if aim != Vector3.INF else sim.enemy_guess(side)
	if goal == Vector3.INF:
		return
	var to := goal - global_position
	to.y = 0
	if to.length() > KEEP:
		var dir := to.normalized()
		var p := global_position + dir * 2.2 * dt
		if sim.cover.inside_house(p + dir * 4.0):
			dir = dir.rotated(Vector3.UP, 1.2)
			p = global_position + dir * 2.2 * dt
		p.y = sim.terrain.data.get_height(p)
		global_position = p
		rotation.y = lerp_angle(rotation.y, atan2(dir.x, dir.z), dt * 0.8)
	var turned := true
	if _turret:
		var want := atan2(to.x, to.z) - rotation.y
		_turret.rotation.y = rotate_toward(_turret.rotation.y, want, dt * 0.8)
		turned = absf(angle_difference(_turret.rotation.y, want)) < 0.08
	if aim == Vector3.INF:
		return
	var muzzle := global_position + to.normalized() * 5.0 + Vector3(0, 2.4, 0)
	if _cool <= 0.0 and turned:
		_cool = randf_range(6.0, 9.0)
		sim.fx._flash(muzzle)
		sim.fx.explosion(muzzle, 0.3)
		sim.shell(self, muzzle, aim, foe if foe and aim == foe.global_position else null)
	if _mg <= 0.0 and man and md < 200.0:
		_mg = randf_range(1.5, 3.0)
		sim.fx._flash(muzzle)
		sim.fx._tracer(muzzle, man.eye())
		for e in sim.enemies_of(side):
			if e.global_position.distance_to(man.global_position) < 5.0:
				if randf() < 0.08 * (0.35 if e.in_cover else 1.0):
					e.hit(0.0, to.normalized() * 30.0)
				else:
					e.near_miss(null, 0.3)


func damage(d: float) -> void:
	if not alive():
		return
	hp -= d
	if hp > 0.0:
		return
	var at := global_position
	sim.fx.explosion(at + Vector3(0, 1.5, 0), 2.2)
	WarModel.paint(_model, Color(0.035, 0.03, 0.028))
	WarModel.burn(self, sim.fx._soft, Vector3(0, 2.0, 0))
	if _turret:                                    # the turret jumps off its ring
		var y := _turret.position.y
		var tw := create_tween().set_parallel()
		tw.tween_property(_turret, "position:y", y + 3.5, 0.45).set_ease(Tween.EASE_OUT)
		tw.tween_property(_turret, "rotation:z", 0.6, 0.9)
		tw.chain().tween_property(_turret, "position:y", y + 0.1, 0.5).set_ease(Tween.EASE_IN)
	for k in 5:
		sim.cover.add(at + Vector3(sin(rotation.y), 0, cos(rotation.y)) * (k - 2) * 1.6, 1.7, 1.0)
	sim.blast(at, 10.0, 90.0)
	sim.log_event("tanque destruído (%s)" % ("OTAN" if side == 0 else "Rússia"))
