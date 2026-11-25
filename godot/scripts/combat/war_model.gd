class_name WarModel
## Shared helpers for vehicles and aircraft: load a model at a real size, paint it, burn it.


## The model scaled so its longest horizontal side is `length`, centred, standing on y = 0, turned by `yaw_fix` so that
## +Z is its nose.
static func make(path: String, length: float, yaw_fix: float, tint: Color) -> Node3D:
	var inner: Node3D = (load(path) as PackedScene).instantiate()
	var box := _bounds(inner, Transform3D.IDENTITY)
	var s := length / maxf(box.size.x, box.size.z)
	var mid := box.get_center()
	inner.transform = Transform3D(Basis(Vector3.UP, yaw_fix).scaled(Vector3.ONE * s), Vector3.ZERO) \
		* Transform3D(Basis.IDENTITY, Vector3(-mid.x, -box.position.y, -mid.z)) * inner.transform
	var root := Node3D.new()
	root.add_child(inner)
	paint(root, tint)
	return root


static func _bounds(n: Node, xf: Transform3D) -> AABB:
	var here := xf
	if n is Node3D:
		here = xf * (n as Node3D).transform
	var out := AABB()
	var first := true
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		out = here * (n as MeshInstance3D).mesh.get_aabb()
		first = false
	for c in n.get_children():
		var b := _bounds(c, here)
		if b.size != Vector3.ZERO:
			out = b if first else out.merge(b)
			first = false
	return out


static func paint(n: Node, tint: Color) -> void:
	var m := StandardMaterial3D.new()
	m.albedo_color = tint
	m.roughness = 0.8
	m.metallic = 0.15
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).material_override = m


## Fire and a black smoke column that keep going on a wreck.
static func burn(parent: Node3D, soft: Texture2D, at: Vector3) -> void:
	for o in [[Color(1.0, 0.5, 0.1, 0.9), 24, 0.9, 1.4, 2.0, true], [Color(0.07, 0.07, 0.07, 0.75), 40, 8.0, 3.5, 3.0, false]]:
		var p := GPUParticles3D.new()
		p.amount = o[1]
		p.lifetime = o[2]
		var pm := ParticleProcessMaterial.new()
		pm.direction = Vector3.UP
		pm.spread = 15.0
		pm.initial_velocity_min = o[4] * 0.6
		pm.initial_velocity_max = o[4]
		pm.gravity = Vector3(0.4, 0.5, 0)
		pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
		pm.emission_sphere_radius = 1.0
		var g := Gradient.new()
		g.set_color(0, o[0])
		g.set_color(1, Color(o[0].r, o[0].g, o[0].b, 0.0))
		var gt := GradientTexture1D.new()
		gt.gradient = g
		pm.color_ramp = gt
		p.process_material = pm
		var q := QuadMesh.new()
		q.size = Vector2(o[3], o[3])
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if o[5] else BaseMaterial3D.BLEND_MODE_MIX
		m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		m.vertex_color_use_as_albedo = true
		m.albedo_texture = soft
		q.material = m
		p.draw_pass_1 = q
		p.visibility_aabb = AABB(Vector3(-20, -5, -20), Vector3(40, 60, 40))
		parent.add_child(p)
		p.position = at
