class_name CameraRig
extends Node3D
## Game camera: orbits a ground point. WASD/arrows pan, wheel zoom, middle drag or Q/E rotate, R/F tilt.
## Low and almost horizontal near the ground, steeper when far. Never leaves the battle square.

@export var min_dist := 6.0
@export var max_dist := 1800.0

var terrain: Terrain3D
var limit := 5000.0
var yaw := 0.0
var pitch_bias := 0.0
var dist := 60.0
var _target_dist := 60.0
var cam: Camera3D
var _drag := false


func _ready() -> void:
	cam = Camera3D.new()
	cam.fov = 55.0
	cam.near = 0.15
	cam.far = 16000.0
	add_child(cam)
	cam.make_current()


func place(at: Vector3, yaw_deg: float, distance: float, tilt := 0.0) -> void:
	position = at
	yaw = deg_to_rad(yaw_deg)
	dist = distance
	_target_dist = distance
	pitch_bias = tilt
	_apply()


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP and e.pressed:
			_target_dist = maxf(min_dist, _target_dist * 0.85)
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN and e.pressed:
			_target_dist = minf(max_dist, _target_dist / 0.85)
		elif e.button_index == MOUSE_BUTTON_MIDDLE:
			_drag = e.pressed
	elif e is InputEventMouseMotion and _drag:
		yaw -= e.relative.x * 0.005
		pitch_bias = clampf(pitch_bias + e.relative.y * 0.004, -0.5, 0.6)


func _process(dt: float) -> void:
	var mv := Vector2(
		float(Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT)) - float(Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT)),
		float(Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN)) - float(Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP)))
	var speed := (8.0 + dist * 1.2) * (3.0 if Input.is_key_pressed(KEY_SHIFT) else 1.0)
	position += Basis(Vector3.UP, yaw) * Vector3(mv.x, 0.0, mv.y) * speed * dt
	yaw += (float(Input.is_key_pressed(KEY_E)) - float(Input.is_key_pressed(KEY_Q))) * 1.4 * dt
	pitch_bias = clampf(pitch_bias + (float(Input.is_key_pressed(KEY_F)) - float(Input.is_key_pressed(KEY_R))) * 0.8 * dt, -0.5, 0.6)
	dist = lerpf(dist, _target_dist, 1.0 - exp(-10.0 * dt))
	_apply()


func _apply() -> void:
	position.x = clampf(position.x, -limit, limit)
	position.z = clampf(position.z, -limit, limit)
	if terrain:
		var h := terrain.data.get_height(position)
		if not is_nan(h):
			position.y = h
	# pitch from distance: ~10 deg at the soldiers' eye level, ~62 deg from high above
	var t := clampf(log(dist / min_dist) / log(max_dist / min_dist), 0.0, 1.0)
	var pitch := clampf(deg_to_rad(lerpf(10.0, 62.0, pow(t, 0.8))) + pitch_bias, deg_to_rad(2.0), deg_to_rad(85.0))
	var off := Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, -pitch) * Vector3(0.0, 0.0, dist)
	var eye := position + off + Vector3(0, 1.6, 0)
	if terrain:
		var g := terrain.data.get_height(eye)
		if not is_nan(g):
			eye.y = maxf(eye.y, g + 1.7)
	cam.global_position = eye
	cam.look_at(position + Vector3(0, 1.2, 0), Vector3.UP)
