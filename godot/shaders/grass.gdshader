shader_type spatial;
// Grass clumps (MultiMesh). Instance colour = grass tone for the land cover x satellite tint.
render_mode cull_disabled, depth_draw_opaque;

uniform float wind_strength = 0.12;
uniform vec2 wind_dir = vec2(0.8, 0.6);
uniform float fade_start = 110.0;
uniform float fade_end = 150.0;

varying float v_h;

void vertex() {
	v_h = UV.y;  // 0 at the root, 1 at the tip
	vec3 wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float gust = sin(TIME * 1.6 + dot(wpos.xz, vec2(0.11, 0.07))) * 0.6 + sin(TIME * 3.1 + wpos.x * 0.9) * 0.25;
	float bend = wind_strength * gust * v_h * v_h;
	VERTEX.xz += (inverse(mat3(MODEL_MATRIX)) * vec3(wind_dir.x, 0.0, wind_dir.y)).xz * bend;
	// shade like the ground below it: normals mostly up
	NORMAL = normalize(mix(NORMAL, vec3(0.0, 1.0, 0.0), 0.75));
}

void fragment() {
	float d = length(VERTEX);
	if (d > fade_start) {
		float k = clamp((d - fade_start) / (fade_end - fade_start), 0.0, 1.0);
		if (fract(sin(dot(FRAGCOORD.xy, vec2(12.9898, 78.233))) * 43758.5453) < k) discard;
	}
	// per-blade shade (UV.x): some blades drier/yellower, some darker
	vec3 c = COLOR.rgb * mix(0.75, 1.15, UV.x);
	c = mix(c, c * vec3(1.25, 1.1, 0.7), step(0.82, UV.x));
	vec3 base = c * 0.28;
	vec3 tip = c * 0.95;
	ALBEDO = mix(base, tip, smoothstep(0.0, 0.9, v_h));
	ROUGHNESS = 0.85;
	SPECULAR = 0.25;
	AO = mix(0.35, 1.0, v_h);
	AO_LIGHT_AFFECT = 0.4;
	BACKLIGHT = COLOR.rgb * 0.35;
}
