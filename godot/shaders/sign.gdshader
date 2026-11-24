shader_type spatial;
// Road-sign plates: one cell of the sign atlas per instance (INSTANCE_CUSTOM.r = index). Grey metal back.
render_mode cull_disabled;

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_disable;
uniform float count = 10.0;
varying flat float v_idx;

void vertex() {
	v_idx = INSTANCE_CUSTOM.r;
}

void fragment() {
	vec4 c = texture(atlas, vec2((v_idx + clamp(UV.x, 0.01, 0.99)) / count, UV.y));
	if (c.a < 0.5) discard;
	ALBEDO = FRONT_FACING ? c.rgb : vec3(0.55);
	ROUGHNESS = FRONT_FACING ? 0.35 : 0.6;
	METALLIC = FRONT_FACING ? 0.0 : 0.6;
	// retro-reflective film: a little emission so signs read at distance and in shade
	EMISSION = FRONT_FACING ? c.rgb * 0.08 : vec3(0.0);
}
