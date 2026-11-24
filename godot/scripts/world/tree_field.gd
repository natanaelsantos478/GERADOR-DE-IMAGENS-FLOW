class_name TreeField
extends Node3D
## Woods from the land cover: every tree of the field is placed once at load (256 m cells).
## Cells near the camera draw the 3D models (with shadows); the others draw crossed-quad impostors.
## Trees: godot/assets/trees (tools/models/arvores/preparar_arvores.py).

const CELL := 256.0
const NEAR := 600.0          # cell-centre distance under which the 3D models are used
const FAR := 7000.0

# land cover class -> [[tree type, spacing m, probability x confidence], ...]
const PLANTING := {
	BattlePack.LandCover.CONIFER: [["conifer", 6.0, 0.95], ["under", 14.0, 0.25]],
	BattlePack.LandCover.BROADLEAF: [["broadleaf", 8.0, 0.9], ["conifer", 16.0, 0.25], ["under", 9.0, 0.5]],
	BattlePack.LandCover.UNKNOWN: [["broadleaf", 30.0, 0.18], ["under", 25.0, 0.2]],
	BattlePack.LandCover.MEADOW: [["broadleaf", 90.0, 0.08]],
}
# relative weight of each model inside its group (the detailed hero models are rarer)
const WEIGHT := {"c_pine_hero": 0.35, "b_beech": 0.5}

var pack: BattlePack
var terrain: Terrain3D
var focus: Node3D
var names: Array[String] = []
var meta := {}
var meshes: Array[Mesh] = []
var groups := {}             # "conifer" -> [indices], with weights
var cells := {}              # Vector2i -> {idx: PackedInt32Array, xf: Array[Transform3D]}
var _near := {}              # Vector2i -> Array[MultiMeshInstance3D]
var _far := {}               # Vector2i -> MultiMeshInstance3D
var _imp_mesh: ArrayMesh
var _imp_mat: ShaderMaterial
var count := 0


func setup(p: BattlePack, t: Terrain3D, f: Node3D) -> void:
	pack = p
	terrain = t
	focus = f
	meta = JSON.parse_string(FileAccess.get_file_as_string("res://assets/trees/trees.json"))
	var scene: Node = (load("res://assets/trees/trees.glb") as PackedScene).instantiate()
	for n in meta.keys():
		var mi := scene.find_child(n, true, false) as MeshInstance3D
		if mi == null:
			push_warning("tree model missing: " + n)
			continue
		var m := mi.mesh.duplicate() as Mesh
		for s in m.get_surface_count():
			var mat := m.surface_get_material(s)
			if mat is StandardMaterial3D:
				mat = mat.duplicate()
				mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				mat.alpha_scissor_threshold = 0.45
				mat.cull_mode = BaseMaterial3D.CULL_DISABLED
				mat.roughness = 0.9
				m.surface_set_material(s, mat)
		names.append(n)
		meshes.append(m)
		var g: String = {"conifer": "conifer", "broadleaf": "broadleaf", "under": "under"}[meta[n].species]
		if not groups.has(g):
			groups[g] = []
		groups[g].append(names.size() - 1)
	scene.free()
	_build_impostor_material()


## Place every tree of the field (loading screen).
func plant_all() -> void:
	var lc := pack.landcover.get_data()
	var n := pack.landcover.get_width()
	var half := pack.size_m * 0.5 + pack.border_m * 0.6
	var rng := RandomNumberGenerator.new()
	for cls in PLANTING.keys():
		for rule in PLANTING[cls]:
			var group: Array = groups.get(rule[0], [])
			if group.is_empty():
				continue
			var spacing: float = rule[1]
			var prob: float = rule[2]
			rng.seed = hash([cls, rule[0]])
			var steps := int(2.0 * half / spacing)
			for j in steps:
				var z := -half + (j + 0.5) * spacing
				var v := clampi(int((z / pack.span_m + 0.5) * n), 0, n - 1)
				for i in steps:
					var x := -half + (i + rng.randf()) * spacing
					var zz := z + (rng.randf() - 0.5) * spacing
					var u := clampi(int((x / pack.span_m + 0.5) * n), 0, n - 1)
					var k := (v * n + u) * 3
					if lc[k] != cls:
						continue
					if rng.randf() > prob * (0.4 + 0.6 * lc[k + 1] / 255.0):
						continue
					_add(group[_pick(group, rng)], x, zz, rng)
	print("TREES ", count, " in ", cells.size(), " cells")
	for c in cells.keys():
		_build_far(c)


func _pick(group: Array, rng: RandomNumberGenerator) -> int:
	var total := 0.0
	for idx in group:
		total += WEIGHT.get(names[idx], 1.0)
	var r := rng.randf() * total
	for k in group.size():
		r -= WEIGHT.get(names[group[k]], 1.0)
		if r <= 0.0:
			return k
	return group.size() - 1


func _add(idx: int, x: float, z: float, rng: RandomNumberGenerator) -> void:
	var y := terrain.data.get_height(Vector3(x, 0, z))
	if is_nan(y):
		return
	var s := rng.randf_range(0.8, 1.15)
	var xf := Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.9, 1.1), s)), Vector3(x, y - 0.15, z))
	var c := Vector2i(floori(x / CELL), floori(z / CELL))
	if not cells.has(c):
		cells[c] = {"idx": PackedInt32Array(), "xf": []}
	cells[c].idx.append(idx)
	cells[c].xf.append(xf)
	count += 1


func _process(_dt: float) -> void:
	if focus == null:
		return
	var p := Vector2(focus.global_position.x, focus.global_position.z)
	var budget := 2
	for c in cells.keys():
		var near := Vector2((c.x + 0.5) * CELL, (c.y + 0.5) * CELL).distance_to(p) < NEAR
		if near and not _near.has(c) and budget > 0:
			_build_near(c)
			budget -= 1
		elif not near and _near.has(c):
			for mi in _near[c]:
				mi.queue_free()
			_near.erase(c)
			_far[c].visible = true


func build_near_now() -> void:
	var p := Vector2(focus.global_position.x, focus.global_position.z)
	for c in cells.keys():
		if Vector2((c.x + 0.5) * CELL, (c.y + 0.5) * CELL).distance_to(p) < NEAR:
			_build_near(c)


func _build_near(c: Vector2i) -> void:
	var cell: Dictionary = cells[c]
	var per := {}
	for k in cell.idx.size():
		var idx: int = cell.idx[k]
		if not per.has(idx):
			per[idx] = []
		per[idx].append(cell.xf[k])
	var list := []
	for idx in per.keys():
		var xs: Array = per[idx]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = meshes[idx]
		mm.instance_count = xs.size()
		for k in xs.size():
			mm.set_instance_transform(k, xs[k])
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		add_child(mi)
		list.append(mi)
	_near[c] = list
	if _far.has(c):
		_far[c].visible = false


func _build_far(c: Vector2i) -> void:
	var cell: Dictionary = cells[c]
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = _imp_mesh
	mm.instance_count = cell.idx.size()
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(c)
	for k in cell.idx.size():
		var idx: int = cell.idx[k]
		var m: Dictionary = meta[names[idx]]
		var xf: Transform3D = cell.xf[k]
		var b := xf.basis.scaled(Vector3(m.imp_w, m.imp_h, m.imp_w))
		mm.set_instance_transform(k, Transform3D(b, xf.origin))
		mm.set_instance_custom_data(k, Color(idx, rng.randf_range(0.85, 1.05), m.get("top_y", 0.3), 0))
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = _imp_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visibility_range_end = FAR
	add_child(mi)
	_far[c] = mi


func _build_impostor_material() -> void:
	# one 256 x 768 column per tree: side picture (512) above, crown from above (256) below
	var w := 256
	var h := 512
	var atlas := Image.create_empty(w * names.size(), h + w, false, Image.FORMAT_RGBA8)
	for i in names.size():
		for part in [["", Vector2i(w, h), 0], ["_top", Vector2i(w, w), h]]:
			var img := (load("res://assets/trees/impostors/%s%s.png" % [names[i], part[0]]) as Texture2D).get_image()
			if img.is_compressed():
				img.decompress()
			img.convert(Image.FORMAT_RGBA8)
			if img.get_size() != part[1]:
				img.resize(part[1].x, part[1].y)
			atlas.blit_rect(img, Rect2i(Vector2i.ZERO, part[1]), Vector2i(i * w, part[2]))
	atlas.generate_mipmaps()
	_imp_mat = ShaderMaterial.new()
	_imp_mat.shader = load("res://shaders/tree_impostor.gdshader")
	_imp_mat.set_shader_parameter("atlas", ImageTexture.create_from_image(atlas))
	_imp_mat.set_shader_parameter("count", float(names.size()))
	# two crossed unit quads + one horizontal (crown from above; the shader lifts it to the crown height)
	# UV.y 0..1 over the side picture, 1..1.5 over the top picture (atlas column is 1.5 x 512 tall)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var quads := []
	for a in [0.0, PI * 0.5]:
		var d := Vector3(cos(a), 0, sin(a)) * 0.5
		quads.append([Vector3(-sin(a), 0, cos(a)), [[-d, Vector2(0, 1)], [d, Vector2(1, 1)], [d + Vector3.UP, Vector2(1, 0)], [-d + Vector3.UP, Vector2(0, 0)]]])
	quads.append([Vector3.UP, [[Vector3(-0.5, 0, -0.5), Vector2(0, 1.0)], [Vector3(0.5, 0, -0.5), Vector2(1, 1.0)], [Vector3(0.5, 0, 0.5), Vector2(1, 1.5)], [Vector3(-0.5, 0, 0.5), Vector2(0, 1.5)]]])
	for q in quads:
		for tri in [[0, 1, 2], [0, 2, 3]]:
			for k in tri:
				st.set_normal(q[0])
				st.set_uv(q[1][k][1])
				st.add_vertex(q[1][k][0])
	_imp_mesh = st.commit()
