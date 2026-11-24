class_name Squad
extends RefCounted
## A group of soldiers of one side: formation, orders, target picking.

var side := 0
var name := ""
var sim: CombatSim
var members: Array[Soldier] = []
var objective := Vector3.ZERO


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


## Line formation across the direction of travel, 4 m between men.
func order_move(p: Vector3, run := true) -> void:
	objective = p
	var a := alive()
	var dir := (p - centre())
	dir.y = 0
	dir = dir.normalized() if dir.length() > 0.1 else Vector3.FORWARD
	var right := dir.cross(Vector3.UP).normalized()
	for i in a.size():
		var off := (i - (a.size() - 1) * 0.5) * 4.0
		a[i].move_to(p + right * off + dir * (randf() - 0.5) * 2.0, run)


func pick_target(s: Soldier) -> Soldier:
	var best: Soldier = null
	var bd := Soldier.RANGE
	for e in sim.enemies_of(side):
		var d := s.global_position.distance_to(e.global_position)
		if d < bd:
			bd = d
			best = e
	return best


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


func on_death(_s: Soldier) -> void:
	sim.on_casualty(self)
