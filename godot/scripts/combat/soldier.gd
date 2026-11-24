class_name Soldier
extends Node3D
## One infantryman: model + animation state machine (idle, walk, run, aim standing / crouched / prone, crawl, hit
## reaction), physics ragdoll when he dies. Weapon numbers follow the strategy game's tactical RIFLE
## (src/sim/tactical/units.ts: range 450 m, accuracy 0.5 at ~500 m).

enum State { IDLE, MOVE, ENGAGE, DEAD }
enum Stance { STAND, CROUCH, PRONE }
enum Role { RIFLE, LEADER, GUNNER }
## What the squad asked of him: free (advance), player order, hold and shoot, move to a bound point, go round the
## flank, charge, fall back.
enum Task { FREE, PLAYER, OVERWATCH, BOUND, FLANK, ASSAULT, WITHDRAW }
enum Gait { WALK, TACTICAL, JOG, SPRINT, CRAWL }
const RANGE := 450.0               # bullets still fly this far (hit chance falls with distance)
const EFFECTIVE := 260.0           # he only opens fire inside this range (gunner: GUNNER_RANGE)
const GUNNER_RANGE := 320.0
const VISION := {Stance.STAND: 350.0, Stance.CROUCH: 280.0, Stance.PRONE: 180.0}   # how far a man in that posture is seen
const SPEED := {Gait.WALK: 1.5, Gait.TACTICAL: 1.9, Gait.JOG: 3.6, Gait.SPRINT: 5.0, Gait.CRAWL: 0.6}
const GAIT_ANIM := {Gait.WALK: "Walk", Gait.TACTICAL: "Crouch_Fwd", Gait.JOG: "Jog_Fwd", Gait.SPRINT: "Sprint", Gait.CRAWL: "Prone_Crawl"}
const MAG := 30
const EYE := {Stance.STAND: 1.6, Stance.CROUCH: 1.0, Stance.PRONE: 0.35}
const LIB := "ual"

static var _libs := {}            # armature node name -> AnimationLibrary remapped to it
static var missing := {}          # animation names asked for and not found (reported by the AI test)

var side := 0
var squad: Squad
var hp := 100.0
var state := State.IDLE
var stance := Stance.STAND
var running := true
var enemy: Soldier
var terrain: Terrain3D
var fx: CombatFx
var suppression := 0.0             # rises when bullets land close; high -> goes prone, > 1.1 pinned down
var role := Role.RIFLE
var team := 0                      # fire-and-manoeuvre team (0 / 1)
var task := Task.FREE
var morale := 1.0                  # < 0.4 shaken (stops advancing), < 0.15 broken (runs for the rear)
var courage := 1.0
var mag := MAG
var reserve := 90
var has_goal := false
var goal := Vector3.ZERO
var route: Array[Vector3] = []
var in_cover := false
var fleeing := false               # broken: running for the rear until morale comes back
var visible_enemies: Array[Soldier] = []
var _shooter: Soldier              # who shot at me last
var _threat_t := -99.0
var _think_t := 0.0
var _cover_t := 0.0
var _suppress_t := 0.0
var _stuck_t := 0.0
var _stuck_p := Vector3.INF
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


# --------------------------------------------------------------------------- orders from the squad

## Walk to a point the player ordered.
func move_to(p: Vector3, run := true, by_player := true) -> void:
	if not alive():
		return
	task = Task.PLAYER if by_player else Task.FREE
	route.clear()
	goal = p
	has_goal = true
	running = run


func set_task(t: Task) -> void:
	task = t
	has_goal = false
	route.clear()


## Move to a bound point, nudged to the best cover within 10 m of it.
func plan_bound(dest: Vector3, threat: Vector3) -> void:
	task = Task.BOUND
	route.clear()
	var best := dest
	var bs := _cover_score(dest, threat)
	for k in 8:
		var a := randf() * TAU
		var p := dest + Vector3(cos(a), 0, sin(a)) * randf_range(2.0, 10.0)
		p.y = _ground(p)
		var sc := _cover_score(p, threat) - 0.02 * p.distance_to(dest)
		if sc > bs:
			bs = sc
			best = p
	goal = best
	has_goal = true


func set_flank(w1: Vector3, w2: Vector3) -> void:
	task = Task.FLANK
	goal = w1
	route = [w2]
	has_goal = true


func assault(p: Vector3) -> void:
	task = Task.ASSAULT
	route.clear()
	goal = p
	has_goal = true


# --------------------------------------------------------------------------- damage and fear

## damage, and the push of what hit him (bullet direction, or blast) for the fall; `src` = who shot.
func hit(damage: float, push: Vector3, blast := false, src: Soldier = null) -> void:
	if not alive():
		return
	hp -= damage
	_noticed(src)
	if hp <= 0.0:
		_die(push, blast)
	else:
		_busy = 0.5
		_play(LIB + "/Hit_Chest", 0.05)
		suppression += 0.5
		morale -= 0.08


func near_miss(src: Soldier = null, weight := 0.25) -> void:
	suppression = minf(suppression + weight, 2.0)
	_noticed(src)


## Being shot at shows where the shooter is (roughly): the whole squad learns it.
func _noticed(src: Soldier) -> void:
	if src == null or not src.alive():
		return
	_shooter = src
	_threat_t = squad.sim.time
	squad.report(src, src.global_position + Vector3(randf_range(-10, 10), 0, randf_range(-10, 10)))


func _die(push: Vector3, blast: bool) -> void:
	state = State.DEAD
	squad.on_death(self)
	if _player:
		_player.stop()
		_player.active = false
	if _skeleton:
		Ragdoll.activate(_skeleton, terrain, push, "spine_02", 0.9 if blast else 0.25, blast)


# --------------------------------------------------------------------------- the mind

func _physics_process(dt: float) -> void:
	if not alive():
		return
	_cool -= dt
	_busy -= dt
	_think_t -= dt
	_cover_t -= dt
	_suppress_t -= dt
	suppression = maxf(0.0, suppression - dt * 0.2)
	# fear: fire wears morale down; calm, friends and the leader nearby bring it back
	morale -= suppression * 0.006 * dt
	if suppression < 0.3:
		var support := 0.012 if squad.friends_near(self, 20.0) > 0 else 0.005
		if squad.leader_near(self, 40.0):
			support += 0.01
		morale += support * dt * courage
	morale = clampf(morale, 0.0, 1.0)
	if _think_t <= 0.0:
		_think_t = randf_range(0.3, 0.5)
		_think()
	if _busy > 0.0:
		return
	_act(dt)


## What he sees and who he shoots at.
func _think() -> void:
	var sim := squad.sim
	visible_enemies.clear()
	for e in sim.enemies_of(side):
		var d := global_position.distance_to(e.global_position)
		if d <= VISION[e.stance] and sim.line_of_sight(eye(), e.eye()):
			visible_enemies.append(e)
			squad.report(e, e.global_position)
	var reach := GUNNER_RANGE if role == Role.GUNNER else EFFECTIVE
	var best: Soldier = null
	var best_score := -INF
	for e in visible_enemies:
		var d := global_position.distance_to(e.global_position)
		if d > reach:
			continue
		var sc := 3.0 - d / reach * 2.0                  # nearer is better
		if e == enemy:
			sc += 0.8                                    # stick to the target
		if e == _shooter and sim.time - _threat_t < 6.0:
			sc += 1.5                                    # the one who is shooting at me
		sc -= 0.7 * squad.targeting(e, self)            # do not all pile on one man
		if sc > best_score:
			best_score = sc
			best = e
	enemy = best


func _act(dt: float) -> void:
	var pinned := suppression > 1.1
	var broken := morale < 0.15
	var shaken := morale < 0.4
	# a broken man runs for the rear (unless he is pinned flat) until his nerve returns
	if morale < 0.15 and not fleeing:
		fleeing = true
		squad.stats["fled"] += 1
	elif fleeing and morale > 0.4:
		fleeing = false
		set_task(Task.OVERWATCH)
	if fleeing and not pinned and global_position.distance_to(squad.home) > 15.0:
		task = Task.WITHDRAW
		goal = squad.home
		route.clear()
		has_goal = true
		_move_step(dt, Gait.SPRINT)
		return
	if pinned:
		stance = Stance.PRONE
		if enemy:
			_shoot(dt)
		else:
			_play(LIB + "/Prone_Aim")
		return
	# a shaken man stops advancing and looks for cover; the squad re-plans without him
	if shaken and has_goal and (task == Task.BOUND or task == Task.ASSAULT or task == Task.FLANK):
		set_task(Task.OVERWATCH)
	if has_goal:
		_move_step(dt, _gait())
		return
	_hold(dt)


func _gait() -> Gait:
	var contact := squad.has_contact()
	match task:
		Task.WITHDRAW:
			return Gait.SPRINT
		Task.ASSAULT:
			return Gait.JOG
		Task.PLAYER:
			return Gait.JOG if running else (Gait.TACTICAL if contact else Gait.WALK)
		Task.FLANK:
			return Gait.JOG if visible_enemies.is_empty() else Gait.TACTICAL   # unseen: run round, seen: creep
		Task.BOUND:
			return Gait.TACTICAL if contact else Gait.JOG
		Task.OVERWATCH:
			return Gait.CRAWL if (suppression > 0.5 and not visible_enemies.is_empty()) else Gait.TACTICAL
	return Gait.JOG if not contact else Gait.TACTICAL


func _move_step(dt: float, g: Gait) -> void:
	var to := goal - global_position
	to.y = 0
	if to.length() < 1.2:
		if not route.is_empty():
			goal = route.pop_front()
		else:
			has_goal = false
			state = State.IDLE
			if task == Task.BOUND or task == Task.WITHDRAW:
				task = Task.OVERWATCH
			in_cover = squad.has_contact() and _cover_score(global_position, squad.contact_centre()) >= 0.6
		return
	# stuck (water, building, steep ground): give the goal up after 5 s without progress
	_stuck_t += dt
	if _stuck_t > 5.0:
		if _stuck_p != Vector3.INF and global_position.distance_to(_stuck_p) < 1.0:
			squad.stats["stuck"] += 1
			has_goal = false
			route.clear()
			if task == Task.BOUND:
				task = Task.OVERWATCH
			_stuck_t = 0.0
			return
		_stuck_p = global_position
		_stuck_t = 0.0
	stance = Stance.PRONE if g == Gait.CRAWL else (Stance.CROUCH if g == Gait.TACTICAL else Stance.STAND)
	var speed: float = SPEED[g] * (0.6 if hp < 40.0 else 1.0)
	var dir := (to.normalized() + squad.separation(self) * 0.6).normalized()
	var p := global_position + dir * speed * dt
	p.y = _ground(p)
	global_position = p
	state = State.MOVE
	# eyes on the enemy while running at him, else on the way
	if task == Task.ASSAULT and enemy:
		_face((enemy.global_position - global_position).normalized(), dt * 2.0)
	else:
		_face(dir, dt)
	_play(LIB + "/" + GAIT_ANIM[g])
	if task == Task.ASSAULT and enemy and _cool <= 0.0 and mag > 0:
		_fire(0.5)


## Standing still: look for cover when the enemy is known, shoot, or suppress the spot where he was seen.
func _hold(dt: float) -> void:
	if mag + reserve <= 0 and _scavenge():
		return
	var threatened := squad.has_contact()
	if threatened and _cover_t <= 0.0:
		_cover_t = randf_range(1.5, 3.0)
		var threat := squad.contact_centre()
		in_cover = _cover_score(global_position, threat) >= 0.6
		if not in_cover and (enemy != null or suppression > 0.3 or task == Task.OVERWATCH):
			var c := _find_cover(threat)
			if c != Vector3.INF:
				goal = c
				route.clear()
				has_goal = true
				squad.stats["covers"] += 1
				return
	if enemy:
		_shoot(dt)
	else:
		_idle(dt)


## Out of ammunition: take what a fallen friend carried (walk to him, then pick it up).
func _scavenge() -> bool:
	var best: Soldier = null
	var bd := 40.0
	for m in squad.members:
		if m != self and not m.alive() and m.mag + m.reserve > 0:
			var d := global_position.distance_to(m.global_position)
			if d < bd:
				bd = d
				best = m
	if best == null:
		return false
	if bd < 2.0:
		reserve = best.mag + best.reserve
		best.mag = 0
		best.reserve = 0
		mag = mini(MAG, reserve)
		reserve -= mag
		_busy = 1.6
		_play(LIB + "/Interact", 0.15)
		squad.stats["scavenged"] += 1
		return true
	goal = best.global_position
	route.clear()
	has_goal = true
	return true


func _idle(dt: float) -> void:
	var sim := squad.sim
	if not squad.has_contact():
		stance = Stance.STAND
		_play(LIB + ("/Idle_Talking" if role == Role.LEADER and squad.mode == Squad.Mode.ADVANCE else "/Idle"))
		return
	stance = Stance.PRONE if in_cover or role == Role.GUNNER else Stance.CROUCH
	_play(LIB + ("/Prone_Aim" if stance == Stance.PRONE else "/Rifle_Aim_Crouch"))
	# the machine gunner keeps the enemy's head down at the place he was last seen
	var c := squad.contact_centre()
	if role == Role.GUNNER and c != Vector3.INF and mag > 0 and _cool <= 0.0 and _suppress_t <= 0.0 and task == Task.OVERWATCH:
		var d := global_position.distance_to(c)
		if d > 40.0 and d < GUNNER_RANGE + 40.0:
			var rounds := mini(randi_range(5, 8), mag)
			mag -= rounds
			_cool = randf_range(0.8, 1.4)
			_suppress_t = randf_range(2.0, 4.0)
			_face((c - global_position).normalized(), dt * 2.0)
			fx.shot_area(self, c, rounds)
			squad.stats["suppress"] += 1
			for e in sim.enemies_of(side):
				if e.global_position.distance_to(c) < 9.0:
					e.near_miss(self, 0.04 + 0.01 * rounds)


func _shoot(dt: float) -> void:
	var to := enemy.global_position - global_position
	_face(Vector3(to.x, 0, to.z).normalized(), dt * 2.0)
	# under fire or behind cover: lie down; otherwise kneel to shoot
	stance = Stance.PRONE if (suppression > 0.6 or in_cover or role == Role.GUNNER) else Stance.CROUCH
	_play(LIB + ("/Prone_Aim" if stance == Stance.PRONE else "/Rifle_Aim_Crouch"))
	if _cool > 0.0:
		return
	if mag <= 0:
		if reserve <= 0:
			_cool = 3.0                                  # dry: cannot shoot
			return
		var n := mini(MAG, reserve)
		reserve -= n
		mag = n
		_busy = 2.6
		_play(LIB + "/Crouch_Idle", 0.15)
		squad.stats["reloads"] += 1
		return
	if not squad.sim.line_of_sight(eye(), enemy.eye()):
		_cool = 0.6
		return
	_fire(1.0)


func _fire(accuracy: float) -> void:
	var to := enemy.global_position - global_position
	var d := to.length()
	var gunner := role == Role.GUNNER
	var rounds := mini(randi_range(6, 10) if gunner else randi_range(2, 4), mag)
	mag -= rounds
	_cool = randf_range(0.5, 1.0) if gunner else randf_range(1.2, 2.6)
	if d > EFFECTIVE:
		_cool *= 1.6                                     # fire discipline at long range
	fx.shot(self, enemy, rounds)
	var exposure: float = {Stance.STAND: 1.0, Stance.CROUCH: 0.55, Stance.PRONE: 0.25}[enemy.stance]
	var cover := 0.45 if enemy.in_cover else 1.0
	var moving := 0.6 if enemy.state == State.MOVE else 1.0
	var shaky := 0.5 if suppression > 0.9 else (0.8 if suppression > 0.4 else 1.0)
	var p_hit := 0.5 * clampf(1.0 - d / (RANGE * 1.2), 0.05, 1.0) * exposure * 0.35 * accuracy * cover * moving * shaky
	var dir := to.normalized()
	for k in rounds:
		if randf() < p_hit:
			enemy.hit(randf_range(25.0, 60.0), (dir + Vector3(0, 0.15, 0)) * randf_range(25.0, 45.0), false, self)
		else:
			enemy.near_miss(self, (0.1 + 0.1 * (1.0 - d / RANGE)) * (1.3 if gunner else 1.0))


# --------------------------------------------------------------------------- cover

## True if the relief blocks the line from `from` to `to` (samples packed near `to`, where small banks matter).
func _blocked(from: Vector3, to: Vector3) -> bool:
	var d := from.distance_to(to)
	for m in [1.5, 3.0, 5.0, 8.0, 12.0, 18.0, 26.0, 40.0, 60.0, 90.0, 130.0, 190.0]:
		if m >= d:
			break
		var p := to.lerp(from, m / d)
		var h := terrain.data.get_height(p)
		if not is_nan(h) and h > p.y:
			return true
	return false


## 1.0 hull-down (a man lying there is hidden from the enemy, and from a kneeling eye the enemy is still in sight),
## 0.6 full defilade, 0 open ground (+ whatever trees / walls give, via the sim hook).
func _cover_score(p: Vector3, threat: Vector3) -> float:
	if threat == Vector3.INF:
		return 0.0
	var g := _ground(p)
	var th := Vector3(threat.x, _ground(threat) + 1.5, threat.z)
	if not _blocked(th, Vector3(p.x, g + 0.35, p.z)):
		return squad.sim.extra_cover(p, (threat - p).normalized())
	return 1.0 if not _blocked(Vector3(p.x, g + 1.0, p.z), th) else 0.6


## A better spot within 20 m, or Vector3.INF.
func _find_cover(threat: Vector3) -> Vector3:
	var best := Vector3.INF
	var bs := _cover_score(global_position, threat) + 0.2
	var here := global_position.distance_to(threat)
	for k in 10:
		var a := randf() * TAU
		var r := randf_range(4.0, 20.0)
		var p := global_position + Vector3(cos(a), 0, sin(a)) * r
		p.y = _ground(p)
		var sc := _cover_score(p, threat) - r * 0.012
		if p.distance_to(threat) < here * 0.7:
			sc -= 0.5                                    # not towards the enemy
		if sc > bs:
			bs = sc
			best = p
	return best


# --------------------------------------------------------------------------- body

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
			missing[name] = true
			return
	_anim = name
	_player.play(name, blend)
