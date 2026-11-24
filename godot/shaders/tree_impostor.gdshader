shader_type spatial;
// Far trees: two crossed quads + a horizontal one (crown from above), pictures from the impostor atlas.
// Atlas: one column per tree type, side picture on top (512 px), crown from above below it (256 px).
render_mode cull_disabled;

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_disable;
uniform float count = 14.0;

varying float v_idx;
varying float v_shade;

void vertex() {
	v_idx = INSTANCE_CUSTOM.r;
	v_shade = INSTANCE_CUSTOM.g;
	if (UV.y > 1.0) {
		VERTEX.y = INSTANCE_CUSTOM.b;  // crown height (fraction of the picture height)
	}
	NORMAL = normalize(mix(NORMAL, vec3(0.0, 1.0, 0.0), 0.6));
}

void fragment() {
	float x = (v_idx + clamp(UV.x, 0.01, 0.99)) / count;
	float y = UV.y <= 1.0 ? UV.y * (2.0 / 3.0) : 2.0 / 3.0 + (UV.y - 1.0) * (2.0 / 3.0);
	vec4 c = texture(atlas, vec2(x, clamp(y, 0.002, 0.998)));
	if (c.a < 0.5) discard;
	ALBEDO = c.rgb * v_shade;
	ROUGHNESS = 0.9;
	SPECULAR = 0.2;
	BACKLIGHT = c.rgb * 0.25;
}
