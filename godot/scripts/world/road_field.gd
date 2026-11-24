class_name RoadField
extends Node3D
## Roads, sidewalks with curbs, crossings and airport surfaces from world.json, draped on the relief every ~3 m,
## one mesh per 256 m cell. Widths, surface, sidewalks and paint come from the site parameters (OSM + photo).
## Layers (tools/godot/material_arrays.py ROAD): 0 asphalt, 1 gravel, 2 dirt, 3 grass, 4 paving, 5 concrete.

const CELL := 256.0
const STEP := 3.0
const FAR := 3500.0
const LAYER := {"paved": 0, "gravel": 1, "dirt": 2, "grass": 3}
# paint flags read by road.gdshader
const F_DASH := 1
const F_SOLID := 2
const F_EDGE := 4
const F_ZEBRA := 8
const F_RUNWAY := 16
const F_TAXI := 32
const F_LANES := 64
const CURB := 0.15

var terrain: Terrain3D
var count := 0
var sidewalks := 0
var crossings := 0
var _cells := {}
var _used := {}
var _segs := []      # [a, b, width, road] of paved roads, for snapping crossings


func build_all(world: Dictionary, t: Terrain3D) -> void:
	terrain = t
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/road.gdshader")
	mat.set_shader_parameter("alb", load("res://assets/buildings/road_alb.png"))
	mat.set_shader_parameter("nrm", load("res://assets/buildings/road_nrm.png"))
	var roads: Array = world.get("roads", [])
	roads.sort_custom(func(a, b): return a.width < b.width)
	for r in roads:
		if r.tunnel or (r["class"] in ["footway", "path", "steps", "cycleway", "bridleway"] and r.width < 1.6):
			continue
		_road(r)
	for n in world.get("nodes", []):
		if n.k == "zebra":
			_crossing(Vector2(n.p[0], n.p[1]))
	for a in world.get("aeroways", []):
		_aeroway(a)
	for c in _cells.keys():
		if not _used.has(c):
			continue
		var st: SurfaceTool = _cells[c]
		st.generate_tangents()
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.visibility_range_end = FAR
		add_child(mi)
	print("ROADS ", count, " sidewalks ", sidewalks, " crossings ", crossings, " cells ", _cells.size())


func _st(p: Vector2) -> Array:
	var c := Vector2i(floori(p.x / CELL), floori(p.y / CELL))
	if not _cells.has(c):
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		_cells[c] = st
	return [_cells[c], c]


func _h(p: Vector2) -> float:
	return terrain.data.get_height(Vector3(p.x, 0, p.y))


static func resample(pts: Array, step: float) -> PackedVector2Array:
	var line := PackedVector2Array()
	for i in pts.size() - 1:
		var a := Vector2(pts[i][0], pts[i][1])
		var b := Vector2(pts[i + 1][0], pts[i + 1][1])
		var n := maxi(1, int(ceil(a.distance_to(b) / step)))
		for k in n:
			line.append(a.lerp(b, float(k) / n))
	line.append(Vector2(pts[pts.size() - 1][0], pts[pts.size() - 1][1]))
	return line


## A strip between two lateral offsets of a line. heights: callable(centre_y, edge_ground_y) -> y.
## UV.x = 0..1 across the strip, UV.y = metres along; UV2 = (layer, flags); COLOR.r = strip width / 20, g = lanes / 10.
func _strip(line: PackedVector2Array, off0: float, off1: float, lift: float, layer: int, flags: int, lanes: float,
		fixed_y := NAN, bridge := false) -> void:
	var sc := _st(line[0])
	var st: SurfaceTool = sc[0]
	var c: Vector2i = sc[1]
	var w := absf(off1 - off0)
	var y_a := _h(line[0])
	var y_b := _h(line[line.size() - 1])
	var along := 0.0
	var prev := []
	for i in line.size():
		var p := line[i]
		var d := (line[mini(i + 1, line.size() - 1)] - line[maxi(i - 1, 0)]).normalized()
		var nrm2 := Vector2(-d.y, d.x)
		var p0 := p + nrm2 * off0
		var p1 := p + nrm2 * off1
		var y0: float
		var y1: float
		if not is_nan(fixed_y):
			y0 = fixed_y
			y1 = fixed_y
		elif bridge:
			y0 = lerpf(y_a, y_b, float(i) / maxf(line.size() - 1, 1)) + 0.6
			y1 = y0
		else:
			var yc := _h(p)
			y0 = maxf(_h(p0), yc - 0.3)
			y1 = maxf(_h(p1), yc - 0.3)
		if is_nan(y0) or is_nan(y1):
			return
		var A := Vector3(p0.x, y0 + lift, p0.y)
		var B := Vector3(p1.x, y1 + lift, p1.y)
		if i > 0:
			along += line[i].distance_to(line[i - 1])
			_quad(st, prev[0], prev[1], B, A, prev[2], along, layer, flags, w, lanes)
			_used[c] = true
		prev = [A, B, along]


func _quad(st: SurfaceTool, a0: Vector3, b0: Vector3, b1: Vector3, a1: Vector3, v0: float, v1: float,
		layer: int, flags: int, w: float, lanes: float) -> void:
	var n := (b0 - a0).cross(a1 - a0).normalized()
	if n.y < 0.0:
		n = -n
	var vs := [a0, b0, b1, a0, b1, a1]
	var uvs := [Vector2(0, v0), Vector2(1, v0), Vector2(1, v1), Vector2(0, v0), Vector2(1, v1), Vector2(0, v1)]
	for tri in [[0, 1, 2], [3, 4, 5]]:
		var a: Vector3 = vs[tri[0]]
		var o := [0, 1, 2] if (vs[tri[1]] - a).cross(vs[tri[2]] - a).dot(n) < 0.0 else [0, 2, 1]
		for k in o:
			st.set_normal(n)
			st.set_uv(uvs[tri[k]])
			st.set_uv2(Vector2(layer, flags))
			st.set_color(Color(w / 20.0, lanes / 10.0, 0, 0))
			st.add_vertex(vs[tri[k]])


func _road(r: Dictionary) -> void:
	var line := resample(r.p, STEP)
	if line.size() < 2:
		return
	var w: float = clampf(r.width, 1.5, 30.0)
	var layer: int = LAYER.get(r.surface, 0)
	var flags := 0
	if layer == 0:
		if r.get("centre") == "dashed":
			flags |= F_DASH
		elif r.get("centre") == "solid":
			flags |= F_SOLID
		if r.get("edge", false):
			flags |= F_EDGE
		var lanes = r.get("lanes")
		if lanes != null and lanes >= 2 and r.get("oneway", false):
			flags |= F_LANES
	var lanes_n: float = r.get("lanes") if r.get("lanes") != null else 0.0
	var lift := 0.10 + w * 0.003      # wider roads slightly above narrower ones at junctions
	_strip(line, -w * 0.5, w * 0.5, lift, layer, flags, lanes_n, NAN, r.bridge)
	if layer == 0:
		for i in line.size() - 1:
			_segs.append([line[i], line[i + 1], w])
	# sidewalks: paving 15 cm above the road with a concrete curb face
	var side: String = r.get("sidewalk", "none")
	if side != "none" and not r.bridge:
		var sw: float = clampf(r.get("sidewalk_w", 1.8), 1.0, 4.0)
		for s in ([-1.0, 1.0] if side == "both" else ([1.0] if side == "left" else [-1.0])):
			var e: float = s * w * 0.5
			_strip(line, e, e + s * sw, lift + CURB, 4, 0, 0.0)
			_curb(line, e, lift, s)
			sidewalks += 1
	count += 1


## Vertical curb face along the road edge, from road level up to the sidewalk.
func _curb(line: PackedVector2Array, off: float, lift: float, s: float) -> void:
	var sc := _st(line[0])
	var st: SurfaceTool = sc[0]
	var along := 0.0
	var prev := []
	for i in line.size():
		var p := line[i]
		var d := (line[mini(i + 1, line.size() - 1)] - line[maxi(i - 1, 0)]).normalized()
		var q := p + Vector2(-d.y, d.x) * off
		var y := maxf(_h(q), _h(p) - 0.3)
		if is_nan(y):
			return
		var lo := Vector3(q.x, y + lift - 0.05, q.y)
		var hi := Vector3(q.x, y + lift + CURB, q.y)
		if i > 0:
			along += line[i].distance_to(line[i - 1])
			var n := Vector3(-d.y, 0, d.x) * -s
			var vs := [prev[0], lo, hi, prev[0], hi, prev[1]]
			var uvs := [Vector2(0, prev[2]), Vector2(0, along), Vector2(1, along), Vector2(0, prev[2]), Vector2(1, along), Vector2(1, prev[2])]
			for tri in [[0, 1, 2], [3, 4, 5]]:
				var a: Vector3 = vs[tri[0]]
				var o := [0, 1, 2] if (vs[tri[1]] - a).cross(vs[tri[2]] - a).dot(n) < 0.0 else [0, 2, 1]
				for k in o:
					st.set_normal(n)
					st.set_uv(uvs[tri[k]])
					st.set_uv2(Vector2(5, 0))
					st.set_color(Color(0.01, 0, 0, 0))
					st.add_vertex(vs[tri[k]])
		prev = [lo, hi, along]


## Zebra crossing at an OSM crossing node: stripes across the nearest paved road, 4 m wide.
func _crossing(p: Vector2) -> void:
	var best := INF
	var seg := []
	for s in _segs:
		var q := Geometry2D.get_closest_point_to_segment(p, s[0], s[1])
		var d := q.distance_to(p)
		if d < best:
			best = d
			seg = [q, (s[1] - s[0]).normalized(), s[2]]
	if best > 6.0 or seg.is_empty():
		return
	var q: Vector2 = seg[0]
	var d: Vector2 = seg[1]
	var w: float = seg[2]
	var n := Vector2(-d.y, d.x)
	var line := PackedVector2Array([q - n * w * 0.5, q + n * w * 0.5])
	_strip(line, -2.0, 2.0, 0.10 + w * 0.003 + 0.015, 0, F_ZEBRA, 0.0)
	crossings += 1


func _aeroway(a: Dictionary) -> void:
	var k: String = a.k
	if k in ["runway", "taxiway", "taxilane", "stopway"]:
		var line := resample(a.p, 6.0)
		var w: float = a.width
		var flags := F_RUNWAY if k == "runway" else F_TAXI
		_strip(line, -w * 0.5, w * 0.5, 0.12, 5 if String(a.surface) == "concrete" else 0, flags, 0.0)
	elif k == "apron" and a.p.size() >= 3:
		var pts := PackedVector2Array()
		for q in a.p:
			pts.append(Vector2(q[0], q[1]))
		var tri := Geometry2D.triangulate_polygon(pts)
		var sc := _st(pts[0])
		var st: SurfaceTool = sc[0]
		for i in range(0, tri.size(), 3):
			for j in [0, 2, 1]:
				var q := pts[tri[i + j]]
				st.set_normal(Vector3.UP)
				st.set_uv(q / 20.0)
				st.set_uv2(Vector2(5, 0))
				st.set_color(Color(0.05, 0, 0, 0))
				st.add_vertex(Vector3(q.x, _h(q) + 0.1, q.y))
		_used[sc[1]] = true
