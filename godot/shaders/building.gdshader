shader_type spatial;
// All buildings of a cell in one mesh/material. Materials come from one Texture2DArray; windows, sills and
// floors are drawn here from the wall size, so no texture per building is needed.
// UV  = metres (walls: u along the wall, v up from the foundation; roofs: metres on the roof plane)
// UV2 = (layer, wall length m)
// COLOR = (floor height m / 10 (0 = no windows), foundation m / 10, eave above foundation m / 40, tint)

uniform sampler2DArray alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray nrm : filter_linear_mipmap_anisotropic, repeat_enable;
uniform float tex_m = 2.5;  // metres per texture repeat

varying flat float v_layer;
varying flat float v_len;
varying flat vec4 v_c;

void vertex() {
	v_layer = UV2.x;
	v_len = UV2.y;
	v_c = COLOR;
}

void fragment() {
	vec3 t = vec3(UV / tex_m, v_layer);
	vec4 a = texture(alb, t);
	vec4 n = texture(nrm, t);
	float tint = v_c.a;
	vec3 col = a.rgb * mix(0.82, 1.12, tint);
	if (v_layer > 8.5) col *= 0.62;   // flat roofs: bitumen/gravel, not white concrete
	float rough = n.a;
	float spec = 0.4;
	vec3 nm = n.rgb;
	float ao = a.a;

	float fh = v_c.r * 10.0;
	if (fh > 0.5) {
		float found = v_c.g * 10.0;
		float eave = v_c.b * 40.0;
		float y = UV.y - found;
		if (y > 0.2 && y < eave - 0.35) {
			float bays = max(1.0, floor(v_len / 2.7));
			float bay = v_len / bays;
			float x = mod(UV.x, bay) - bay * 0.5;
			float fy = mod(y, fh);
			float floor_i = floor(y / fh);
			// ground floor of some bays: a door instead of a window
			float h = fract(sin(dot(vec2(floor(UV.x / bay), v_len), vec2(12.9898, 78.233))) * 43758.5453);
			bool door = floor_i < 0.5 && h < 0.18;
			float w = door ? 0.55 : 0.6;
			float y0 = door ? 0.0 : 0.95;
			float y1 = door ? 2.2 : 2.3;
			float frame = 0.07;
			bool inside = abs(x) < w && fy > y0 && fy < y1;
			bool glass = abs(x) < w - frame && fy > y0 + frame && fy < y1 - frame;
			bool sill = !door && abs(x) < w + 0.08 && fy > y0 - 0.1 && fy < y0;
			if (sill) {
				col = vec3(0.62, 0.6, 0.56);
				nm = vec3(0.5, 0.5, 1.0);
				rough = 0.7;
			}
			if (inside) {
				ao *= 0.8;
				if (glass && !door) {
					// glass: dark, glossy -> reflects the real sky; glazing bars in a cross
					bool bar = abs(x) < 0.025 || abs(fy - (y0 + y1) * 0.5) < 0.025;
					col = bar ? vec3(0.85) : vec3(0.03, 0.04, 0.05);
					rough = bar ? 0.6 : 0.04;
					spec = bar ? 0.4 : 0.9;
					nm = vec3(0.5, 0.5, 1.0);
				} else if (glass && door) {
					col = vec3(0.22, 0.13, 0.08) * (0.8 + 0.2 * h * 5.0);
					rough = 0.6;
					nm = vec3(0.5, 0.5, 1.0);
				} else {
					col = vec3(0.86, 0.85, 0.82);   // frame
					rough = 0.55;
					nm = vec3(0.5, 0.5, 1.0);
				}
			}
		}
		// darker plinth below the ground floor
		if (UV.y < found + 0.35) {
			col *= 0.7;
		}
	}
	ALBEDO = col;
	NORMAL_MAP = nm;
	ROUGHNESS = rough;
	SPECULAR = spec;
	AO = ao;
	AO_LIGHT_AFFECT = 0.3;
}
