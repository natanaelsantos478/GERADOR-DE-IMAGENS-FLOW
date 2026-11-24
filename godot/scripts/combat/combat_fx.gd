class_name CombatFx
extends Node3D
## Gunfire and explosions: muzzle flash (light + sprite), tracers, dust at impacts, 3D sound delayed by the speed of
## sound, explosions with flash, fireball, smoke, flying earth and a crater decal. Pooled, so it stays cheap.

const SOUND_SPEED := 343.0
const TRACER_SPEED := 800.0

var camera: Camera3D
var shake := 0.0
var _rifle: AudioStream
var _boom_s: AudioStream
var _boom_l: AudioStream
var _flash_mat: StandardMaterial3D
var _tracer_mat: StandardMaterial3D
var _soft: Texture2D
var _crater_tex: Texture2D
var _lights: Array[OmniLight3D] = []
var _audio: Array[AudioStreamPlayer3D] = []
var _li := 0
var _ai := 0


func _ready() -> void:
	_rifle = load("res://assets/audio/rifle_burst.ogg")
	_boom_s = load("res://assets/audio/explosion_small.ogg")
	_boom_l = load("res://assets/audio/explosion_large.ogg")
	_flash_mat = StandardMaterial3D.new()
	_flash_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_flash_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	_flash_mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	_flash_mat.albedo_color = Color(1.0, 0.75, 0.35)
	_flash_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_tracer_mat = StandardMaterial3D.new()
	_tracer_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_tracer_mat.albedo_color = Color(1.0, 0.55, 0.2)
	_tracer_mat.emission_enabled = true
	_tracer_mat.emission = Color(1.0, 0.5, 0.15)
	_tracer_mat.emission_energy_multiplier = 6.0
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	var gt := GradientTexture2D.new()
	gt.gradient = g
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.5, 0.5)
	gt.fill_to = Vector2(1.0, 0.5)
	gt.width = 64
	gt.height = 64
	_soft = gt
	_flash_mat.albedo_texture = _soft
	_crater_tex = _make_crater()
	for i in 6:
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.7, 0.35)
		l.omni_range = 7.0
		l.visible = false
		add_child(l)
		_lights.append(l)
	for i in 24:
		var a := AudioStreamPlayer3D.new()
		a.unit_size = 25.0
		a.max_distance = 2500.0
		a.attenuation_filter_cutoff_hz = 6000.0
		add_child(a)
		_audio.append(a)


func _process(dt: float) -> void:
	if camera and shake > 0.0:
		shake = maxf(0.0, shake - dt * 1.5)
		camera.h_offset = randf_range(-1, 1) * shake * 0.25
		camera.v_offset = randf_range(-1, 1) * shake * 0.25


## A burst of `rounds` from shooter to target: flash per round, one tracer, dust where the rounds land.
func shot(shooter: Soldier, target: Soldier, rounds: int) -> void:
	var muzzle := shooter.eye() + (target.eye() - shooter.eye()).normalized() * 0.7 - Vector3(0, 0.15, 0)
	for k in rounds:
		get_tree().create_timer(k * 0.09).timeout.connect(_flash.bind(muzzle))
	_tracer(muzzle, target.eye() + Vector3(randf_range(-1, 1), randf_range(-0.6, 0.3), randf_range(-1, 1)))
	for k in rounds:
		var miss := target.global_position + Vector3(randf_range(-2.5, 2.5), 0, randf_range(-2.5, 2.5))
		var delay := muzzle.distance_to(miss) / TRACER_SPEED + k * 0.09
		get_tree().create_timer(delay).timeout.connect(_dust.bind(miss, 0.35))
	_sound(_rifle, muzzle, randf_range(0.9, 1.1), -4.0)


## Suppressive burst at a spot (no visible target): flashes, one tracer, dust around the spot.
func shot_area(shooter: Soldier, at: Vector3, rounds: int) -> void:
	var muzzle := shooter.eye() + (at + Vector3(0, 1.0, 0) - shooter.eye()).normalized() * 0.7 - Vector3(0, 0.15, 0)
	for k in rounds:
		get_tree().create_timer(k * 0.09).timeout.connect(_flash.bind(muzzle))
	_tracer(muzzle, at + Vector3(randf_range(-4, 4), randf_range(0.5, 1.5), randf_range(-4, 4)))
	for k in rounds:
		var miss := at + Vector3(randf_range(-5, 5), 0, randf_range(-5, 5))
		get_tree().create_timer(muzzle.distance_to(miss) / TRACER_SPEED + k * 0.09).timeout.connect(_dust.bind(miss, 0.35))
	_sound(_rifle, muzzle, randf_range(0.85, 1.0), -3.0)


func _flash(p: Vector3) -> void:
	var l := _lights[_li]
	_li = (_li + 1) % _lights.size()
	l.global_position = p
	l.light_energy = 2.5
	l.visible = true
	var q := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(0.45, 0.45)
	q.mesh = qm
	q.material_override = _flash_mat
	q.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(q)
	q.global_position = p
	get_tree().create_timer(0.05).timeout.connect(func():
		l.visible = false
		q.queue_free())


func _tracer(a: Vector3, b: Vector3) -> void:
	var t := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.05, 0.05, 2.0)
	t.mesh = bm
	t.material_override = _tracer_mat
	t.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(t)
	t.global_position = a
	t.look_at(b, Vector3.UP)
	var tw := create_tween()
	tw.tween_property(t, "global_position", b, a.distance_to(b) / TRACER_SPEED)
	tw.tween_callback(t.queue_free)


func _dust(p: Vector3, size: float) -> void:
	_particles(p, {"amount": 10, "life": 1.2, "size": size, "colour": Color(0.45, 0.38, 0.3, 0.7),
		"speed": Vector2(1.0, 3.0), "spread": 35.0, "gravity": -4.0, "dir": Vector3.UP})


## Mortar / shell: flash, fireball, black-grey smoke column, flying earth, crater; damage handled by CombatSim.
func explosion(p: Vector3, size := 1.0) -> void:
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.6, 0.3)
	l.omni_range = 40.0 * size
	l.light_energy = 12.0
	add_child(l)
	l.global_position = p + Vector3(0, 2, 0)
	var tw := create_tween()
	tw.tween_property(l, "light_energy", 0.0, 0.35)
	tw.tween_callback(l.queue_free)
	_particles(p + Vector3(0, 1, 0), {"amount": 24, "life": 0.55, "size": 2.6 * size, "colour": Color(1.0, 0.55, 0.15, 0.9),
		"speed": Vector2(4.0, 10.0), "spread": 80.0, "gravity": 2.0, "dir": Vector3.UP, "add": true})
	_particles(p + Vector3(0, 1.5, 0), {"amount": 30, "life": 7.0, "size": 4.5 * size, "colour": Color(0.22, 0.21, 0.2, 0.75),
		"speed": Vector2(1.5, 5.0), "spread": 50.0, "gravity": 0.6, "dir": Vector3.UP, "grow": 3.0})
	_particles(p, {"amount": 60, "life": 1.8, "size": 0.35 * size, "colour": Color(0.3, 0.24, 0.17, 1.0),
		"speed": Vector2(8.0, 22.0), "spread": 45.0, "gravity": -9.8, "dir": Vector3.UP})
	var d := Decal.new()
	d.texture_albedo = _crater_tex
	d.size = Vector3(5.0, 3.0, 5.0) * size
	d.cull_mask = 1
	add_child(d)
	d.global_position = p
	var delay := 0.0 if camera == null else camera.global_position.distance_to(p) / SOUND_SPEED
	get_tree().create_timer(delay).timeout.connect(_sound.bind(_boom_l if size > 1.2 else _boom_s, p, randf_range(0.85, 1.05), 4.0))
	if camera:
		shake = maxf(shake, clampf(1.0 - camera.global_position.distance_to(p) / 200.0, 0.0, 1.0) * size)


func _particles(p: Vector3, o: Dictionary) -> void:
	var gp := GPUParticles3D.new()
	gp.amount = o.amount
	gp.lifetime = o.life
	gp.one_shot = true
	gp.explosiveness = 0.95
	var pm := ParticleProcessMaterial.new()
	pm.direction = o.dir
	pm.spread = o.spread
	pm.initial_velocity_min = o.speed.x
	pm.initial_velocity_max = o.speed.y
	pm.gravity = Vector3(0, o.gravity, 0)
	pm.damping_min = 0.5
	pm.damping_max = 1.5
	pm.scale_min = 0.6
	pm.scale_max = 1.2
	if o.has("grow"):
		var c := Curve.new()
		c.add_point(Vector2(0, 0.4))
		c.add_point(Vector2(1, 1.0))
		var ct := CurveTexture.new()
		ct.curve = c
		pm.scale_curve = ct
		pm.scale_max = o.grow
	var g := Gradient.new()
	g.set_color(0, o.colour)
	g.set_color(1, Color(o.colour.r, o.colour.g, o.colour.b, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	pm.color_ramp = gt
	gp.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(o.size, o.size)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED if o.get("add", false) else BaseMaterial3D.SHADING_MODE_PER_PIXEL
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if o.get("add", false) else BaseMaterial3D.BLEND_MODE_MIX
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = _soft
	q.material = m
	gp.draw_pass_1 = q
	gp.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(gp)
	gp.global_position = p
	gp.emitting = true
	get_tree().create_timer(o.life + 0.5).timeout.connect(gp.queue_free)


func _sound(stream: AudioStream, p: Vector3, pitch: float, db: float) -> void:
	var a := _audio[_ai]
	_ai = (_ai + 1) % _audio.size()
	a.stream = stream
	a.global_position = p
	a.pitch_scale = pitch
	a.volume_db = db
	a.play()


## Dark scorched ring with a lighter centre of thrown earth.
static func _make_crater() -> Texture2D:
	var n := 128
	var img := Image.create_empty(n, n, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for y in n:
		for x in n:
			var d := Vector2(x - n / 2.0, y - n / 2.0).length() / (n / 2.0)
			var jitter := rng.randf_range(-0.08, 0.08)
			var a := clampf(1.0 - (d + jitter), 0.0, 1.0)
			var c := Color(0.08, 0.07, 0.06).lerp(Color(0.28, 0.22, 0.16), clampf(1.0 - d * 1.8, 0, 1))
			img.set_pixel(x, y, Color(c.r, c.g, c.b, pow(a, 0.6)))
	return ImageTexture.create_from_image(img)
