class_name TerrainBuilder
extends RefCounted
## Builds the Terrain3D node from the pack: relief, ground materials per pixel and the colour map.

const GRID := 4096          # terrain vertices per side (pack relief is upsampled to this)
const REGION := 1024        # Terrain3D region size in vertices -> 4 x 4 regions

var terrain: Terrain3D


func create(parent: Node3D) -> Terrain3D:
	terrain = Terrain3D.new()
	terrain.name = "Terrain"
	terrain.region_size = REGION
	terrain.collision_mode = 1  # dynamic, around the camera
	terrain.material = Terrain3DMaterial.new()
	terrain.assets = Terrain3DAssets.new()
	terrain.material.world_background = 0  # nothing outside the field
	terrain.material.auto_shader_enabled = false
	parent.add_child(terrain)
	return terrain


func import_pack(pack: BattlePack) -> void:
	terrain.vertex_spacing = pack.span_m / GRID
	var h := pack.height.duplicate() as Image
	h.resize(GRID, GRID, Image.INTERPOLATE_CUBIC)
	var ctrl := _control_map(pack.cover)
	var col := pack.tint.duplicate() as Image
	col.resize(GRID, GRID, Image.INTERPOLATE_BILINEAR)
	var half := pack.span_m * 0.5
	terrain.data.import_images([h, ctrl, col], Vector3(-half, 0.0, -half), 0.0, 1.0)


func set_textures() -> void:
	GroundMaterials.build(terrain.assets)
	terrain.material.set_shader_param("blend_sharpness", 0.75)


## cover.png (base id, overlay id, blend) -> Terrain3D control map (uint32 bits stored in a float image).
func _control_map(cover: Image) -> Image:
	var n := cover.get_width()
	var src := cover.get_data()
	var lut := PackedFloat32Array()
	lut.resize(8 * 8 * 256)
	for b in 8:
		for o in 8:
			for bl in 256:
				var bits: int = Terrain3DUtil.enc_base(b) | Terrain3DUtil.enc_overlay(o) | Terrain3DUtil.enc_blend(bl)
				lut[(b * 8 + o) * 256 + bl] = Terrain3DUtil.as_float(bits)
	var out := PackedFloat32Array()
	out.resize(GRID * GRID)
	var step := float(n) / GRID
	for y in GRID:
		var row := int(y * step) * n
		var o_row := y * GRID
		for x in GRID:
			var i := (row + int(x * step)) * 3
			out[o_row + x] = lut[((src[i] & 7) * 8 + (src[i + 1] & 7)) * 256 + src[i + 2]]
	return Image.create_from_data(GRID, GRID, false, Image.FORMAT_RF, out.to_byte_array())
