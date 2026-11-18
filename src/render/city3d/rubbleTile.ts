/** Per-tile destruction: hides the standing buildings of the ruins, plays the collapse (local-frame primitives with an animated model matrix) and keeps one batched rubble primitive. */
import * as Cesium from 'cesium';
import { buildBuildings, polyCentroid } from './buildings';
import { sharedAppearance, type CityTile } from './tile';
import { hash, projector, TZ, tileXY, type TileRef } from './geo';
import { Mesh } from './mesh';
import { collapsePose, generateRubble, inRing, type CollapseSpec } from './rubble';
import { emitRubble } from './rubbleMesh';
import { ruinProgress, ruinsNow, type Ruin } from './ruins';
import { styles } from './styles';

/** A ruin expressed in one tile's local metres. */
interface LocalRuin { r: Ruin; ring: number[]; cx: number; cy: number; x0: number; x1: number; y0: number; y1: number }
interface Anim { bld: Cesium.Primitive[]; heap: Cesium.Primitive[]; pivot: Cesium.Cartesian3; dir: [number, number]; spec: CollapseSpec; lr: LocalRuin }

const HIDE_MARGIN = 2.5;
const toLocal = (t: TileRef, lon: number, lat: number): [number, number] => {
  const [gx, gy] = tileXY(lon, lat, TZ);
  return [(gx - (t.x + 0.5)) * t.sizeM, -(gy - (t.y + 0.5)) * t.sizeM];
};
function distToRing(r: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const ax = r[j * 2], ay = r[j * 2 + 1], ex = r[i * 2] - ax, ey = r[i * 2 + 1] - ay, l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
    best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return best;
}
/** Does the building whose footprint centroid is (cx,cy) belong to this ruin (inside / touching its footprint, or at its centre)? */
const covers = (l: LocalRuin, cx: number, cy: number): boolean =>
  cx >= l.x0 && cx <= l.x1 && cy >= l.y0 && cy <= l.y1 && (Math.hypot(cx - l.cx, cy - l.cy) <= 3 || inRing(l.ring, cx, cy) || distToRing(l.ring, cx, cy) <= HIDE_MARGIN);

const M = new Cesium.Matrix4(), M2 = new Cesium.Matrix4(), R3 = new Cesium.Matrix3(), Q = new Cesium.Quaternion(), AXIS = new Cesium.Cartesian3(), T = new Cesium.Cartesian3(), S = new Cesium.Cartesian3(), NEG = new Cesium.Cartesian3();

export class TileRubble {
  private mine: LocalRuin[] = [];
  private cache = new Map<string, LocalRuin>();
  /** Signature of the hidden set the building meshes were last built with / the done set the rubble primitive shows. */
  private builtSig = '';
  private doneSig = '';
  private done: Cesium.Primitive | null = null;
  private anim = new Map<string, Anim>();
  stats = { hidden: 0, done: 0, animating: 0, tris: 0 };
  constructor(private t: CityTile) {}

  private local(r: Ruin): LocalRuin {
    const k = r.key;
    let l = this.cache.get(k);
    if (l && l.r === r) return l;
    const ring: number[] = [];
    for (let i = 0; i < r.ring.length; i += 2) ring.push(...toLocal(this.t.ref, r.ring[i], r.ring[i + 1]));
    const [cx, cy] = toLocal(this.t.ref, r.lon, r.lat);
    let x0 = cx, x1 = cx, y0 = cy, y1 = cy;
    for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); y0 = Math.min(y0, ring[i + 1]); y1 = Math.max(y1, ring[i + 1]); }
    l = { r, ring, cx, cy, x0: x0 - HIDE_MARGIN, x1: x1 + HIDE_MARGIN, y0: y0 - HIDE_MARGIN, y1: y1 + HIDE_MARGIN };
    this.cache.set(k, l);
    return l;
  }
  /** Recompute the ruins that fall in this tile; returns the signature of the set whose buildings must be hidden. */
  private compute(): string {
    const half = this.t.ref.sizeM / 2, out: LocalRuin[] = [];
    for (const r of ruinsNow()) {
      const [x, y] = toLocal(this.t.ref, r.lon, r.lat);
      if (Math.abs(x) <= half && Math.abs(y) <= half) out.push(this.local(r));
    }
    this.mine = out;
    return out.map((l) => l.r.key).sort().join('|');
  }
  /** The hidden set changed since the building meshes were last built. */
  needsRebuild(): boolean { return this.compute() !== this.builtSig; }
  /** Predicate for `buildBuildings`: true for the buildings of the ruins (called by the tile when it (re)builds its meshes). */
  hideFn(): ((cx: number, cy: number) => boolean) | undefined {
    this.builtSig = this.compute();
    const list = this.mine;
    this.stats.hidden = list.length;
    return list.length ? (cx, cy) => list.some((l) => covers(l, cx, cy)) : undefined;
  }

  /** Bring the tile in line with the store: hide / rebuild, rubble primitive, collapse animations. */
  sync(): void {
    const t = this.t, st = styles();
    if (t.state !== 'ready' || t.generating || t.dead || !t.area || !t.ground || !st) return;
    const sig = this.compute();
    if (sig !== this.builtSig) void t.rebuildBuildings();
    const done: LocalRuin[] = [], running: LocalRuin[] = [];
    for (const l of this.mine) (ruinProgress(l.r) >= 1 ? done : running).push(l);
    const dsig = done.map((l) => l.r.key).sort().join('|');
    if (dsig !== this.doneSig) { this.doneSig = dsig; this.buildDone(done); }
    for (const [k, a] of [...this.anim]) if (!running.some((l) => l.r.key === k)) { this.dropAnim(a); this.anim.delete(k); }
    for (const l of running) {
      let a = this.anim.get(l.r.key);
      if (!a) { a = this.startAnim(l); if (!a) continue; this.anim.set(l.r.key, a); }
      this.pose(a, ruinProgress(l.r));
    }
    this.stats.done = done.length; this.stats.animating = this.anim.size; this.stats.hidden = this.mine.length;
    t.viewer.scene.requestRender();
  }

  private prim(m: Mesh, mat: Cesium.Matrix4): Cesium.Primitive | null {
    const ap = sharedAppearance();
    if (m.empty || !ap) return null;
    return this.t.viewer.scene.primitives.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: m.toGeometry() }), appearance: ap.appearance, asynchronous: false, modelMatrix: Cesium.Matrix4.clone(mat),
      compressVertices: false, interleave: false, vertexCacheOptimize: false, allowPicking: false, releaseGeometryInstances: true, shadows: Cesium.ShadowMode.DISABLED, show: true,
    })) as Cesium.Primitive;
  }
  private remove(p: Cesium.Primitive | null) { if (p) this.t.viewer.scene.primitives.remove(p); }

  /** All finished ruins of the tile in ONE primitive (rebuilt only when the set changes). */
  private buildDone(list: LocalRuin[]) {
    const t = this.t, st = styles()!;
    this.remove(this.done); this.done = null;
    this.stats.tris = 0;
    if (!list.length) return;
    const m = new Mesh(t.ref, true);
    for (const l of list) {
      const model = generateRubble(st.rubble, { id: l.r.id, mat: l.r.m, fl: l.r.fl, ring: l.ring });
      emitRubble(m, model, t.ground!(model.cx, model.cy), t.atlas);
    }
    this.stats.tris = m.tris;
    this.done = this.prim(m, t.ref.enu);
  }

  private startAnim(l: LocalRuin): Anim | undefined {
    const t = this.t, st = styles()!, spec = st.rubble.collapse[l.r.by];
    const polys = t.area!.buildings.filter((p) => {
      const [cx, cy] = polyCentroid(p), half = t.ref.sizeM / 2;
      return Math.abs(cx) <= half && Math.abs(cy) <= half && covers(l, cx, cy);
    });
    const bm = buildBuildings(polys, t.ref, t.ground!, st, [], t.atlas, { local: true });
    const model = generateRubble(st.rubble, { id: l.r.id, mat: l.r.m, fl: l.r.fl, ring: l.ring });
    const hm = new Mesh(t.ref, true);
    const gz = t.ground!(model.cx, model.cy);
    emitRubble(hm, model, gz, t.atlas);
    const bld = [this.prim(bm.major, t.ref.enu), this.prim(bm.minor, t.ref.enu)].filter((p): p is Cesium.Primitive => !!p);
    const heap = [this.prim(hm, t.ref.enu)].filter((p): p is Cesium.Primitive => !!p);
    // wall falls away from the breaching vehicle; otherwise a seeded direction
    let dir: [number, number];
    if (spec.style === 'breach' && l.r.brk) {
      const [bx, by] = toLocal(t.ref, l.r.brk[0], l.r.brk[1]), dx = l.cx - bx, dy = l.cy - by, d = Math.hypot(dx, dy) || 1;
      dir = [dx / d, dy / d];
    } else { const a = hash(l.r.id, 7, 3) * Math.PI * 2; dir = [Math.cos(a), Math.sin(a)]; }
    const pivot = projector(t.ref).local(model.cx, model.cy, gz);
    return { bld, heap, pivot, dir, spec, lr: l };
  }
  private dropAnim(a: Anim) { for (const p of [...a.bld, ...a.heap]) this.remove(p); }

  /** modelMatrix = tileENU * T(pivot + shake) * Rot(tilt about the horizontal axis normal to `dir`) * Scale(1,1,sink) * T(-pivot). */
  private pose(a: Anim, p: number) {
    const c = collapsePose(a.spec, p, a.lr.r.id), pv = a.pivot, enu = this.t.ref.enu;
    Cesium.Cartesian3.negate(pv, NEG);
    Cesium.Matrix4.fromTranslation(NEG, M);                         // T(-pivot)
    Cesium.Matrix4.fromScale(Cesium.Cartesian3.fromElements(1, 1, c.sink, S), M2);
    Cesium.Matrix4.multiply(M2, M, M);                              // S * T(-pivot)
    Cesium.Cartesian3.fromElements(-a.dir[1], a.dir[0], 0, AXIS);
    Cesium.Quaternion.fromAxisAngle(AXIS, c.tilt, Q);
    Cesium.Matrix3.fromQuaternion(Q, R3);
    Cesium.Matrix4.fromRotationTranslation(R3, Cesium.Cartesian3.fromElements(pv.x + c.shx, pv.y + c.shy, pv.z, T), M2);
    Cesium.Matrix4.multiply(M2, M, M);                              // T * R * S * T(-pivot)
    for (const pr of a.bld) Cesium.Matrix4.multiply(enu, M, pr.modelMatrix);
    // the heap grows from the ground at the pivot
    Cesium.Matrix4.fromTranslation(NEG, M);
    Cesium.Matrix4.fromScale(Cesium.Cartesian3.fromElements(1, 1, c.grow, S), M2);
    Cesium.Matrix4.multiply(M2, M, M);
    Cesium.Matrix4.fromTranslation(pv, M2);
    Cesium.Matrix4.multiply(M2, M, M);
    for (const pr of a.heap) Cesium.Matrix4.multiply(enu, M, pr.modelMatrix);
  }

  /** Forget everything drawn (the tile regenerates or dies); the store keeps the truth. */
  reset() {
    this.remove(this.done); this.done = null; this.doneSig = '';
    for (const a of this.anim.values()) this.dropAnim(a);
    this.anim.clear(); this.cache.clear(); this.builtSig = '';
    this.stats = { hidden: 0, done: 0, animating: 0, tris: 0 };
  }
}
