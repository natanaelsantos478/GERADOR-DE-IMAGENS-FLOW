class_name Soldier
extends Node3D
## One infantryman: model + animation state machine (idle, walk, run, crouch-aim, shoot, dead), moves on the relief,
## faces where it goes or where it shoots. Weapon numbers follow the strategy game's tactical RIFLE
## (src/sim/tactical/units.ts: range 450 m, accuracy 0.5 at ~500 m).

enum State { IDLE, MOVE, ENGAGE, DEAD }
const WALK := 1.5
const RUN := 3.6
const RANGE := 450.0
const BURST_GAP := Vector2(1.2, 2.6)     # seconds between bursts
const EYE_STAND := 1.6
const EYE_CROUCH := 1.0

var side := 0
var squad: Squad
var hp := 100.0
var state := State.IDLE
var target_pos := Vector3.ZERO
var running := true
var enemy: Soldier
var terrain: Terrain3D
var fx: CombatFx
var _player: AnimationPlayer
var _anim := ""
var _cool := 0.0
var _model: Node3D
var _crouched := false


func setup(model_path: String, s: int, t: Terrain3D, effects: CombatFx) -> void:
	side = s
	terrain = t
	fx = effects
	_model = (load(model_path) as PackedScene).instantiate()
	add_child(_model)
	var ap := _model.find_children("*", "AnimationPlayer", true, false)
	if ap.size() > 0:
		_player = ap[0]
		for a in _player.get_animation_list():
			_player.get_animation(a).loop_mode = Animation.LOOP_NONE if a.begins_with("Death") else Animation.LOOP_LINEAR
	_play("Idle")
	_cool = randf_range(0.0, 2.0)


func alive() -> bool:
	return state != State.DEAD


func eye() -> Vector3:
	return global_position + Vector3(0, EYE_CROUCH if _crouched else EYE_STAND, 0)


func move_to(p: Vector3, run := true) -> void:
	if not alive():
		return
	target_pos = p
	running = run
	state = State.MOVE


func hit(damage: float) -> void:
	if not alive():
		return
	hp -= damage
	if hp <= 0.0:
		state = State.DEAD
		_play("Death01", 0.15)
		squad.on_death(self)


func _physics_process(dt: float) -> void:
	if not alive():
		return
	_cool -= dt
	if enemy and (not enemy.alive() or global_position.distance_to(enemy.global_position) > RANGE * 1.1):
		enemy = null
	if enemy == null:
		enemy = squad.pick_target(self)
	if enemy:
		_engage(dt)
	elif state == State.MOVE:
		_walk(dt)
	else:
		_crouched = false
		_play("Idle")


func _walk(dt: float) -> void:
	var to := target_pos - global_position
	to.y = 0
	if to.length() < 1.0:
		state = State.IDLE
		return
	var speed := RUN if running else WALK
	var dir := to.normalized()
	dir = (dir + squad.separation(self) * 0.6).normalized()
	var p := global_position + dir * speed * dt
	p.y = _ground(p)
	global_position = p
	_face(dir, dt)
	_crouched = false
	_play("Jog_Fwd" if running else "Walk")


func _engage(dt: float) -> void:
	var to := enemy.global_position - global_position
	_face(Vector3(to.x, 0, to.z).normalized(), dt * 2.0)
	_crouched = true
	_play("Pistol_Aim_Neutral" if _cool < 0.6 else "Crouch_Idle")
	if _cool > 0.0:
		return
	_cool = randf_range(BURST_GAP.x, BURST_GAP.y)
	var d := to.length()
	if not squad.sim.line_of_sight(eye(), enemy.eye()):
		_cool = 0.6
		return
	var rounds := randi_range(2, 4)
	fx.shot(self, enemy, rounds)
	# hit chance per round: weapon accuracy, distance, target crouched or not
	var p_hit := 0.5 * clampf(1.0 - d / (RANGE * 1.2), 0.05, 1.0) * (0.55 if enemy._crouched else 1.0) * 0.35
	for k in rounds:
		if randf() < p_hit:
			enemy.hit(randf_range(25.0, 60.0))


func _face(dir: Vector3, dt: float) -> void:
	if dir.length() < 0.01:
		return
	var want := atan2(dir.x, dir.z)
	rotation.y = lerp_angle(rotation.y, want, 1.0 - exp(-8.0 * dt))


func _ground(p: Vector3) -> float:
	var h := terrain.data.get_height(p)
	return p.y if is_nan(h) else h


func _play(name: String, blend := 0.25) -> void:
	if _player == null or _anim == name or not _player.has_animation(name):
		return
	_anim = name
	_player.play(name, blend)
