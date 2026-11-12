/** Shared render helpers: event emitter for audio, glb pool, tinted icon canvases, ENU maths, continuous-render lock. */
import * as Cesium from 'cesium';
import type { LonLat } from '../../core/contracts';
import type { Globe } from '../globe/types';

// ------------------------------------------------------------------ events (UI plays sounds from these)
export type RenderEvent =
  | { type: 'explosion'; pos: LonLat; size: 'small' | 'large' }
  | { type: 'nuke'; pos: LonLat }
  | { type: 'missileLaunch'; pos: LonLat; weapon: string }
  | { type: 'battleStart'; pos: LonLat }
  | { type: 'tacShot'; kind: string; side: 0 | 1 }
  | { type: 'tacExplosion'; kind: string }
  | { type: 'tacOrder'; ok: boolean }
  | { type: 'commandRejected'; reason: string };
type Listener = (e: RenderEvent) => void;
const listeners = new Set<Listener>();
export const renderEvents = {
  on(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(e: RenderEvent) {
    listeners.forEach((f) => f(e));
  },
};

/** Set by the tactical layer: strategic glb formations step aside while a battle is on screen. */
export const mode = { tactical: false };

// ------------------------------------------------------------------ continuous render lock
const locks = new Set<string>();
export function renderLock(globe: Globe, key: string, on: boolean) {
  const had = locks.size > 0;
  if (on) locks.add(key);
  else locks.delete(key);
  if (had !== locks.size > 0) globe.setContinuousRender(locks.size > 0);
}

// ------------------------------------------------------------------ geo
export const M_PER_DEG = 111_320;
export const rad = (d: number) => (d * Math.PI) / 180;
export function offsetLonLat(lon: number, lat: number, east: number, north: number): LonLat {
  return [lon + east / (M_PER_DEG * Math.cos(rad(lat))), lat + north / M_PER_DEG];
}
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerpAngle = (a: number, b: number, t: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

// ------------------------------------------------------------------ manifest
export interface ModelInfo { file: string; lengthM: number; yawOffsetDeg: number; zOffsetM: number; nativeSize: [number, number, number]; animations?: string[]; animationRoles?: Record<string, string> }
export type Manifest = Record<string, ModelInfo>;
let manifestP: Promise<Manifest> | null = null;
export const loadManifest = () => (manifestP ??= fetch(new URL('models/manifest.json', document.baseURI)).then((r) => r.json() as Promise<Manifest>));
export const assetUrl = (p: string) => new URL(p, document.baseURI).href;

// ------------------------------------------------------------------ glb pool
export interface ModelHandle {
  modelId: string;
  model: Cesium.Model | null;
  released: boolean;
  id: unknown;
  scaleMul: number;
  anim: string | null;
  wantAnim: string | null;
  once: boolean;
  tint: number;
  pend: Cesium.Matrix4 | null;
  shown: boolean;
}
const HPR = new Cesium.HeadingPitchRoll();
const SCRATCH = new Cesium.Cartesian3();

export class ModelPool {
  private free = new Map<string, Cesium.Model[]>();
  private all = new Set<Cesium.Model>();
  constructor(private scene: Cesium.Scene, private mf: Manifest) {}

  info(modelId: string): ModelInfo | undefined { return this.mf[modelId]; }
  baseScale(modelId: string): number {
    const i = this.mf[modelId];
    return i ? i.lengthM / Math.max(...i.nativeSize) : 1;
  }
  get liveCount(): number { return this.all.size; }

  acquire(modelId: string, id: unknown): ModelHandle | null {
    const info = this.mf[modelId];
    if (!info) return null;
    const h: ModelHandle = { modelId, model: null, released: false, id, scaleMul: 1, anim: null, wantAnim: null, once: false, tint: 0, pend: null, shown: false };
    const m = this.free.get(modelId)?.pop();
    if (m) this.bind(h, m);
    else {
      Cesium.Model.fromGltfAsync({ url: assetUrl(`models/${info.file}`), id: h.id, scale: this.baseScale(modelId), show: false, allowPicking: true })
        .then((model) => {
          this.all.add(model);
          this.scene.primitives.add(model);
          model.readyEvent.addEventListener(() => {
            this.applyAnim(h);
            this.scene.requestRender();
          });
          if (h.released) this.stash(modelId, model);
          else this.bind(h, model);
        })
        .catch((e) => console.error(`modelo ${modelId}`, e));
    }
    return h;
  }
  private bind(h: ModelHandle, m: Cesium.Model) {
    h.model = m;
    (m as unknown as { id: unknown }).id = h.id;
    m.color = Cesium.Color.WHITE;
    m.colorBlendAmount = 0;
    if (h.pend) { m.modelMatrix = h.pend; m.show = h.shown; }
    this.applyAnim(h);
    this.setTint(h, h.tint);
  }
  private stash(modelId: string, m: Cesium.Model) {
    m.show = false;
    m.activeAnimations.removeAll();
    let l = this.free.get(modelId);
    if (!l) this.free.set(modelId, (l = []));
    l.push(m);
  }
  release(h: ModelHandle) {
    h.released = true;
    if (h.model) this.stash(h.modelId, h.model);
    h.model = null;
  }
  /** Position `h` at lon/lat/height; `headingDeg` clockwise from north; `mul` exaggeration. */
  place(h: ModelHandle, lon: number, lat: number, height: number, headingDeg: number, mul: number, roll = 0, show = true) {
    const info = this.mf[h.modelId];
    Cesium.Cartesian3.fromDegrees(lon, lat, height + (info?.zOffsetM ?? 0) * mul, undefined, SCRATCH);
    HPR.heading = rad(headingDeg - 90 + (info?.yawOffsetDeg ?? 0));
    HPR.pitch = 0;
    HPR.roll = rad(roll);
    const m = Cesium.Transforms.headingPitchRollToFixedFrame(SCRATCH, HPR, undefined, undefined, h.pend ?? new Cesium.Matrix4());
    h.pend = m;
    h.shown = show;
    h.scaleMul = mul;
    if (h.model) {
      h.model.modelMatrix = m;
      h.model.scale = this.baseScale(h.modelId) * mul;
      h.model.show = show;
    }
  }
  hide(h: ModelHandle) {
    h.shown = false;
    if (h.model) h.model.show = false;
  }
  setAnim(h: ModelHandle, role: string, once = false) {
    const info = this.mf[h.modelId];
    const name = info?.animationRoles?.[role] ?? role;
    if (h.wantAnim === name) return;
    h.wantAnim = name;
    h.once = once;
    this.applyAnim(h);
  }
  private applyAnim(h: ModelHandle) {
    const m = h.model;
    if (!m || !m.ready || !h.wantAnim || h.anim === h.wantAnim) return;
    if (!m.activeAnimations) return;
    m.activeAnimations.removeAll();
    m.activeAnimations.animateWhilePaused = true;
    try {
      m.activeAnimations.add({ name: h.wantAnim, loop: h.once ? Cesium.ModelAnimationLoop.NONE : Cesium.ModelAnimationLoop.REPEAT, multiplier: 1 });
      h.anim = h.wantAnim;
    } catch { /* clip missing in this glb */ }
  }
  /** 0 normal, 1 charred (destroyed), 2 translucent (under construction). */
  setTint(h: ModelHandle, kind: number) {
    h.tint = kind;
    const m = h.model;
    if (!m) return;
    if (kind === 1) { m.color = Cesium.Color.fromCssColorString('#262626'); m.colorBlendMode = Cesium.ColorBlendMode.MIX; m.colorBlendAmount = 0.85; }
    else if (kind === 2) { m.color = Cesium.Color.fromCssColorString('#ffb347').withAlpha(0.55); m.colorBlendMode = Cesium.ColorBlendMode.MIX; m.colorBlendAmount = 0.5; }
    else { m.color = Cesium.Color.WHITE; m.colorBlendAmount = 0; }
  }
  destroy() {
    for (const m of this.all) this.scene.primitives.remove(m);
    this.all.clear();
    this.free.clear();
  }
}

// ------------------------------------------------------------------ icon canvases
const svgCache = new Map<string, Promise<HTMLImageElement>>();
export function svgImage(name: string, color: string): Promise<HTMLImageElement> {
  const key = `${name}|${color}`;
  let p = svgCache.get(key);
  if (!p) {
    p = fetch(assetUrl(`icons/${name}.svg`)).then((r) => r.text()).then(async (t) => {
      const url = URL.createObjectURL(new Blob([t.replace(/currentColor/g, color)], { type: 'image/svg+xml' }));
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    });
    svgCache.set(key, p);
  }
  return p;
}

/** Round badge: dark disc, coloured ring, white glyph. Draws synchronously once the glyph is cached. */
export function badgeCanvas(glyph: HTMLImageElement | null, ring: string, size = 44, dashed = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  g.fillStyle = 'rgba(8,14,22,0.88)';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = ring;
  if (dashed) g.setLineDash([6, 4]);
  g.stroke();
  if (glyph) { const m = size * 0.24; g.drawImage(glyph, m, m, size - 2 * m, size - 2 * m); }
  return c;
}

export function textBadge(text: string, bg: string, fg = '#fff', w = 30, h = 20): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 0, w, h, 6);
  g.fill();
  g.fillStyle = fg;
  g.font = 'bold 13px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);
  return c;
}

/** Soft radial sprite (smoke / flash / glow). */
export function spriteCanvas(rgb: [number, number, number], alpha = 1, size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`);
  r.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha * 0.5})`);
  r.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Terrain height clamped to sea level (the globe can report garbage for half-loaded tiles). */
export const groundOf = (globe: Globe) => (lon: number, lat: number) => Math.max(0, globe.heightAt(lon, lat));
