class_name SignField
extends Node3D
## Road signs, traffic lights and street lamps from world.json: OSM nodes (stop, give way, signals, crossings,
## traffic_sign) and the maxspeed of each road. Placed on the right-hand verge facing the traffic they address.
## Everything is instanced: poles, plates (sign atlas), signal heads and lamps are four MultiMeshes.

const SIGNS := ["stop", "give_way", "speed30", "speed50", "speed70", "speed90", "speed120", "crossing", "priority", "no_entry"]
const BE_SIGN := {"B1": "give_way", "B5": "stop", "B9": "priority", "C1": "no_entry", "F49": "crossing"}
const FAR := 900.0

var terrain: Terrain3D
var _segs := []          # [a, b, width, dir]
var _poles: Array[Transform3D] = []
var _plates: Array[Transform3D] = []
var _plate_idx: PackedFloat32Array = []
var _signals: Array[Transform3D] = []
var _lamps: Array[Transform3D] = []


func build_all(world: Dictionary, t: Terrain3D) -> void:
	terrain = t
	for r in world.get("roads", []):
		if r.surface != "paved" or r.tunnel:
			continue
		for i in r.p.size() - 1:
			var a := Vector2(r.p[i][0], r.p[i][1])
			var b := Vector2(r.p[i + 1][0], r.p[i + 1][1])
			if a.distance_to(b) > 0.5:
				_segs.append([a, b, float(r.width), (b - a).normalized()])
	for n in world.get("nodes", []):
		var p := Vector2(n.p[0], n.p[1])
		var k: String = n.k
		match k:
			"stop", "give_way":
				_sign_at_node(p, k)
			"zebra":
				_sign_at_node(p, "crossing", true)
			"signals":
				_signal_at_node(p)
			"lamp":
				_lamp(p)
			_:
				if k.begins_with("sign:"):
					var code := k.substr(5).split(";")[0].replace("BE:", "")
					var speed := code.find("C43[")
					if speed >= 0:
						_sign_at_node(p, "speed" + code.substr(speed + 4).split("]")[0])
					elif BE_SIGN.has(code):
						_sign_at_node(p, BE_SIGN[code])
	# speed limits at the start of long roads, both directions unless one-way
	for r in world.get("roads", []):
		var v = r.get("maxspeed")
		if v == null or r.p.size() < 2 or not SIGNS.has("speed%d" % int(v)):
			continue
		var line := RoadField.resample(r.p, 5.0)
		if line.size() < 30:
			continue
		_road_sign(line[4], (line[5] - line[4]).normalized(), float(r.width), "speed%d" % int(v))
		if not r.get("oneway", false):
			var m := line.size()
			_road_sign(line[m - 5], (line[m - 6] - line[m - 5]).normalized(), float(r.width), "speed%d" % int(v))
	_emit()
	print("SIGNS plates ", _plates.size(), " signals ", _signals.size(), " lamps ", _lamps.size())


func _nearest(p: Vector2) -> Array:
	var best := INF
	var out := []
	for s in _segs:
		var q := Geometry2D.get_closest_point_to_segment(p, s[0], s[1])
		var d := q.distance_to(p)
		if d < best:
			best = d
			out = [q, s[3], s[2]]
	return out if best < 12.0 else []


func _sign_at_node(p: Vector2, kind: String, both := false) -> void:
	var s := _nearest(p)
	if s.is_empty() or not SIGNS.has(kind):
		return
	_road_sign(s[0], s[1], s[2], kind)
	if both:
		_road_sign(s[0], -s[1], s[2], kind)


## Pole on the right verge of a carriageway travelling along d, plate facing the oncoming driver.
func _road_sign(q: Vector2, d: Vector2, width: float, kind: String) -> void:
	var right := Vector2(-d.y, d.x) * -1.0
	var at := q + right * (width * 0.5 + 0.9)
	var y := terrain.data.get_height(Vector3(at.x, 0, at.y))
	if is_nan(y):
		return
	var yaw := atan2(-d.x, -d.y)   # plate normal (+Z of the quad) points back along -d
	_poles.append(Transform3D(Basis(), Vector3(at.x, y + 1.25, at.y)))
	_plates.append(Transform3D(Basis(Vector3.UP, yaw), Vector3(at.x, y + 2.25, at.y) - Vector3(d.x, 0, d.y) * 0.05))
	_plate_idx.append(SIGNS.find(kind))


func _signal_at_node(p: Vector2) -> void:
	var s := _nearest(p)
	if s.is_empty():
		return
	for dir in [s[1], -s[1]]:
		var right := Vector2(-dir.y, dir.x) * -1.0
		var at: Vector2 = s[0] + right * (s[2] * 0.5 + 0.8)
		var y := terrain.data.get_height(Vector3(at.x, 0, at.y))
		if is_nan(y):
			continue
		var yaw := atan2(-dir.x, -dir.y)
		_poles.append(Transform3D(Basis().scaled(Vector3(1, 1.4, 1)), Vector3(at.x, y + 1.75, at.y)))
		_signals.append(Transform3D(Basis(Vector3.UP, yaw), Vector3(at.x, y + 3.1, at.y)))


func _lamp(p: Vector2) -> void:
	var y := terrain.data.get_height(Vector3(p.x, 0, p.y))
	if not is_nan(y):
		_lamps.append(Transform3D(Basis(), Vector3(p.x, y, p.y)))


func _emit() -> void:
	var pole := CylinderMesh.new()
	pole.top_radius = 0.035
	pole.bottom_radius = 0.035
	pole.height = 2.5
	pole.radial_segments = 6
	var pm := StandardMaterial3D.new()
	pm.albedo_color = Color(0.55, 0.56, 0.58)
	pm.metallic = 0.7
	pm.roughness = 0.45
	pole.material = pm
	_mm(pole, _poles, null, [])
	var plate := QuadMesh.new()
	plate.size = Vector2(0.7, 0.7)
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/sign.gdshader")
	sm.set_shader_parameter("atlas", load("res://assets/signs/signs.png"))
	sm.set_shader_parameter("count", float(SIGNS.size()))
	_mm(plate, _plates, sm, _plate_idx)
	# signal head: dark box with three lamps (green lit)
	var st := SurfaceTool.new()
	st.append_from(_box(Vector3(0.32, 0.95, 0.22)), 0, Transform3D())
	var head := st.commit()
	var hm := StandardMaterial3D.new()
	hm.albedo_color = Color(0.06, 0.06, 0.06)
	hm.roughness = 0.5
	head.surface_set_material(0, hm)
	_mm(head, _signals, null, [])
	var lights: Array[Transform3D] = []
	for x in _signals:
		lights.append(x * Transform3D(Basis(), Vector3(0, -0.28, 0.12)))
	var bulb := SphereMesh.new()
	bulb.radius = 0.09
	bulb.height = 0.18
	var bm := StandardMaterial3D.new()
	bm.albedo_color = Color(0.1, 0.9, 0.4)
	bm.emission_enabled = true
	bm.emission = Color(0.1, 1.0, 0.45)
	bm.emission_energy_multiplier = 3.0
	bulb.material = bm
	_mm(bulb, lights, null, [])
	# street lamps: 6 m pole + head
	var lp := CylinderMesh.new()
	lp.top_radius = 0.05
	lp.bottom_radius = 0.08
	lp.height = 6.0
	lp.radial_segments = 6
	lp.material = pm
	var lx: Array[Transform3D] = []
	for x in _lamps:
		lx.append(x * Transform3D(Basis(), Vector3(0, 3.0, 0)))
	_mm(lp, lx, null, [])


func _box(size: Vector3) -> ArrayMesh:
	var b := BoxMesh.new()
	b.size = size
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, b.get_mesh_arrays())
	return am


func _mm(mesh: Mesh, xs: Array, mat: Material, idx: PackedFloat32Array) -> void:
	if xs.is_empty():
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = not idx.is_empty()
	mm.mesh = mesh
	mm.instance_count = xs.size()
	for i in xs.size():
		mm.set_instance_transform(i, xs[i])
		if not idx.is_empty():
			mm.set_instance_custom_data(i, Color(idx[i], 0, 0, 0))
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	if mat:
		mi.material_override = mat
	mi.visibility_range_end = FAR
	add_child(mi)
