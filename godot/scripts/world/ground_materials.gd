class_name GroundMaterials
extends RefCounted
## Terrain3D texture list. Order is the material id used in cover.png (tools/godot/test_pack.py).
## Textures: ambientCG CC0, packed albedo+height / normal(GL)+roughness, 1024 px.

const LIST := [
	# name, file stem, metres per texture repeat, detiling rotation
	["grass", "grass", 3.0, 0.35],
	["grass_dirt", "grass_dirt", 4.0, 0.35],
	["forest_floor", "forest_floor", 3.0, 0.4],
	["dirt", "dirt", 4.0, 0.3],
	["rock", "rock", 6.0, 0.25],
	["gravel", "gravel", 2.5, 0.3],
	["sand", "sand", 4.0, 0.3],
	["asphalt", "asphalt", 5.0, 0.15],
]


static func build(assets: Terrain3DAssets) -> void:
	for i in LIST.size():
		var e: Array = LIST[i]
		var t := Terrain3DTextureAsset.new()
		t.name = e[0]
		t.id = i
		t.albedo_texture = load("res://assets/ground/%s_alb_ht.png" % e[1])
		t.normal_texture = load("res://assets/ground/%s_nrm_rgh.png" % e[1])
		t.uv_scale = 1.0 / float(e[2])
		t.detiling_rotation = e[3]
		t.detiling_shift = 0.25
		t.normal_depth = 1.0
		t.ao_strength = 0.6
		assets.set_texture_asset(i, t)
