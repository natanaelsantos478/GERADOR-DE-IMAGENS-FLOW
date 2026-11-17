/** Custom appearance for the city mesh: vertex colours, procedural facade windows (no textures), sun-coherent lambert + sky ambient, distance haze. */
import * as Cesium from 'cesium';

const VS = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in vec4 color;
in float batchId;
out vec3 v_positionEC;
out vec3 v_normalEC;
out vec2 v_st;
out vec4 v_color;
void main() {
  vec4 p = czm_computePosition();
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_normalEC = czm_normal * normal;
  v_st = st;
  v_color = color;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}`;

const FS = `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec2 v_st;
in vec4 v_color;
float box(vec2 f, vec2 u, vec2 v) { return step(u.x, f.x) * step(f.x, u.y) * step(v.x, f.y) * step(f.y, v.y); }
void main() {
  vec3 N = normalize(v_normalEC);
  vec3 V = normalize(-v_positionEC);
  vec3 L = normalize(czm_lightDirectionEC);
  vec3 base = v_color.rgb;
  float pat = v_color.a;
  float win = 0.0, spec = 0.0;
  vec3 glass = vec3(0.1, 0.14, 0.2);
  if (pat > 0.02 && pat < 0.98) {
    float fl = pat < 0.4 ? 3.0 : (pat < 0.7 ? 3.5 : 3.8);
    float wd = pat < 0.4 ? 3.2 : (pat < 0.7 ? 3.0 : 1.9);
    vec2 cell = vec2(v_st.x / wd, v_st.y / fl);
    vec2 f = fract(cell);
    float cover;
    if (pat < 0.4) { win = box(f, vec2(0.24, 0.76), vec2(0.3, 0.82)); cover = 0.28; }
    else if (pat < 0.7) { win = box(f, vec2(0.06, 0.94), vec2(0.28, 0.84)); cover = 0.5; }
    else { win = box(f, vec2(0.04, 0.96), vec2(0.1, 0.9)); cover = 0.8; }
    float fw = max(fwidth(cell.x), fwidth(cell.y));
    win = mix(win, cover, smoothstep(0.3, 0.75, fw));
    win *= step(0.9, v_st.y); // no windows underground / on the foundation
    float r = fract(sin(dot(floor(cell), vec2(12.9898, 78.233))) * 43758.5453);
    glass = mix(vec3(0.09, 0.12, 0.17), vec3(0.42, 0.55, 0.68), 0.25 + 0.5 * r * r) * (pat > 0.7 ? 1.25 : 1.0);
    spec = win;
  }
  vec3 albedo = mix(base, glass, win * 0.88);
  vec3 up = normalize(czm_viewerPositionWC);
  float upness = dot(normalize(czm_inverseViewRotation * N), up);
  float diff = max(dot(N, L), 0.0);
  vec3 lc = min(czm_lightColor, vec3(1.7));
  vec3 amb = mix(vec3(0.34, 0.33, 0.34), vec3(0.58, 0.64, 0.72), 0.5 + 0.5 * upness);
  vec3 col = albedo * (amb * 0.98 + lc * diff * 0.78);
  vec3 H = normalize(L + V);
  col += lc * pow(max(dot(N, H), 0.0), 40.0) * 0.5 * spec * win;
  float dist = length(v_positionEC);
  col = mix(col, vec3(0.64, 0.72, 0.82), smoothstep(3000.0, 14000.0, dist) * 0.4);
  out_FragColor = vec4(col, 1.0);
}`;

export function cityAppearance(): Cesium.Appearance {
  return new Cesium.Appearance({
    translucent: false, closed: false,
    vertexShaderSource: VS, fragmentShaderSource: FS,
    renderState: { depthTest: { enabled: true }, depthMask: true, cull: { enabled: false } },
  });
}
