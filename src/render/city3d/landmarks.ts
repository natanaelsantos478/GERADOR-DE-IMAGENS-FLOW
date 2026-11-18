/** Famous landmarks (public/data/landmarks.json): real glb placed on the ground, generic buildings under their footprint hidden. */
import * as Cesium from 'cesium';
import { tileXY, type TileRef } from './geo';

export interface Landmark {
  id: string; name: string; namePt?: string; lon: number; lat: number; groundElevM?: number;
  headingDeg: number; scale: number; model: string | null; heightM: number; footprintRadiusM: number; license?: string; author?: string;
}
let cat: Landmark[] = [];
let loaded: Promise<Landmark[]> | null = null;
export const landmarks = (): Landmark[] => cat;
export function loadLandmarks(): Promise<Landmark[]> {
  return (loaded ??= fetch(new URL('data/landmarks.json', document.baseURI), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : []))
    .then((j: unknown) => {
      const list = (Array.isArray(j) ? j : (j as { landmarks?: unknown[] })?.landmarks ?? []) as Landmark[];
      cat = list.filter((l) => l && typeof l.lon === 'number' && typeof l.lat === 'number' && l.id);
      return cat;
    })
    .catch(() => cat));
}
export interface LocalMark { x: number; y: number; r: number; hasModel: boolean }
/** Landmarks whose footprint touches this tile, in tile-local metres. */
export function marksFor(t: TileRef): LocalMark[] {
  const out: LocalMark[] = [];
  for (const l of cat) {
    const [gx, gy] = tileXY(l.lon, l.lat), x = (gx - (t.x + 0.5)) * t.sizeM, y = -(gy - (t.y + 0.5)) * t.sizeM, r = l.footprintRadiusM ?? 30;
    if (Math.abs(x) < t.sizeM / 2 + r && Math.abs(y) < t.sizeM / 2 + r) out.push({ x, y, r, hasModel: !!l.model });
  }
  return out;
}
export const modelUrl = (m: string) => {
  const f = m.endsWith('.glb') ? m : `${m}.glb`;
  return new URL(f.startsWith('models/') ? f : f.includes('/') ? `models/${f}` : `models/landmarks/${f}`, document.baseURI).href;
};

/** Loads/shows landmark models within `range` metres of the camera (much farther than ordinary buildings) and unloads them beyond 1.4x. */
export class LandmarkLayer {
  private models = new Map<string, { model: Cesium.Model | null; busy: boolean }>();
  constructor(private viewer: Cesium.Viewer, private heightAt: (lon: number, lat: number) => number) {}
  count() { return [...this.models.values()].filter((m) => m.model).length; }
  update(range: number) {
    const cam = this.viewer.camera.positionWC, scene = this.viewer.scene;
    for (const l of cat) {
      if (!l.model) continue;
      const ground = l.groundElevM ?? this.heightAt(l.lon, l.lat), pos = Cesium.Cartesian3.fromDegrees(l.lon, l.lat, ground), d = Cesium.Cartesian3.distance(cam, pos);
      let e = this.models.get(l.id);
      if (d > range * 1.4) { if (e?.model) { scene.primitives.remove(e.model); this.models.delete(l.id); } continue; }
      if (d > range) { if (e?.model) e.model.show = false; continue; }
      if (!e) { e = { model: null, busy: true }; this.models.set(l.id, e); void this.create(l, e, pos); } else if (e.model) e.model.show = true;
    }
  }
  private async create(l: Landmark, e: { model: Cesium.Model | null; busy: boolean }, pos: Cesium.Cartesian3) {
    try {
      const m = Cesium.Matrix4.multiplyByUniformScale(
        Cesium.Matrix4.multiplyTransformation(Cesium.Transforms.headingPitchRollToFixedFrame(pos, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(l.headingDeg ?? 0), 0, 0)), Cesium.Matrix4.IDENTITY, new Cesium.Matrix4()),
        l.scale || 1, new Cesium.Matrix4());
      const model = await Cesium.Model.fromGltfAsync({ url: modelUrl(l.model!), modelMatrix: m, allowPicking: false, shadows: Cesium.ShadowMode.DISABLED });
      if (!this.models.has(l.id)) return;
      this.viewer.scene.primitives.add(model); e.model = model;
      model.readyEvent.addEventListener(() => this.viewer.scene.requestRender());
    } catch (err) { console.warn('landmark', l.id, err); this.models.delete(l.id); } finally { e.busy = false; this.viewer.scene.requestRender(); }
  }
  destroy() { for (const e of this.models.values()) if (e.model) this.viewer.scene.primitives.remove(e.model); this.models.clear(); }
}
