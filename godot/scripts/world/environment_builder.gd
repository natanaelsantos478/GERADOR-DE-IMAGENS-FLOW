class_name EnvironmentBuilder
extends RefCounted
## Sky, sun at the real position for the place/date/hour, aerial fog and post-processing.

var sun: DirectionalLight3D
var world_env: WorldEnvironment


func build(parent: Node3D, pack: BattlePack) -> void:
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 700.0
	sun.directional_shadow_split_1 = 0.03
	sun.directional_shadow_split_2 = 0.12
	sun.directional_shadow_split_3 = 0.4
	sun.directional_shadow_blend_splits = true
	sun.shadow_bias = 0.04
	sun.shadow_normal_bias = 1.2
	sun.light_energy = 1.7
	sun.light_angular_distance = 0.53
	parent.add_child(sun)
	var d := sun_direction(pack.latitude(), pack.day_of_year(), pack.hour())
	sun.look_at_from_position(Vector3.ZERO, -d, Vector3.UP if absf(d.y) < 0.99 else Vector3.FORWARD)
	sun.light_color = Color(1.0, 0.96, 0.9).lerp(Color(1.0, 0.72, 0.5), clampf(1.0 - d.y / 0.35, 0.0, 1.0))

	var sky_mat := PhysicalSkyMaterial.new()
	sky_mat.rayleigh_coefficient = 2.2
	sky_mat.mie_coefficient = 0.006
	sky_mat.mie_eccentricity = 0.78
	sky_mat.turbidity = 8.0
	sky_mat.ground_color = Color(0.25, 0.27, 0.22)
	sky_mat.energy_multiplier = 1.0
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_256

	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 1.0
	env.ambient_light_energy = 0.9
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.15
	env.tonemap_white = 6.0
	env.ssao_enabled = true
	env.ssao_radius = 1.5
	env.ssao_intensity = 1.6
	env.ssao_detail = 0.5
	env.glow_enabled = true
	env.glow_intensity = 0.35
	env.glow_bloom = 0.03
	env.glow_hdr_threshold = 1.2
	# aerial perspective: the field fades into the sky colour, the edge of the 10 km square never shows
	var fog: Dictionary = pack.meta.get("weather", {})
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_light_color = Color(0.68, 0.76, 0.86)
	env.fog_light_energy = 1.0
	env.fog_sun_scatter = 0.25
	env.fog_density = 0.00022 + 0.0006 * float(fog.get("fog", 0.15))
	env.fog_aerial_perspective = 0.75
	env.fog_sky_affect = 0.35
	env.fog_height = float(pack.meta.height.min) + 40.0
	env.fog_height_density = 0.004
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.06
	env.adjustment_saturation = 1.05
	world_env = WorldEnvironment.new()
	world_env.name = "WorldEnvironment"
	world_env.environment = env
	parent.add_child(world_env)


## Unit vector pointing to the sun (+X east, -Z north, +Y up), from latitude, day of year and local solar hour.
static func sun_direction(lat_deg: float, doy: int, hour: float) -> Vector3:
	var lat := deg_to_rad(lat_deg)
	var dec := deg_to_rad(23.44) * sin(TAU * (284.0 + doy) / 365.0)
	var ha := deg_to_rad(15.0 * (hour - 12.0))
	var el := asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(ha))
	var az := atan2(-sin(ha), tan(dec) * cos(lat) - sin(lat) * cos(ha))  # from north, clockwise
	return Vector3(sin(az) * cos(el), sin(el), -cos(az) * cos(el)).normalized()
