class_name RoofBuilder
extends RefCounted
## Roof shapes on a rectangle frame (centre, long axis u, short axis v, half sizes a >= b) or on the footprint.
## gable, hip, pyramid, shed (uma água), butterfly (V invertido), w (vários vales), barrel (arco), sawtooth
## (dente-de-serra), mansard, flat (laje) — the material layer and photo colour come from the site parameters.

var bf: BuildingField      # emits triangles (shared vertex format)
var st: SurfaceTool
var roof_layer := 6
var wall_layer := 3
var roof_col := Color(1, 1, 1, 1)   # photo colour of this roof (rgb), a = 1
var wall_col := Color()              # wall vertex colour without windows (gable ends)
var base := 0.0


## Frame of a near-rectangular footprint: [centre, u, v, a, b] with a along the long side.
static func frame(p: PackedVector2Array) -> Array:
	var best := INF
	var out := []
	for i in p.size():
		var d := (p[(i + 1) % p.size()] - p[i]).normalized()
		if d.length() < 0.5:
			continue
		var n := Vector2(-d.y, d.x)
		var a0 := INF
		var a1 := -INF
		var b0 := INF
		var b1 := -INF
		for q in p:
			a0 = minf(a0, q.dot(d))
			a1 = maxf(a1, q.dot(d))
			b0 = minf(b0, q.dot(n))
			b1 = maxf(b1, q.dot(n))
		var area := (a1 - a0) * (b1 - b0)
		if area < best:
			best = area
			var c := d * (a0 + a1) * 0.5 + n * (b0 + b1) * 0.5
			var ha := (a1 - a0) * 0.5
			var hb := (b1 - b0) * 0.5
			out = [c, d, n, ha, hb] if ha >= hb else [c, n, d, hb, ha]
	return out


func _p(f: Array, s: float, t: float, y: float) -> Vector3:
	var q: Vector2 = f[0] + f[1] * s + f[2] * t
	return Vector3(q.x, y, q.y)


func _plane(v: Array, along: float) -> void:
	var n: Vector3 = (v[1] - v[0]).cross(v[v.size() - 1] - v[0]).normalized()
	if n.y < 0.0:
		n = -n
	var up: Vector3 = (v[v.size() - 1] - v[0])
	var L: float = (v[1] - v[0]).length()
	var S: float = up.length()
	if v.size() == 4:
		bf._quad(st, v, [Vector2(0, 0), Vector2(L, 0), Vector2(L, S), Vector2(0, S)], Vector2(roof_layer, -1.0), roof_col, n)
	else:
		bf._tri(st, v, [Vector2(0, 0), Vector2(L, 0), Vector2(along, S)], Vector2(roof_layer, -1.0), roof_col, n)


func _end_wall(pts: Array, outward: Vector3) -> void:
	# a convex polygon in a vertical plane, fanned; UV metres (horizontal, height above base)
	var o: Vector3 = pts[0]
	var h_axis: Vector3 = (pts[1] - pts[0]).normalized()
	for k in range(1, pts.size() - 1):
		var tri := [pts[0], pts[k], pts[k + 1]]
		var uvs := []
		for q in tri:
			uvs.append(Vector2((q - o).dot(h_axis), q.y - base))
		bf._tri(st, tri, uvs, Vector2(wall_layer, 10.0), wall_col, outward)


func gable(f: Array, eave: float, pitch: float) -> void:
	var a: float = f[3]
	var b: float = f[4]
	var o := 0.35
	var rise := tan(deg_to_rad(pitch)) * b
	var ridge := eave + rise
	var drop := tan(deg_to_rad(pitch)) * o
	_plane([_p(f, -a - 0.2, -b - o, eave - drop), _p(f, a + 0.2, -b - o, eave - drop), _p(f, a + 0.2, 0, ridge), _p(f, -a - 0.2, 0, ridge)], 0)
	_plane([_p(f, a + 0.2, b + o, eave - drop), _p(f, -a - 0.2, b + o, eave - drop), _p(f, -a - 0.2, 0, ridge), _p(f, a + 0.2, 0, ridge)], 0)
	for s in [-1.0, 1.0]:
		_end_wall([_p(f, s * a, -b, eave), _p(f, s * a, b, eave), _p(f, s * a, 0, ridge)], _dir(f, s, 0))


func hip(f: Array, eave: float, pitch: float) -> void:
	var a: float = f[3]
	var b: float = f[4]
	var rise := tan(deg_to_rad(pitch)) * b
	var r0 := _p(f, -(a - b), 0, eave + rise)
	var r1 := _p(f, a - b, 0, eave + rise)
	var c := [_p(f, -a, -b, eave), _p(f, a, -b, eave), _p(f, a, b, eave), _p(f, -a, b, eave)]
	_plane([c[0], c[1], r1, r0], 0)
	_plane([c[2], c[3], r0, r1], 0)
	_plane([c[1], c[2], r1], b)
	_plane([c[3], c[0], r0], b)


func shed(f: Array, eave: float, pitch: float) -> void:
	var a: float = f[3]
	var b: float = f[4]
	var top := eave + tan(deg_to_rad(pitch)) * 2.0 * b
	_plane([_p(f, -a, -b, eave), _p(f, a, -b, eave), _p(f, a, b, top), _p(f, -a, b, top)], 0)
	_end_wall([_p(f, a, b, eave), _p(f, -a, b, eave), _p(f, -a, b, top), _p(f, a, b, top)], _dir(f, 0, 1))
	for s in [-1.0, 1.0]:
		_end_wall([_p(f, s * a, -b, eave), _p(f, s * a, b, eave), _p(f, s * a, b, top)], _dir(f, s, 0))


## "V" / butterfly: both sides high, valley along the middle.
func butterfly(f: Array, eave: float, pitch: float, valleys := 1) -> void:
	var a: float = f[3]
	var b: float = f[4]
	var n := valleys * 2
	var w := 2.0 * b / n
	var rise := tan(deg_to_rad(pitch)) * w
	for k in n:
		var t0 := -b + k * w
		var t1 := t0 + w
		var y0 := eave + (rise if k % 2 == 0 else 0.0)
		var y1 := eave + (0.0 if k % 2 == 0 else rise)
		_plane([_p(f, -a, t0, y0), _p(f, a, t0, y0), _p(f, a, t1, y1), _p(f, -a, t1, y1)], 0)
		for s in [-1.0, 1.0]:
			var hi_t := t0 if k % 2 == 0 else t1
			_end_wall([_p(f, s * a, t0, eave), _p(f, s * a, t1, eave), _p(f, s * a, hi_t, eave + rise)], _dir(f, s, 0))
	# side walls up to the high edges
	for s in [-1.0, 1.0]:
		_end_wall([_p(f, -a, s * b, eave), _p(f, a, s * b, eave), _p(f, a, s * b, eave + rise), _p(f, -a, s * b, eave + rise)], _dir(f, 0, s))


## Arched / barrel roof across the short side.
func barrel(f: Array, eave: float) -> void:
	var a: float = f[3]
	var b: float = f[4]
	var rise := b * 0.45
	var seg := 10
	var prev_t := -b
	var prev_y := eave
	var arc := []
	for k in range(seg + 1):
		var th := PI * k / seg
		arc.append([-b * cos(th), eave + rise * sin(th)])
	for k in seg:
		var t0: float = arc[k][0]
		var y0: float = arc[k][1]
		var t1: float = arc[k + 1][0]
		var y1: float = arc[k + 1][1]
		_plane([_p(f, -a, t0, y0), _p(f, a, t0, y0), _p(f, a, t1, y1), _p(f, -a, t1, y1)], 0)
	for s in [-1.0, 1.0]:
		var pts := []
		for q in arc:
			pts.append(_p(f, s * a, q[0], q[1]))
		_end_wall(pts, _dir(f, s, 0))


## Sawtooth: teeth along the long side, each a slope and a vertical glazed face (north light).
func sawtooth(f: Array, eave: float) -> void:
	var a: float = f[3]
	var b: float = f[4]
	var n := maxi(2, int(round(2.0 * a / 8.0)))
	var w := 2.0 * a / n
	var h := clampf(w * 0.45, 2.0, 4.5)
	for k in n:
		var s0 := -a + k * w
		var s1 := s0 + w
		_plane([_p(f, s0, b, eave), _p(f, s0, -b, eave), _p(f, s1, -b, eave + h), _p(f, s1, b, eave + h)], 0)
		# glazed vertical face: wall layer with the window pattern
		var face := [_p(f, s1, -b, eave), _p(f, s1, b, eave), _p(f, s1, b, eave + h), _p(f, s1, -b, eave + h)]
		var nrm := _dir(f, 1, 0)
		var L := 2.0 * b
		bf._quad(st, face, [Vector2(0, 0), Vector2(L, 0), Vector2(L, h), Vector2(0, h)], Vector2(4, L), Color(0.12, 0.0, h / 40.0, 0.5), nrm)
		for side in [-1.0, 1.0]:
			_end_wall([_p(f, s0, side * b, eave), _p(f, s1, side * b, eave), _p(f, s1, side * b, eave + h)], _dir(f, 0, side))


func mansard(f: Array, eave: float) -> void:
	var a: float = f[3]
	var b: float = f[4]
	var inset := minf(1.2, b * 0.3)
	var h1 := 2.6
	var c0 := [_p(f, -a, -b, eave), _p(f, a, -b, eave), _p(f, a, b, eave), _p(f, -a, b, eave)]
	var c1 := [_p(f, -a + inset, -b + inset, eave + h1), _p(f, a - inset, -b + inset, eave + h1), _p(f, a - inset, b - inset, eave + h1), _p(f, -a + inset, b - inset, eave + h1)]
	for k in 4:
		_plane([c0[k], c0[(k + 1) % 4], c1[(k + 1) % 4], c1[k]], 0)
	var f2 := [f[0], f[1], f[2], a - inset, b - inset]
	hip(f2, eave + h1, 18.0)


func _dir(f: Array, su: float, sv: float) -> Vector3:
	var d: Vector2 = f[1] * su + f[2] * sv
	return Vector3(d.x, 0, d.y).normalized()
