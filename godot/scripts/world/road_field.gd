class_name RoadField
extends Node3D
## Road ribbons from world.json, draped on the relief every ~3 m, one mesh per 256 m cell.
## Surface layers match tools/godot/material_arrays.py ROAD: paved, gravel, dirt, grass.

const CELL := 256.0
const STEP := 3.0
const FAR := 3500.0
const LAYER := {"paved": 0, "gravel": 1, "dirt": 2, "grass": 3}
const MAJOR := ["motorway", "trunk", "primary", "secondary", "tertiary"]

var terrain: Terrain3D
var count := 0
var _cells := {}


func build_all(world: Dictionary, t: Terrain3D) -> void:
	terrain = t
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/road.gdshader")
	mat.set_shader_parameter("alb", load("res://assets/buildings/road_alb.png"))
	mat.set_shader_parameter("nrm", load("res://assets/buildings/road_nrm.png"))
	var roads: Array = world.get("roads", [])
	roads.sort_custom(func(a, b): return a.width < b.width)
	for r in roads:
		if r.tunnel or r["class"] in ["footway", "path", "steps", "cycleway", "bridleway"] and r.width < 1.6:
			continue
		_road(r)
	for c in _cells.keys():
		var st: SurfaceTool = _cells[c]
		st.generate_tangents()
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.visibility_range_end = FAR
		add_child(mi)
	print("ROADS ", count, " cells ", _cells.size())


func _road(r: Dictionary) -> void:
	# resample the line every STEP metres
	var line := PackedVector2Array()
	for i in r.p.size() - 1:
		var a := Vector2(r.p[i][0], r.p[i][1])
		var b := Vector2(r.p[i + 1][0], r.p[i + 1][1])
		var n := maxi(1, int(ceil(a.distance_to(b) / STEP)))
		for k in n:
			line.append(a.lerp(b, float(k) / n))
	line.append(Vector2(r.p[r.p.size() - 1][0], r.p[r.p.size() - 1][1]))
	if line.size() < 2:
		return
	var w: float = clampf(r.width, 1.5, 20.0)
	var layer: int = LAYER.get(r.surface, 0)
	var flags := 1.0 if layer == 0 and r["class"] in MAJOR else 0.0
	var lift := 0.12 + w * 0.004  # wider roads drawn slightly above narrower ones at junctions
	var c := Vector2i(floori(line[0].x / CELL), floori(line[0].y / CELL))
	if not _cells.has(c):
		var st0 := SurfaceTool.new()
		st0.begin(Mesh.PRIMITIVE_TRIANGLES)
		_cells[c] = st0
	var st: SurfaceTool = _cells[c]
	var y_a := terrain.data.get_height(Vector3(line[0].x, 0, line[0].y))
	var y_b := terrain.data.get_height(Vector3(line[line.size() - 1].x, 0, line[line.size() - 1].y))
	var along := 0.0
	var prev_l := Vector3.ZERO
	var prev_r := Vector3.ZERO
	var prev_v := 0.0
	for i in line.size():
		var p := line[i]
		var d := (line[mini(i + 1, line.size() - 1)] - line[maxi(i - 1, 0)]).normalized()
		var side := Vector2(-d.y, d.x) * (w * 0.5)
		var pl := p + side
		var pr := p - side
		var yl: float
		var yr: float
		if r.bridge:
			var t := float(i) / (line.size() - 1)
			yl = lerpf(y_a, y_b, t) + 0.6
			yr = yl
		else:
			# both edges on the ground, but never lower than the centre: no road buried in a bank
			var yc := terrain.data.get_height(Vector3(p.x, 0, p.y))
			yl = maxf(terrain.data.get_height(Vector3(pl.x, 0, pl.y)), yc - 0.3)
			yr = maxf(terrain.data.get_height(Vector3(pr.x, 0, pr.y)), yc - 0.3)
		if is_nan(yl) or is_nan(yr):
			return
		var L := Vector3(pl.x, yl + lift, pl.y)
		var R := Vector3(pr.x, yr + lift, pr.y)
		if i > 0:
			along += line[i].distance_to(line[i - 1])
			var n := (prev_r - prev_l).cross(L - prev_l).normalized()
			if n.y < 0.0:
				n = -n
			var vs := [prev_l, prev_r, R, prev_l, R, L]
			var uvs := [Vector2(0, prev_v), Vector2(1, prev_v), Vector2(1, along), Vector2(0, prev_v), Vector2(1, along), Vector2(0, along)]
			for tri in [[0, 1, 2], [3, 4, 5]]:
				var a: Vector3 = vs[tri[0]]
				var o := [0, 1, 2] if (vs[tri[1]] - a).cross(vs[tri[2]] - a).dot(n) < 0.0 else [0, 2, 1]
				for k in o:
					st.set_normal(n)
					st.set_uv(uvs[tri[k]])
					st.set_uv2(Vector2(layer, flags))
					st.set_color(Color(w / 20.0, 0, 0))
					st.add_vertex(vs[tri[k]])
		prev_l = L
		prev_r = R
		prev_v = along
	count += 1
