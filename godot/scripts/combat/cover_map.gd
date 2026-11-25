class_name CoverMap
extends RefCounted
## Things to hide behind in the battle area: tree trunks, house walls, craters, vehicle wrecks. Spatial hash of
## [position, radius, strength]; houses are also kept as polygons (they block sight and cannot be walked into).

const CELL := 8.0

var _cells := {}
var _houses: Array = []          # [Rect2, PackedVector2Array]
var trees := 0


func add(p: Vector3, radius: float, strength: float) -> void:
	var k := Vector2i(floori(p.x / CELL), floori(p.z / CELL))
	if not _cells.has(k):
		_cells[k] = []
	_cells[k].append([p, radius, strength])


func build(world: Dictionary, tree_field: TreeField, centre: Vector3, radius: float) -> void:
	if tree_field:
		for c in tree_field.cells.keys():
			var mid := Vector2((c.x + 0.5) * TreeField.CELL, (c.y + 0.5) * TreeField.CELL)
			if mid.distance_to(Vector2(centre.x, centre.z)) > radius + TreeField.CELL:
				continue
			for xf in tree_field.cells[c].xf:
				var o: Vector3 = xf.origin
				if o.distance_to(centre) < radius:
					add(o, 0.4, 0.6)
					trees += 1
	for b in world.get("buildings", []):
		var poly := PackedVector2Array()
		for p in b.p:
			poly.append(Vector2(p[0], p[1]))
		if poly.size() < 3 or poly[0].distance_to(Vector2(centre.x, centre.z)) > radius:
			continue
		var r := Rect2(poly[0], Vector2.ZERO)
		for v in poly:
			r = r.expand(v)
		_houses.append([r, poly])
		for i in poly.size():                       # points along the walls
			var a := poly[i]
			var e := poly[(i + 1) % poly.size()]
			var n := maxi(1, int(a.distance_to(e) / 3.0))
			for k in n:
				var q := a.lerp(e, (k + 0.5) / n)
				add(Vector3(q.x, centre.y, q.y), 0.3, 1.0)


func near(p: Vector3, r: float) -> Array:
	var out := []
	var n := int(ceil(r / CELL))
	var cx := floori(p.x / CELL)
	var cz := floori(p.z / CELL)
	for i in range(cx - n, cx + n + 1):
		for j in range(cz - n, cz + n + 1):
			for o in _cells.get(Vector2i(i, j), []):
				var d: Vector3 = o[0] - p
				if Vector2(d.x, d.z).length() <= r:
					out.append(o)
	return out


## Protection at p from fire coming along `to_threat`: an object close by, between the man and the enemy.
func score(p: Vector3, to_threat: Vector3) -> float:
	var t := Vector2(to_threat.x, to_threat.z).normalized()
	var best := 0.0
	for o in near(p, 2.2):
		var d := Vector2(o[0].x - p.x, o[0].z - p.z)
		if d.length() < o[1] + 1.8 and (d.length() < 0.1 or d.normalized().dot(t) > 0.7):
			best = maxf(best, o[2])
	return best


## Places to hide from `threat` within r of p: just behind each object. Returns [[spot, strength], ...].
func spots(p: Vector3, threat: Vector3, r: float) -> Array:
	var out := []
	for o in near(p, r):
		var away := Vector3(o[0].x - threat.x, 0, o[0].z - threat.z).normalized()
		var s: Vector3 = o[0] + away * (float(o[1]) + 0.7)
		if not inside_house(s):
			out.append([s, o[2]])
	return out


func inside_house(p: Vector3) -> bool:
	var q := Vector2(p.x, p.z)
	for h in _houses:
		if (h[0] as Rect2).has_point(q) and Geometry2D.is_point_in_polygon(q, h[1]):
			return true
	return false


func house_between(a: Vector3, b: Vector3) -> bool:
	var p := Vector2(a.x, a.z)
	var q := Vector2(b.x, b.z)
	var box := Rect2(p, Vector2.ZERO).expand(q)
	for h in _houses:
		if not box.intersects(h[0]):
			continue
		var poly: PackedVector2Array = h[1]
		for i in poly.size():
			if Geometry2D.segment_intersects_segment(p, q, poly[i], poly[(i + 1) % poly.size()]) != null:
				return true
	return false
