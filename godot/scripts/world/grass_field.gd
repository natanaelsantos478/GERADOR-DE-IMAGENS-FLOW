class_name GrassField
extends Node3D
## Grass clumps in 32 m cells around the camera, only where the land cover says grass with confidence.
## Dense up to 60 m, sparse up to 150 m; cells are built a few per frame as the camera moves.

const CELL := 32.0
const NEAR := 45.0
const FAR := 120.0
const NEAR_SPACING := 0.3
const FAR_SPACING := 0.75

var terrain: Terrain3D
var pack: BattlePack
var focus: Node3D
var _cells := {}          # Vector2i -> MultiMeshInstance3D
var _dense := {}          # Vector2i -> bool
var _mesh: ArrayMesh
var _mesh_far: ArrayMesh
var _mat: ShaderMaterial
var _lc: PackedByteArray
var _tint: PackedByteArray
var _lc_n := 0
var _tint_n := 0

# grass tone per land cover class (BattlePack.LandCover); alpha = density 0..1
const TONE := {
	1: Color(0.30, 0.44, 0.15, 1.0),   # meadow
	2: Color(0.33, 0.47, 0.16, 1.0),   # green crop
	3: Color(0.62, 0.55, 0.33, 0.4),   # dry crop / stubble
	4: Color(0.40, 0.40, 0.24, 0.12),  # bare soil
	0: Color(0.34, 0.42, 0.2, 0.4),    # unknown
	5: Color(0.26, 0.36, 0.14, 0.2),   # broadleaf wood: sparse undergrowth
}


func setup(p: BattlePack, t: Terrain3D, f: Node3D) -> void:
	pack = p
	terrain = t
	focus = f
	_lc = p.landcover.get_data()
	_lc_n = p.landcover.get_width()
	_tint = p.tint.get_data()
	_tint_n = p.tint.get_width()
	_mesh = _clump_mesh(14)
	_mesh_far = _clump_mesh(6)
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://shaders/grass.gdshader")
	_mat.set_shader_parameter("fade_start", FAR - 40.0)
	_mat.set_shader_parameter("fade_end", FAR)


## Build every cell around the focus now (loading screen).
func build_all() -> void:
	for c in _wanted():
		_build(c, _is_dense(c))


func _process(_dt: float) -> void:
	if not focus:
		return
	var want := _wanted()
	var budget := 3
	for c in want:
		var dense := _is_dense(c)
		if (not _cells.has(c) or _dense.get(c) != dense) and budget > 0:
			_build(c, dense)
			budget -= 1
	for c in _cells.keys():
		if not want.has(c):
			_cells[c].queue_free()
			_cells.erase(c)
			_dense.erase(c)


func _wanted() -> Dictionary:
	var out := {}
	var p := focus.global_position
	var r := int(ceil(FAR / CELL))
	var c0 := Vector2i(floori(p.x / CELL), floori(p.z / CELL))
	for j in range(-r, r + 1):
		for i in range(-r, r + 1):
			var c := c0 + Vector2i(i, j)
			var centre := Vector2((c.x + 0.5) * CELL, (c.y + 0.5) * CELL)
			if centre.distance_to(Vector2(p.x, p.z)) < FAR + CELL * 0.7:
				out[c] = true
	return out


func _is_dense(c: Vector2i) -> bool:
	var p := focus.global_position
	return Vector2((c.x + 0.5) * CELL, (c.y + 0.5) * CELL).distance_to(Vector2(p.x, p.z)) < NEAR + CELL * 0.7


func _build(c: Vector2i, dense: bool) -> void:
	if _cells.has(c):
		_cells[c].queue_free()
	var spacing := NEAR_SPACING if dense else FAR_SPACING
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(c)
	var xs: Array[Transform3D] = []
	var cols: Array[Color] = []
	var steps := int(CELL / spacing)
	for j in steps:
		for i in steps:
			var x := (c.x * CELL) + (i + rng.randf()) * spacing
			var z := (c.y * CELL) + (j + rng.randf()) * spacing
			var lc := _lc_at(x, z)
			var tone: Color = TONE.get(int(lc.x), Color(0, 0, 0, 0))
			if tone.a <= 0.0 or rng.randf() > tone.a * (0.35 + 0.65 * lc.y):
				continue
			var y := terrain.data.get_height(Vector3(x, 0, z))
			if is_nan(y):
				continue
			var s := rng.randf_range(0.7, 1.25) * (1.0 if dense else 1.35)
			var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.8, 1.3), s))
			xs.append(Transform3D(b, Vector3(x, y - 0.03, z)))
			cols.append(tone * _tint_at(x, z) * rng.randf_range(0.85, 1.1))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = _mesh if dense else _mesh_far
	mm.instance_count = xs.size()
	for k in xs.size():
		mm.set_instance_transform(k, xs[k])
		mm.set_instance_color(k, cols[k])
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = _mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# a high camera skips the whole cell instead of drawing millions of faded blades
	mi.visibility_range_end = FAR + CELL
	mi.visibility_range_end_margin = 10.0
	add_child(mi)
	_cells[c] = mi
	_dense[c] = dense


func _lc_at(x: float, z: float) -> Vector2:
	var u := clampi(int((x / pack.span_m + 0.5) * _lc_n), 0, _lc_n - 1)
	var v := clampi(int((z / pack.span_m + 0.5) * _lc_n), 0, _lc_n - 1)
	var i := (v * _lc_n + u) * 3
	return Vector2(_lc[i], _lc[i + 1] / 255.0)


func _tint_at(x: float, z: float) -> Color:
	var u := clampi(int((x / pack.span_m + 0.5) * _tint_n), 0, _tint_n - 1)
	var v := clampi(int((z / pack.span_m + 0.5) * _tint_n), 0, _tint_n - 1)
	var i := (v * _tint_n + u) * 4
	var t := Color(_tint[i] / 255.0, _tint[i + 1] / 255.0, _tint[i + 2] / 255.0)
	# keep the hue variation of the photo but not its darkness
	var l := maxf((t.r + t.g + t.b) / 3.0, 0.05)
	return Color(t.r / l, t.g / l, t.b / l).lerp(Color.WHITE, 0.55)


## Fourteen thin bent blades 0.12-0.4 m, two segments each. UV.y = 0 root, 1 tip; UV.x = per-blade shade.
static func _clump_mesh(blades: int) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	for k in blades:
		var a := rng.randf() * TAU
		var r := rng.randf_range(0.0, 0.14)
		var root := Vector3(cos(a) * r, 0, sin(a) * r)
		var h := rng.randf_range(0.12, 0.4)
		var w := rng.randf_range(0.007, 0.014)
		var shade := rng.randf()
		var face := rng.randf() * TAU
		var side := Vector3(cos(face), 0, sin(face)) * w
		var lean := Vector3(-sin(face), 0, cos(face)) * rng.randf_range(0.05, 0.16)
		var n := Vector3(-sin(face), 0.4, cos(face)).normalized()
		var p0a := root - side
		var p0b := root + side
		var mid := root + Vector3(0, h * 0.55, 0) + lean * 0.35
		var p1a := mid - side * 0.65
		var p1b := mid + side * 0.65
		var tip := root + Vector3(0, h, 0) + lean
		for tri in [[p0a, 0.0, p0b, 0.0, p1b, 0.55], [p0a, 0.0, p1b, 0.55, p1a, 0.55], [p1a, 0.55, p1b, 0.55, tip, 1.0]]:
			for q in 3:
				st.set_normal(n)
				st.set_uv(Vector2(shade, tri[q * 2 + 1]))
				st.add_vertex(tri[q * 2])
	return st.commit()
