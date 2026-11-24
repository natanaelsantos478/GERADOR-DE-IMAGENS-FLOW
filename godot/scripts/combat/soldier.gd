class_name Soldier
extends Node3D
## One infantryman: model + animation state machine (idle, walk, run, aim standing / crouched / prone, crawl, hit
## reaction), physics ragdoll when he dies. Weapon numbers follow the strategy game's tactical RIFLE
## (src/sim/tactical/units.ts: range 450 m, accuracy 0.5 at ~500 m).

enum State { IDLE, MOVE, ENGAGE, DEAD }
enum Stance { STAND, CROUCH, PRONE }
const WALK := 1.5
const RUN := 3.6
const RANGE := 450.0
const BURST_GAP := Vector2(1.2, 2.6)
const EYE := {Stance.STAND: 1.6, Stance.CROUCH: 1.0, Stance.PRONE: 0.35}
const LIB := "ual"

static var _libs := {}            # armature node name -> AnimationLibrary remapped to it

var side := 0
var squad: Squad
var hp := 100.0
var state := State.IDLE
var stance := Stance.STAND
var target_pos := Vector3.ZERO
var running := true
var enemy: Soldier
var terrain: Terrain3D
var fx: CombatFx
var suppression := 0.0             # rises when bullets land close; high -> goes prone
var _player: AnimationPlayer
var _skeleton: Skeleton3D
var _anim := ""
var _cool := 0.0
var _model: Node3D
var _busy := 0.0                   # one-shot reaction playing


func setup(model_path: String, s: int, t: Terrain3D, effects: CombatFx) -> void:
	side = s
	terrain = t
	fx = effects
	_model = (load(model_path) as PackedScene).instantiate()
	add_child(_model)
	var ap := _model.find_children("*", "AnimationPlayer", true, false)
	var sk := _model.find_children("*", "Skeleton3D", true, false)
	if ap.size() > 0 and sk.size() > 0:
		_player = ap[0]
		_skeleton = sk[0]
		_player.add_animation_library(LIB, _library_for(_skeleton.get_parent().name))
	_play("Idle")
	_cool = randf_range(0.0, 2.0)


## The shared clips (anims.glb: Quaternius UAL1 + rifle/prone) with their tracks pointed at this model's armature.
static func _library_for(armature: String) -> AnimationLibrary:
	if _libs.has(armature):
		return _libs[armature]
	var src: Node = (load("res://assets/soldiers/anims.glb") as PackedScene).instantiate()
	var player: AnimationPlayer = src.find_children("*", "AnimationPlayer", true, false)[0]
	var src_arm: String = (src.find_children("*", "Skeleton3D", true, false)[0] as Node).get_parent().name
	var lib := AnimationLibrary.new()
	for n in player.get_animation_list():
		var a: Animation = player.get_animation(n).duplicate(true)
		for t in a.get_track_count():
			var p := String(a.track_get_path(t))
			if p.begins_with(src_arm + "/"):
				a.track_set_path(t, NodePath(armature + p.substr(src_arm.length())))
		a.loop_mode = Animation.LOOP_NONE if (n.begins_with("Death") or n.begins_with("Hit") or n.contains("Reload")) else Animation.LOOP_LINEAR
		lib.add_animation(n, a)
	src.free()
	_libs[armature] = lib
	return lib


func alive() -> bool:
	return state != State.DEAD


func eye() -> Vector3:
	return global_position + Vector3(0, EYE[stance], 0)


func move_to(p: Vector3, run := true) -> void:
	if not alive():
		return
	target_pos = p
	running = run
	state = State.MOVE
	stance = Stance.STAND


## damage, and the push of what hit him (bullet direction, or blast) for the fall.
func hit(damage: float, push: Vector3, blast := false) -> void:
	if not alive():
		return
	hp -= damage
	if hp <= 0.0:
		_die(push, blast)
	else:
		_busy = 0.5
		_play(LIB + "/Hit_Chest", 0.05)
		suppression += 0.5


func near_miss() -> void:
	suppression = minf(suppression + 0.25, 2.0)


func _die(push: Vector3, blast: bool) -> void:
	state = State.DEAD
	squad.on_death(self)
	if _player:
		_player.stop()
		_player.active = false
	if _skeleton:
		Ragdoll.activate(_skeleton, terrain, push, "spine_02", 0.9 if blast else 0.25)


func _physics_process(dt: float) -> void:
	if not alive():
		return
	_cool -= dt
	_busy -= dt
	suppression = maxf(0.0, suppression - dt * 0.08)
	if enemy and (not enemy.alive() or global_position.distance_to(enemy.global_position) > RANGE * 1.1):
		enemy = null
	if enemy == null:
		enemy = squad.pick_target(self)
	if _busy > 0.0:
		return
	if enemy:
		_engage(dt)
	elif state == State.MOVE:
		_walk(dt)
	else:
		_play(LIB + "/Idle")


func _walk(dt: float) -> void:
	var to := target_pos - global_position
	to.y = 0
	if to.length() < 1.0:
		state = State.IDLE
		return
	var crawling := stance == Stance.PRONE
	var speed := 0.6 if crawling else (RUN if running else WALK)
	var dir := (to.normalized() + squad.separation(self) * 0.6).normalized()
	var p := global_position + dir * speed * dt
	p.y = _ground(p)
	global_position = p
	_face(dir, dt)
	_play(LIB + ("/Prone_Crawl" if crawling else ("/Jog_Fwd" if running else "/Walk")))


func _engage(dt: float) -> void:
	var to := enemy.global_position - global_position
	_face(Vector3(to.x, 0, to.z).normalized(), dt * 2.0)
	# under fire: get down; otherwise crouch to shoot
	stance = Stance.PRONE if suppression > 0.9 else Stance.CROUCH
	_play(LIB + ("/Prone_Aim" if stance == Stance.PRONE else "/Rifle_Aim_Crouch"))
	if _cool > 0.0:
		return
	_cool = randf_range(BURST_GAP.x, BURST_GAP.y)
	var d := to.length()
	if not squad.sim.line_of_sight(eye(), enemy.eye()):
		_cool = 0.6
		return
	var rounds := randi_range(2, 4)
	fx.shot(self, enemy, rounds)
	var exposure: float = {Stance.STAND: 1.0, Stance.CROUCH: 0.55, Stance.PRONE: 0.25}[enemy.stance]
	var p_hit := 0.5 * clampf(1.0 - d / (RANGE * 1.2), 0.05, 1.0) * exposure * 0.35
	var dir := to.normalized()
	for k in rounds:
		if randf() < p_hit:
			enemy.hit(randf_range(25.0, 60.0), (dir + Vector3(0, 0.15, 0)) * randf_range(25.0, 45.0))
		else:
			enemy.near_miss()


func _face(dir: Vector3, dt: float) -> void:
	if dir.length() < 0.01:
		return
	rotation.y = lerp_angle(rotation.y, atan2(dir.x, dir.z), 1.0 - exp(-8.0 * dt))


func _ground(p: Vector3) -> float:
	var h := terrain.data.get_height(p)
	return p.y if is_nan(h) else h


func _play(name: String, blend := 0.25) -> void:
	if _player == null or _anim == name:
		return
	if not _player.has_animation(name):
		var short := name.get_slice("/", 1)
		if _player.has_animation(short):
			name = short
		else:
			return
	_anim = name
	_player.play(name, blend)
