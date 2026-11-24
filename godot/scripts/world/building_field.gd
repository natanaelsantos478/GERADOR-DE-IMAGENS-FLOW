class_name BuildingField
extends Node3D
## 3D buildings from the OSM footprints of the pack (world.json): walls extruded on the real relief,
## gable / hip / flat roofs by type and size. One mesh + one material per 256 m cell (Texture2DArray,
## windows drawn by the shader) and an occluder per cell so hidden geometry behind houses is skipped.

const CELL := 256.0
const FAR := 6000.0

enum Wall { STONE, SANDSTONE, BRICK, PLASTER, CONCRETE, CORRUGATED }
enum Roof { SLATE = 6, TILES = 7, SHEET = 8, FLAT = 9 }

var terrain: Terrain3D
var count := 0
var tris := 0
var _cells := {}
var _density := {}


func build_all(world: Dictionary, t: Terrain3D) -> void:
	terrain = t
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/building.gdshader")
	mat.set_shader_parameter("alb", load("res://assets/buildings/building_alb.png"))
	mat.set_shader_parameter("nrm", load("res://assets/buildings/building_nrm.png"))
	var list: Array = world.get("buildings", [])
	for b in list:
		var c := _cell_of(b.p[0])
		_density[c] = _density.get(c, 0) + 1
	for b in list:
		_building(b)
	for c in _cells.keys():
		var cell: Dictionary = _cells[c]
		var st: SurfaceTool = cell.st
		st.generate_tangents()
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		mi.visibility_range_end = FAR
		mi.visibility_range_end_margin = 200.0
		mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
		add_child(mi)
		if cell.occ_i.size() > 0:
			var occ := ArrayOccluder3D.new()
			occ.set_arrays(cell.occ_v, cell.occ_i)
			var oi := OccluderInstance3D.new()
			oi.occluder = occ
			add_child(oi)
	print("BUILDINGS ", count, " tris ", tris, " cells ", _cells.size())


func _cell_of(p: Array) -> Vector2i:
	return Vector2i(floori(p[0] / CELL), floori(p[1] / CELL))


func _cell(c: Vector2i) -> Dictionary:
	if not _cells.has(c):
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		_cells[c] = {"st": st, "occ_v": PackedVector3Array(), "occ_i": PackedInt32Array()}
	return _cells[c]


func _building(b: Dictionary) -> void:
	var pts := PackedVector2Array()
	for p in b.p:
		var v := Vector2(p[0], p[1])
		if pts.is_empty() or pts[pts.size() - 1].distance_to(v) > 0.3:
			pts.append(v)
	if pts.size() > 3 and pts[0].distance_to(pts[pts.size() - 1]) < 0.3:
		pts.remove_at(pts.size() - 1)
	pts = _simplify(pts)
	if pts.size() < 3:
		return
	var area := absf(_area(pts))
	if area < 8.0:
		return
	var centre := Vector2.ZERO
	for p in pts:
		centre += p
	centre /= pts.size()
	var lo := INF
	var hi := -INF
	for p in pts:
		var h := terrain.data.get_height(Vector3(p.x, 0, p.y))
		if is_nan(h):
			return
		lo = minf(lo, h)
		hi = maxf(hi, h)
	var c := _cell_of([pts[0].x, pts[0].y])
	var dense: bool = _density.get(c, 0) > 70
	var spec := _spec(b, area, dense, hash(Vector2i(int(centre.x * 10), int(centre.y * 10))))
	var base := lo - 0.6
	var eave: float = hi + float(spec.height)
	var found: float = hi - base
	var rect := _rectangle(pts) if pts.size() == 4 else 0.0
	var roof: String = spec.roof
	if roof == "gable" and rect < 0.88:
		roof = "hip" if area < 320.0 else "flat"
	if roof == "hip" and area >= 320.0:
		roof = "flat"
	var top: float = eave + (0.5 if roof == "flat" else 0.0)
	var cell := _cell(c)
	var st: SurfaceTool = cell.st
	var col := Color(spec.floor_h / 10.0 if spec.windows else 0.0, found / 10.0, (eave - base) / 40.0, spec.tint)
	# walls
	for i in pts.size():
		var a := pts[i]
		var bb := pts[(i + 1) % pts.size()]
		var n := _outward(a, bb, centre)
		var L := a.distance_to(bb)
		var A0 := Vector3(a.x, base, a.y)
		var B0 := Vector3(bb.x, base, bb.y)
		var A1 := Vector3(a.x, top, a.y)
		var B1 := Vector3(bb.x, top, bb.y)
		_quad(st, [A0, B0, B1, A1], [Vector2(0, 0), Vector2(L, 0), Vector2(L, top - base), Vector2(0, top - base)], Vector2(spec.wall, L), col, n)
		_occluder(cell, [A0, B0, B1, A1], area)
	# roof
	var rcol := Color(0, found / 10.0, (eave - base) / 40.0, spec.tint)
	match roof:
		"gable":
			_gable(st, pts, eave, base, spec, col, rcol)
		"hip":
			var apex := Vector3(centre.x, eave + clampf(sqrt(area) * 0.35, 1.5, 6.0), centre.y)
			for i in pts.size():
				var a := pts[i]
				var bb := pts[(i + 1) % pts.size()]
				var A := Vector3(a.x, eave, a.y)
				var B := Vector3(bb.x, eave, bb.y)
				var nrm := (B - A).cross(apex - A).normalized()
				if nrm.y < 0.0:
					nrm = -nrm
				var L := a.distance_to(bb)
				_tri(st, [A, B, apex], [Vector2(0, 0), Vector2(L, 0), Vector2(L * 0.5, A.distance_to(apex))], Vector2(spec.roof_layer, L), rcol, nrm)
		_:
			var poly := Geometry2D.triangulate_polygon(pts)
			for k in range(0, poly.size(), 3):
				var tri_p := [pts[poly[k]], pts[poly[k + 1]], pts[poly[k + 2]]]
				var vs := []
				var uvs := []
				for p in tri_p:
					vs.append(Vector3(p.x, eave + 0.1, p.y))
					uvs.append(p)
				_tri(st, vs, uvs, Vector2(Roof.FLAT if spec.roof_layer != Roof.SHEET else Roof.SHEET, 0), rcol, Vector3.UP)
	count += 1


## Gable roof on a near-rectangular footprint, ridge along the long side, 35 cm eave overhang.
func _gable(st: SurfaceTool, p: PackedVector2Array, eave: float, base: float, spec: Dictionary, col: Color, rcol: Color) -> void:
	var o := 0 if p[0].distance_to(p[1]) >= p[1].distance_to(p[2]) else 1
	var A := p[o]
	var B := p[(o + 1) % 4]
	var C := p[(o + 2) % 4]
	var D := p[(o + 3) % 4]
	var half := B.distance_to(C) * 0.5
	var rise := tan(deg_to_rad(spec.pitch)) * half
	var Ra := (D + A) * 0.5
	var Rb := (B + C) * 0.5
	var ridge := eave + rise
	var over := 0.35
	var drop := tan(deg_to_rad(spec.pitch)) * over
	for side in [[A, B, Ra, Rb], [C, D, Rb, Ra]]:
		var e0: Vector2 = side[0]
		var e1: Vector2 = side[1]
		var r0: Vector2 = side[2]
		var r1: Vector2 = side[3]
		var out := ((e0 + e1) * 0.5 - (r0 + r1) * 0.5).normalized() * over
		var E0 := Vector3(e0.x + out.x, eave - drop, e0.y + out.y)
		var E1 := Vector3(e1.x + out.x, eave - drop, e1.y + out.y)
		var R1 := Vector3(r1.x, ridge, r1.y)
		var R0 := Vector3(r0.x, ridge, r0.y)
		var nrm := (E1 - E0).cross(R0 - E0).normalized()
		if nrm.y < 0.0:
			nrm = -nrm
		var L := e0.distance_to(e1)
		var S := E0.distance_to(R0)
		_quad(st, [E0, E1, R1, R0], [Vector2(0, 0), Vector2(L, 0), Vector2(L, S), Vector2(0, S)], Vector2(spec.roof_layer, L), rcol, nrm)
	# gable ends (wall material, no windows above the eave)
	var wcol := Color(0, col.g, col.b, col.a)
	for end in [[B, C, Rb], [D, A, Ra]]:
		var e0: Vector2 = end[0]
		var e1: Vector2 = end[1]
		var r: Vector2 = end[2]
		var n := _outward(e0, e1, (A + B + C + D) * 0.25)
		var L := e0.distance_to(e1)
		var h0 := eave - base
		_tri(st, [Vector3(e0.x, eave, e0.y), Vector3(e1.x, eave, e1.y), Vector3(r.x, ridge, r.y)],
			[Vector2(0, h0), Vector2(L, h0), Vector2(L * 0.5, h0 + rise)], Vector2(spec.wall, L), wcol, n)


## Height, roof and materials from the OSM type, size and how dense the neighbourhood is.
func _spec(b: Dictionary, area: float, dense: bool, h: int) -> Dictionary:
	var r := func(k: int) -> float: return float((h >> k) & 255) / 255.0
	var kind: String = b.get("kind", "yes")
	var levels = b.get("levels")
	var s := {"windows": true, "floor_h": 2.9, "pitch": 42.0, "roof": "gable", "tint": r.call(0),
		"wall": Wall.PLASTER, "roof_layer": Roof.SLATE if r.call(8) < 0.8 else Roof.TILES}
	var rw: float = r.call(16)
	s.wall = Wall.STONE if rw < 0.3 else (Wall.SANDSTONE if rw < 0.45 else (Wall.BRICK if rw < 0.65 else Wall.PLASTER))
	var lv := 2.0
	if kind in ["shed", "garage", "garages", "hut", "carport", "roof"] or area < 35.0:
		s.merge({"windows": false, "wall": Wall.CORRUGATED if r.call(4) < 0.5 else Wall.CONCRETE,
			"roof_layer": Roof.SHEET, "pitch": 18.0}, true)
		s.height = 2.7
		return s
	if kind in ["industrial", "warehouse", "manufacture"] or area > 1500.0:
		s.merge({"windows": false, "wall": Wall.CORRUGATED if r.call(4) < 0.6 else Wall.CONCRETE,
			"roof": "flat", "roof_layer": Roof.SHEET if r.call(12) < 0.5 else Roof.FLAT}, true)
		s.height = 8.0 + r.call(20) * 3.0
		return s
	if kind in ["farm_auxiliary", "barn", "cowshed", "stable"] or (not dense and area > 300.0):
		s.merge({"windows": false, "wall": Wall.CORRUGATED if r.call(4) < 0.5 else Wall.STONE,
			"roof_layer": Roof.SHEET if r.call(12) < 0.6 else Roof.SLATE, "pitch": 22.0}, true)
		s.height = 6.0
		return s
	if kind in ["church", "chapel", "cathedral"]:
		s.merge({"wall": Wall.STONE, "roof_layer": Roof.SLATE, "pitch": 50.0, "windows": false}, true)
		s.height = 9.0 if kind == "chapel" else 14.0
		return s
	if kind in ["apartments", "school", "hospital", "office", "commercial", "retail", "hotel", "public", "civic"]:
		lv = 3.0 if kind in ["school", "retail"] else 4.0
		s.floor_h = 3.2
		s.roof = "flat" if area > 400.0 else "gable"
		if r.call(4) < 0.4:
			s.wall = Wall.CONCRETE
	elif dense:
		lv = 3.0
	if levels != null:
		lv = clampf(float(levels), 1.0, 20.0)
	s.height = lv * s.floor_h + 0.3
	return s


func _quad(st: SurfaceTool, v: Array, uv: Array, uv2: Vector2, col: Color, n: Vector3) -> void:
	_tri(st, [v[0], v[1], v[2]], [uv[0], uv[1], uv[2]], uv2, col, n)
	_tri(st, [v[0], v[2], v[3]], [uv[0], uv[2], uv[3]], uv2, col, n)


func _tri(st: SurfaceTool, v: Array, uv: Array, uv2: Vector2, col: Color, n: Vector3) -> void:
	# front faces clockwise as seen from the normal side (Godot convention)
	var order := [0, 1, 2]
	if (v[1] - v[0]).cross(v[2] - v[0]).dot(n) > 0.0:
		order = [0, 2, 1]
	for k in order:
		st.set_normal(n)
		st.set_uv(uv[k])
		st.set_uv2(uv2)
		st.set_color(col)
		st.add_vertex(v[k])
	tris += 1


func _occluder(cell: Dictionary, q: Array, area: float) -> void:
	if area < 40.0:
		return
	var i0: int = cell.occ_v.size()
	for v in q:
		cell.occ_v.append(v)
	cell.occ_i.append_array(PackedInt32Array([i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3]))


static func _outward(a: Vector2, b: Vector2, centre: Vector2) -> Vector3:
	var d := (b - a).normalized()
	var n := Vector2(d.y, -d.x)
	if n.dot((a + b) * 0.5 - centre) < 0.0:
		n = -n
	return Vector3(n.x, 0, n.y)


static func _area(p: PackedVector2Array) -> float:
	var s := 0.0
	for i in p.size():
		var a := p[i]
		var b := p[(i + 1) % p.size()]
		s += a.x * b.y - b.x * a.y
	return s * 0.5


## Drops nearly collinear vertices (OSM footprints often have them).
static func _simplify(p: PackedVector2Array) -> PackedVector2Array:
	var out := p
	var changed := true
	while changed and out.size() > 3:
		changed = false
		for i in out.size():
			var a := out[(i - 1 + out.size()) % out.size()]
			var b := out[i]
			var c := out[(i + 1) % out.size()]
			if absf((b - a).normalized().cross((c - b).normalized())) < 0.06:
				out.remove_at(i)
				changed = true
				break
	return out


## Area / oriented-bounding-box area (1 = perfect rectangle).
static func _rectangle(p: PackedVector2Array) -> float:
	var best := INF
	for i in p.size():
		var d := (p[(i + 1) % p.size()] - p[i]).normalized()
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
		best = minf(best, (a1 - a0) * (b1 - b0))
	return absf(_area(p)) / maxf(best, 0.01)
