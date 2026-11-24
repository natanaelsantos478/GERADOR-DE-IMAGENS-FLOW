shader_type spatial;
// Roads, sidewalks, curbs, crossings and airport surfaces. UV = (0..1 across, metres along);
// UV2 = (layer, paint flags); COLOR.r = strip width / 20, COLOR.g = lanes / 10.
// flags: 1 dashed centre, 2 solid centre, 4 edge lines, 8 zebra, 16 runway, 32 taxiway, 64 lane dividers.
// Paint follows Belgian / Vienna-convention road markings: white, 15 cm lines, 3 m dash / 9 m gap on roads.

uniform sampler2DArray alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray nrm : filter_linear_mipmap_anisotropic, repeat_enable;

varying flat float v_layer;
varying flat int v_flags;
varying flat float v_width;
varying flat float v_lanes;

void vertex() {
	v_layer = UV2.x;
	v_flags = int(UV2.y + 0.5);
	v_width = COLOR.r * 20.0;
	v_lanes = COLOR.g * 10.0;
}

void fragment() {
	float w = max(v_width, 0.2);
	vec2 uv = vec2(UV.x * w, UV.y) / 3.0;
	vec4 a = texture(alb, vec3(uv, v_layer));
	vec4 n = texture(nrm, vec3(uv, v_layer));
	vec3 col = a.rgb;
	float rough = n.a;
	float x = (UV.x - 0.5) * w;          // metres from the centre line
	float across = abs(UV.x - 0.5) * 2.0;
	float paint = 0.0;
	vec3 paint_col = vec3(0.86);
	if (v_layer > 0.5 && v_layer < 3.5) {
		// unpaved: two wheel ruts, grass in the middle
		float wheel = smoothstep(0.15, 0.3, abs(across - 0.55));
		col = mix(col, col * vec3(0.75, 0.9, 0.6), wheel * 0.4);
	}
	if ((v_flags & 1) != 0 && abs(x) < 0.075 && fract(UV.y / 12.0) < 0.25) paint = 1.0;
	if ((v_flags & 2) != 0 && abs(x) < 0.075) paint = 1.0;
	if ((v_flags & 4) != 0 && abs(abs(x) - (w * 0.5 - 0.35)) < 0.1) paint = 1.0;
	if ((v_flags & 64) != 0 && v_lanes >= 2.0) {
		float lane = w / v_lanes;
		float lx = mod(x + w * 0.5, lane);
		if ((lx < 0.075 || lx > lane - 0.075) && abs(x) < w * 0.5 - 0.5 && fract(UV.y / 12.0) < 0.25) paint = 1.0;
	}
	if ((v_flags & 8) != 0) {
		// zebra: 50 cm white bars along the road direction, every metre, 0.5 m kept clear at the kerbs
		if (fract(x / 1.0) < 0.5 && abs(x) < w * 0.5 - 0.3) paint = 1.0;
		else col *= 0.92;
	}
	if ((v_flags & 16) != 0) {
		// runway: dashed centre line (30 m dash / 20 m gap, 0.9 m), side stripes, threshold "piano keys"
		if (abs(x) < 0.45 && fract(UV.y / 50.0) < 0.6) paint = 1.0;
		if (abs(abs(x) - (w * 0.5 - 1.0)) < 0.45) paint = 1.0;
		if (UV.y < 60.0 && UV.y > 6.0 && abs(x) > 3.0 && abs(x) < w * 0.5 - 3.0 && fract((abs(x) - 3.0) / 3.6) < 0.5) paint = 1.0;
	}
	if ((v_flags & 32) != 0 && abs(x) < 0.08) {
		paint = 1.0;
		paint_col = vec3(0.85, 0.68, 0.12);    // taxiway centre line: yellow
	}
	if (paint > 0.5) {
		col = paint_col * (0.85 + 0.15 * a.a);
		rough = 0.55;
	}
	// edges fade into the verge with a dither (roads only; sidewalks, curbs and crossings stay sharp)
	if (v_layer < 3.5 && (v_flags & 8) == 0) {
		float fade = 1.0 - smoothstep(0.86, 1.0, across);
		float noise = fract(sin(dot(floor(FRAGCOORD.xy), vec2(12.9898, 78.233))) * 43758.5453);
		if (fade < noise) discard;
	}
	ALBEDO = col;
	NORMAL_MAP = n.rgb;
	ROUGHNESS = rough;
	AO = a.a;
}
