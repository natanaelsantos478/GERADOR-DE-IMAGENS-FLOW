class_name Ragdoll
extends RefCounted
## Physical body for a soldier skeleton: capsules on the main bones joined with real limits (elbow and knee only bend
## one way, shoulders and hips in a cone). When a soldier dies the animation stops, physics takes over and the body
## receives the impulse of what killed it, so every fall is different. The ground is a small height field of the
## real relief under the body (works anywhere on the map, not only near the camera).

# bone, child bone (length), radius, joint, swing limit (deg), mass (kg)
const BONES := [
	["pelvis", "spine_02", 0.13, "none", 0, 14.0],
	["spine_02", "neck_01", 0.14, "cone", 25, 18.0],
	["Head", "", 0.11, "cone", 40, 5.0],
	["upperarm_l", "lowerarm_l", 0.055, "cone", 85, 2.5],
	["lowerarm_l", "hand_l", 0.045, "hinge", 140, 1.8],
	["upperarm_r", "lowerarm_r", 0.055, "cone", 85, 2.5],
	["lowerarm_r", "hand_r", 0.045, "hinge", 140, 1.8],
	["thigh_l", "calf_l", 0.08, "cone", 70, 8.0],
	["calf_l", "foot_l", 0.06, "hinge", 135, 4.0],
	["thigh_r", "calf_r", 0.08, "cone", 70, 8.0],
	["calf_r", "foot_r", 0.06, "hinge", 135, 4.0],
]
const LAYER := 4          # ragdoll bodies collide with the ground patch (layer 3) and each other


static func activate(skeleton: Skeleton3D, terrain: Terrain3D, impulse: Vector3, at_bone := "spine_02", spread := 0.3) -> PhysicalBoneSimulator3D:
	var sim := PhysicalBoneSimulator3D.new()
	skeleton.add_child(sim)
	var bodies := {}
	for d in BONES:
		var bi := skeleton.find_bone(d[0])
		if bi < 0:
			continue
		var pb := PhysicalBone3D.new()
		pb.name = "PB_" + d[0]
		pb.bone_name = d[0]
		pb.mass = d[5]
		pb.friction = 0.9
		pb.linear_damp = 0.3
		pb.angular_damp = 1.5
		pb.collision_layer = 1 << (LAYER - 1)
		pb.collision_mask = (1 << (LAYER - 1)) | (1 << 2)
		match d[3]:
			"cone":
				pb.joint_type = PhysicalBone3D.JOINT_TYPE_CONE
				pb.set("joint_constraints/swing_span", float(d[4]))
				pb.set("joint_constraints/twist_span", 30.0)
			"hinge":
				pb.joint_type = PhysicalBone3D.JOINT_TYPE_HINGE
				pb.set("joint_constraints/angular_limit_enabled", true)
				pb.set("joint_constraints/angular_limit_upper", float(d[4]))
				pb.set("joint_constraints/angular_limit_lower", 0.0)
			_:
				pb.joint_type = PhysicalBone3D.JOINT_TYPE_NONE
		# capsule from this bone towards its child, in the bone's own space
		var rest := skeleton.get_bone_global_rest(bi)
		var length := 0.22
		var dir := Vector3.UP
		if d[1] != "":
			var ci := skeleton.find_bone(d[1])
			if ci >= 0:
				var local := rest.affine_inverse() * skeleton.get_bone_global_rest(ci).origin
				length = maxf(local.length(), 0.1)
				dir = local.normalized()
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = d[2]
		cap.height = maxf(length + d[2] * 2.0, d[2] * 2.2)
		cs.shape = cap
		var b := Basis(Quaternion(Vector3.UP, dir))
		cs.transform = Transform3D(b, dir * length * 0.5)
		pb.add_child(cs)
		sim.add_child(pb)
		bodies[d[0]] = pb
	_ground_patch(skeleton, terrain)
	sim.physical_bones_start_simulation()
	# impulse: most on the hit bone, the rest spread over the body (explosions push everything)
	for k in bodies.keys():
		var pb: PhysicalBone3D = bodies[k]
		var w := 1.0 if k == at_bone else spread
		pb.apply_central_impulse(impulse * w * pb.mass / 10.0)
		pb.apply_torque_impulse(Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * impulse.length() * 0.02)
	return sim


## 16 x 16 m height field of the relief around the body, so it lands on the real ground.
static func _ground_patch(skeleton: Skeleton3D, terrain: Terrain3D) -> void:
	var c := skeleton.global_position
	var n := 17
	var step := 1.0
	var data := PackedFloat32Array()
	data.resize(n * n)
	var base := terrain.data.get_height(c)
	if is_nan(base):
		base = c.y
	for j in n:
		for i in n:
			var p := c + Vector3((i - (n - 1) / 2.0) * step, 0, (j - (n - 1) / 2.0) * step)
			var h := terrain.data.get_height(p)
			data[j * n + i] = (base if is_nan(h) else h) - base
	var shape := HeightMapShape3D.new()
	shape.map_width = n
	shape.map_depth = n
	shape.map_data = data
	var body := StaticBody3D.new()
	body.collision_layer = 1 << 2
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	cs.shape = shape
	body.add_child(cs)
	skeleton.get_tree().current_scene.add_child(body)
	body.global_position = Vector3(c.x, base, c.z)
	skeleton.get_tree().create_timer(30.0).timeout.connect(body.queue_free)
