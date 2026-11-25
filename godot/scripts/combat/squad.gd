class_name Squad
extends RefCounted
## A squad of one side: shared knowledge of the enemy, tactics, orders from the player.
##
## Tactics (re-evaluated every 0.8 s):
##  ADVANCE   no enemy known: moves on, crouched when it gets close.
##  FIREFIGHT fire and manoeuvre: two teams; one holds and shoots (overwatch) while the other moves forward in short
##            bounds to the best cover near its goal, then they swap. Mortar is called on a stationary enemy.
##  FLANK     enemy stuck in place and close: one team goes round a side hidden from him, the other pins him down;
##            when the flankers are in position everybody assaults.
##  WITHDRAW  heavy losses or broken morale: bounds back to the start line, then holds.
##  HOLD      stays where it is (after a withdrawal or after reaching a point given by the player).
##  PLAYER    walking to a point the player ordered; individual reactions (cover, return fire, fear) still apply.

enum Mode { ADVANCE, FIREFIGHT, FLANK, WITHDRAW, HOLD, PLAYER }
const MODE_NAMES := ["avanço", "fogo e manobra", "flanco", "retirada", "defesa", "ordem do jogador"]
const MEMORY := 25.0        # how long a spotted enemy stays known (s)
const BOUND_STEP := 32.0    # length of one bound (m)
const CLOSE := 130.0        # from here no more bounding: pin, flank or assault
const STATIONARY_FOR := 14.0

var side := 0
var name := ""
var sim: CombatSim
var members: Array[Soldier] = []
var objective := Vector3.ZERO
var home := Vector3.ZERO
var mode := Mode.ADVANCE
var player_order := false
var contacts := {}          # enemy Soldier -> [position, time]
var last_contact_t := -999.0
var stats := {"bounds": 0, "flanks": 0, "assaults": 0, "withdraws": 0, "covers": 0, "suppress": 0, "reloads": 0, "fled": 0, "mortars": 0, "stuck": 0, "scavenged": 0, "head": 0, "wounded": 0, "down": 0, "treated": 0, "dashes": 0}
var modes_seen := {}
var _think_t := 0.0
var _bound_team := 1
var _bound_until := 0.0
var _anchor := Vector3.INF
var _anchor_t := 0.0
var _flank_t := -99.0
var _flank_side := 1.0
var _wd_t := 0.0
var _wd_end := -999.0


func alive() -> Array[Soldier]:
	var out: Array[Soldier] = []
	for m in members:
		if m.alive():
			out.append(m)
	return out


func centre() -> Vector3:
	var a := alive()
	if a.is_empty():
		return Vector3.ZERO
	var c := Vector3.ZERO
	for m in a:
		c += m.global_position
	return c / a.size()


# --------------------------------------------------------------------------- shared knowledge

func report(e: Soldier, pos: Vector3) -> void:
	contacts[e] = [pos, sim.time]
	last_contact_t = sim.time


func known() -> Array[Soldier]:
	var out: Array[Soldier] = []
	for e in contacts.keys():
		if not e.alive() or sim.time - float(contacts[e][1]) > MEMORY:
			contacts.erase(e)
		else:
			out.append(e)
	return out


func has_contact() -> bool:
	return not known().is_empty()


## Where the enemy is: mean of the freshest reports (INF if none).
func contact_centre() -> Vector3:
	var c := Vector3.ZERO
	var n := 0
	for e in known():
		if sim.time - float(contacts[e][1]) < 12.0:
			c += contacts[e][0] as Vector3
			n += 1
	if n == 0:
		for e in known():
			c += contacts[e][0] as Vector3
			n += 1
	return c / n if n > 0 else Vector3.INF


func targeting(e: Soldier, except: Soldier) -> int:
	var n := 0
	for m in members:
		if m != except and m.alive() and m.enemy == e:
			n += 1
	return n


func friends_near(s: Soldier, r: float) -> int:
	var n := 0
	for m in members:
		if m != s and m.alive() and m.global_position.distance_to(s.global_position) < r:
			n += 1
	return n


func leader_near(s: Soldier, r: float) -> bool:
	for m in members:
		if m.alive() and m.role == Soldier.Role.LEADER and m.global_position.distance_to(s.global_position) < r:
			return true
	return false


func average(prop: String) -> float:
	var a := alive()
	if a.is_empty():
		return 0.0
	var t := 0.0
	for m in a:
		t += float(m.get(prop))
	return t / a.size()


func separation(s: Soldier) -> Vector3:
	var v := Vector3.ZERO
	for m in members:
		if m == s or not m.alive():
			continue
		var d := s.global_position - m.global_position
		d.y = 0
		var l := d.length()
		if l < 2.5 and l > 0.01:
			v += d / l * (2.5 - l)
	return v


## Is another man of the squad already behind / heading to this spot?
func occupied(p: Vector3, except: Soldier) -> bool:
	for m in members:
		if m != except and m.alive() and (m.global_position.distance_to(p) < 1.5 or (m.has_goal and m.goal.distance_to(p) < 1.5)):
			return true
	return false


## The one man who goes to help a hurt friend: the nearest able one.
func carer(hurt: Soldier, asking: Soldier) -> Soldier:
	var best: Soldier = null
	var bd := INF
	for m in members:
		if m != hurt and m.alive() and not m.down and not m.fleeing:
			var d := m.global_position.distance_to(hurt.global_position)
			if d < bd:
				bd = d
				best = m
	return best if best else asking


func on_death(s: Soldier) -> void:
	sim.on_casualty(self)
	for m in alive():
		var d := m.global_position.distance_to(s.global_position)
		if d < 30.0:
			m.morale -= 0.12 * (1.0 - d / 45.0)       # seeing a friend fall
		if s.role == Soldier.Role.LEADER:
			m.morale -= 0.08
	if s.role == Soldier.Role.LEADER:
		for m in alive():                                # next in command
			if m.role == Soldier.Role.RIFLE:
				m.role = Soldier.Role.LEADER
				break


# --------------------------------------------------------------------------- orders

## Line formation across the direction of travel, 4 m between men. `by_player`: from now on the squad holds the point.
func order_move(p: Vector3, run := true, by_player := true) -> void:
	objective = p
	player_order = by_player
	_set_mode(Mode.PLAYER if by_player else Mode.ADVANCE)
	var a := alive()
	var dir := (p - centre())
	dir.y = 0
	dir = dir.normalized() if dir.length() > 0.1 else Vector3.FORWARD
	var right := dir.cross(Vector3.UP).normalized()
	for i in a.size():
		var off := (i - (a.size() - 1) * 0.5) * 4.0
		a[i].move_to(p + right * off + dir * (randf() - 0.5) * 2.0, run, by_player)


## The squad goes back to deciding by itself.
func release() -> void:
	player_order = false
	_set_mode(Mode.ADVANCE)


func _set_mode(m: Mode) -> void:
	mode = m
	modes_seen[MODE_NAMES[m]] = true


# --------------------------------------------------------------------------- tactics

func think(dt: float) -> void:
	_think_t -= dt
	if _think_t > 0.0:
		return
	_think_t = 0.8
	var a := alive()
	if a.is_empty():
		return
	var known_now := known()
	var strength := float(a.size()) / members.size()
	var morale := average("morale")
	# fall back only if hurt, not just after a fall-back (it would loop) and not already at the start line
	var ammo := 0.0
	for m in a:
		ammo += m.mag + m.reserve
	var dry := ammo / (a.size() * 120.0) < 0.1       # almost nothing left to fight with
	var broken := (strength <= 0.4 or morale < 0.28 or dry) and sim.time - _wd_end > 45.0 and centre().distance_to(home) > 60.0
	if mode == Mode.WITHDRAW:
		_think_withdraw(a)
		return
	if mode == Mode.PLAYER:
		var moving := false
		for m in a:
			moving = moving or m.has_goal
		if not moving:
			_set_mode(Mode.HOLD)
			for m in a:
				m.set_task(Soldier.Task.OVERWATCH)
		return
	if broken and not known_now.is_empty() and not player_order:
		_start_withdraw(a)
		return
	if mode == Mode.HOLD:
		if not player_order and known_now.is_empty() and sim.time - last_contact_t > 30.0 and strength > 0.5:
			_set_mode(Mode.ADVANCE)
		return
	if known_now.is_empty():
		_think_advance(a)
		return
	_think_fight(a, known_now, strength)


func _think_advance(a: Array[Soldier]) -> void:
	_set_mode(Mode.ADVANCE)
	var moving := false
	for m in a:
		moving = moving or m.has_goal
	if moving:
		return
	# nothing known and nobody walking: go towards where the enemy was last, else towards the other squad
	var target := sim.enemy_guess(side)
	if target == Vector3.INF:
		return
	var c := centre()
	var dir := (target - c)
	dir.y = 0
	if dir.length() < 40.0:
		return
	var p := c + dir.normalized() * minf(150.0, dir.length())
	p.y = sim.terrain.data.get_height(p)
	order_move(p, true, false)


func _think_fight(a: Array[Soldier], known_now: Array[Soldier], strength: float) -> void:
	var E := contact_centre()
	if E == Vector3.INF:
		return
	var c := centre()
	var D := c.distance_to(E)
	if _anchor == Vector3.INF or E.distance_to(_anchor) > 20.0:
		_anchor = E
		_anchor_t = sim.time
	var still := sim.time - _anchor_t
	var pinned := 0
	for m in a:
		if m.suppression > 1.1:
			pinned += 1
	if mode != Mode.FLANK:
		_set_mode(Mode.FIREFIGHT)
	# call the mortar on a stationary enemy, or when the squad is pinned
	if (still > 8.0 or pinned >= a.size() / 2) and D > 70.0 and sim.request_fire(self, E):
		stats["mortars"] += 1
	# the assault: close and not outnumbered
	if D < 90.0 and a.size() >= int(known_now.size() * 0.8) and pinned < a.size() / 2:
		if mode != Mode.FLANK or _flank_ready(a):
			_assault(a, E)
			return
	if mode == Mode.FLANK:
		if _flank_ready(a):
			_assault(a, E)
		elif sim.time - _flank_t > 50.0:
			_set_mode(Mode.FIREFIGHT)
		return
	if pinned >= a.size() / 2:
		for m in a:
			if m.task != Soldier.Task.OVERWATCH:
				m.set_task(Soldier.Task.OVERWATCH)       # heads down, return fire
		return
	if D <= CLOSE:
		if still > STATIONARY_FOR and a.size() >= 4 and sim.time - _flank_t > 60.0:
			_start_flank(a, c, E)
		else:
			for m in a:
				if m.task != Soldier.Task.OVERWATCH:
					m.set_task(Soldier.Task.OVERWATCH)   # fire superiority
		return
	_bounding(a, (E - c).normalized(), E, BOUND_STEP)


func _bounding(a: Array[Soldier], dir: Vector3, threat: Vector3, step: float) -> void:
	dir.y = 0
	dir = dir.normalized()
	var bounders: Array[Soldier] = []
	var watchers: Array[Soldier] = []
	for m in a:
		(bounders if m.team == _bound_team else watchers).append(m)
	var done := true
	for m in bounders:
		done = done and not m.has_goal
	if not done and sim.time < _bound_until:
		return
	# swap roles: the watchers move, the ones that moved now cover
	_bound_team = 1 - _bound_team
	bounders.clear()
	watchers.clear()
	for m in a:
		(bounders if m.team == _bound_team else watchers).append(m)
	if bounders.is_empty():
		_bound_team = 1 - _bound_team
		bounders = watchers.duplicate()
		watchers.clear()
	for m in watchers:
		m.set_task(Soldier.Task.OVERWATCH)
	var tc := Vector3.ZERO
	for m in bounders:
		tc += m.global_position
	tc /= bounders.size()
	var right := dir.cross(Vector3.UP).normalized()
	for i in bounders.size():
		var dest := tc + dir * step + right * ((i - (bounders.size() - 1) * 0.5) * 6.0)
		dest.y = sim.terrain.data.get_height(dest)
		bounders[i].plan_bound(dest, threat)
	stats["bounds"] += 1
	_bound_until = sim.time + 14.0


func _start_flank(a: Array[Soldier], c: Vector3, E: Vector3) -> void:
	var dir := (E - c)
	dir.y = 0
	dir = dir.normalized()
	var perp := dir.cross(Vector3.UP).normalized()
	# the side the enemy cannot see (relief between him and the waypoint), else any
	var best := 1.0
	var best_hidden := -1
	for s in [1.0, -1.0]:
		var w: Vector3 = c + (E - c) * 0.5 + perp * s * 80.0
		w.y = sim.terrain.data.get_height(w)
		var hidden := 0 if sim.line_of_sight(E + Vector3(0, 1.6, 0), w + Vector3(0, 1.0, 0)) else 1
		if hidden > best_hidden or (hidden == best_hidden and randf() < 0.5):
			best_hidden = hidden
			best = s
	_flank_side = best
	_flank_t = sim.time
	_set_mode(Mode.FLANK)
	stats["flanks"] += 1
	var flankers := 0
	for m in a:
		if m.team == _bound_team and m.role != Soldier.Role.GUNNER:
			var w1 := c + (E - c) * 0.5 + perp * _flank_side * (75.0 + randf_range(-8, 8))
			var w2 := E + perp * _flank_side * (40.0 + randf_range(-6, 6)) - dir * 10.0
			w1.y = sim.terrain.data.get_height(w1)
			w2.y = sim.terrain.data.get_height(w2)
			m.set_flank(w1, w2)
			flankers += 1
		else:
			m.set_task(Soldier.Task.OVERWATCH)
	if flankers == 0:
		_set_mode(Mode.FIREFIGHT)


func _flank_ready(a: Array[Soldier]) -> bool:
	for m in a:
		if m.task == Soldier.Task.FLANK and m.has_goal:
			return false
	return true


func _assault(a: Array[Soldier], E: Vector3) -> void:
	_set_mode(Mode.FIREFIGHT)
	var fresh := false
	for m in a:
		fresh = fresh or m.task != Soldier.Task.ASSAULT
	if fresh:
		stats["assaults"] += 1                           # counted once per charge, not per refresh of the target
	for m in a:
		m.assault(E + Vector3(randf_range(-6, 6), 0, randf_range(-6, 6)))


func _start_withdraw(a: Array[Soldier]) -> void:
	_set_mode(Mode.WITHDRAW)
	stats["withdraws"] += 1
	_wd_t = sim.time
	_bound_until = 0.0
	_think_withdraw(a)


func _think_withdraw(a: Array[Soldier]) -> void:
	var c := centre()
	var back := home - c
	back.y = 0
	var quiet := sim.time - last_contact_t > 20.0
	if back.length() < 30.0 or quiet or sim.time - _wd_t > 90.0:
		_wd_end = sim.time
		_set_mode(Mode.HOLD)
		for m in a:
			m.set_task(Soldier.Task.OVERWATCH)
		return
	_bounding(a, back, home, BOUND_STEP)
	for m in a:
		if m.task == Soldier.Task.BOUND:
			m.task = Soldier.Task.WITHDRAW
