shader_type spatial;
// Road ribbons draped on the relief. UV = (0..1 across, metres along); UV2 = (surface layer, flags)
// flags: 1 = centre line. Edges fade out with a dither (no transparency sorting) into the painted verge.

uniform sampler2DArray alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray nrm : filter_linear_mipmap_anisotropic, repeat_enable;

varying flat float v_layer;
varying flat float v_flags;
varying float v_width;

void vertex() {
	v_layer = UV2.x;
	v_flags = UV2.y;
	v_width = COLOR.r * 20.0;
}

void fragment() {
	vec2 uv = vec2(UV.x * v_width, UV.y) / 3.0;
	vec4 a = texture(alb, vec3(uv, v_layer));
	vec4 n = texture(nrm, vec3(uv, v_layer));
	vec3 col = a.rgb;
	float across = abs(UV.x - 0.5) * 2.0;
	// unpaved: two wheel tracks, grass in the middle
	if (v_layer > 0.5) {
		float wheel = smoothstep(0.15, 0.3, abs(across - 0.55));
		col = mix(col, col * vec3(0.75, 0.9, 0.6), wheel * 0.4);
	}
	// paved: dashed centre line and edge lines on main roads
	if (v_flags > 0.5) {
		bool dash = abs(UV.x - 0.5) * v_width < 0.07 && fract(UV.y / 9.0) < 0.35;
		bool edge = abs(across - 0.9) * v_width * 0.5 < 0.07;
		if (dash || edge) {
			col = vec3(0.8);
		}
	}
	float fade = 1.0 - smoothstep(0.82, 1.0, across);
	float noise = fract(sin(dot(floor(FRAGCOORD.xy), vec2(12.9898, 78.233))) * 43758.5453);
	if (fade < noise) discard;
	ALBEDO = col;
	NORMAL_MAP = n.rgb;
	ROUGHNESS = n.a;
	AO = a.a;
}
