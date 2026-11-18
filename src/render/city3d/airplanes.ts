/**
 * Civil aircraft parked at the real airport gates of the map (Overture `airport_gate` points), nose to the nearest
 * terminal building. The model is the country's real fleet (variants.json classes airliner_narrow / airliner_wide /
 * airliner_regional / bizjet / light_plane), mixed by airport size. They follow the game: a damaged airport keeps
 * fewer aircraft and a destroyed one (damage >= 0.6) none.
 */
import * as Cesium from 'cesium';
import type { VectorArea } from '../../data/vector/types';
import { loadVariants, resolveModel } from '../models/variants';
import { hash, projector, type TileRef } from './geo';
import type { Ground } from './ground';

export interface AirportInfo { index: number; lon: number; lat: number; size: 0 | 1 | 2; countryId: string | null; military: boolean }
type Source = () => { airports: readonly AirportInfo[]; damage: Record<number, number> } | null;
let source: Source = () => null;
/** The game tells where its airports are and how damaged they are (units/index.ts). */
export const setAirportSource = (f: Source) => { source = f; };

interface MfEntry { file: string; lengthM: number; nativeSize: number[]; yawOffsetDeg?: number }
let mfP: Promise<Record<string, MfEntry>> | null = null;
const manifest = () => (mfP ??= fetch(new URL('models/manifest.json', document.baseURI)).then((r) => r.json()));

/** Fleet mix per airport size (0 small, 1 medium, 2 large): [class, weight]. */
const MIX: Record<number, [string, number][]> = {
  2: [['airliner_narrow', 6], ['airliner_wide', 3], ['airliner_regional', 1]],
  1: [['airliner_narrow', 5], ['airliner_regional', 4], ['bizjet', 1]],
  0: [['light_plane', 3], ['bizjet', 1], ['airliner_regional', 1]],
};
/** Airfield radius by size (m): no trees there (the grass between runways reads green and the land-use map may call
 * it managed land / park). */
const FIELD_R = [120, 900, 1800];
/** Airfields touching a tile, in its local metres (trees.ts blocks them). */
export function airfieldsIn(tile: TileRef): { x: number; y: number; r: number }[] {
  const src = source(), out: { x: number; y: number; r: number }[] = [];
  if (!src) return out;
  const half = tile.sizeM / 2, k = (2 ** 14) / 360, kRad = Math.PI / 180;
  for (const a of src.airports) {
    if (Math.abs(a.lat - tile.lat0) > 0.15 || Math.abs(a.lon - tile.lon0) > 0.15) continue;
    const gx = (a.lon + 180) * k, gy = ((1 - Math.asinh(Math.tan(a.lat * kRad)) / Math.PI) / 2) * 2 ** 14;
    const x = (gx - (tile.x + 0.5)) * tile.sizeM, y = -(gy - (tile.y + 0.5)) * tile.sizeM, r = FIELD_R[a.size] ?? 120;
    if (Math.abs(x) < half + r && Math.abs(y) < half + r) out.push({ x, y, r });
  }
  return out;
}
/** Damage at or above which an airport has no aircraft left on its stands. */
export const DESTROYED = 0.6;
const R = 6371000;

export class AirportPlanes {
  private models: Cesium.Model[] = [];
  private dead = false;
  private shown = true;
  /** airport (game index) and damage bucket the current aircraft were built for */
  private airport = -1;
  private bucket = -1;
  count = 0;
  constructor(private scene: Cesium.Scene, private tile: TileRef, private area: VectorArea, private ground: Ground) {}

  private gates() {
    const half = this.tile.sizeM / 2;
    return this.area.infra.filter((o) => o.kind === 'airport_gate' && Math.abs(o.x) < half && Math.abs(o.y) < half);
  }
  /** The game's airport these gates belong to (nearest within 8 km of their centre). */
  private found: AirportInfo | null | undefined = undefined;
  private busy = false;
  private airportOf(gates: { x: number; y: number }[]) {
    const src = source();
    if (!src || !gates.length) return null;
    // the airport of a tile never moves: search the 48k list once, then only re-read its damage
    if (this.found !== undefined) return this.found ? { a: this.found, damage: src.damage[this.found.index] ?? 0 } : null;
    const cx = gates.reduce((s, g) => s + g.x, 0) / gates.length, cy = gates.reduce((s, g) => s + g.y, 0) / gates.length;
    const [lon, lat] = projector(this.tile).lonLat(cx, cy), k = Math.cos((lat * Math.PI) / 180);
    let best: AirportInfo | null = null, bd = 8000;
    for (const a of src.airports) {
      if (Math.abs(a.lat - lat) > 0.1) continue;
      const d = Math.hypot((a.lon - lon) * k, a.lat - lat) * (Math.PI / 180) * R;
      if (d < bd) { bd = d; best = a; }
    }
    this.found = best;
    return best ? { a: best, damage: src.damage[best.index] ?? 0 } : null;
  }

  /** (Re)build when the airport's damage changed bucket; cheap to call often. */
  async sync(): Promise<void> {
    if (this.dead || this.busy) return;
    this.busy = true;
    try { await this.syncInner(); } finally { this.busy = false; }
  }
  private async syncInner(): Promise<void> {
    const gates = this.gates(), hit = this.airportOf(gates);
    const bucket = !hit ? -1 : hit.damage >= DESTROYED ? 4 : Math.floor(hit.damage * 5);
    if (hit?.a.index === this.airport && bucket === this.bucket) return;
    this.airport = hit?.a.index ?? -1; this.bucket = bucket;
    this.clear();
    if (!hit || hit.damage >= DESTROYED || hit.a.military) return;
    await loadVariants();
    const mf = await manifest();
    if (this.dead) return;
    const proj = projector(this.tile), mix = MIX[hit.a.size] ?? MIX[1], tw = mix.reduce((s, m) => s + m[1], 0);
    const blds = this.area.buildings.map((b) => { const r = b.rings[0]; let x = 0, y = 0; const n = r.length / 2; for (let i = 0; i < n; i++) { x += r[i * 2]; y += r[i * 2 + 1]; } return [x / n, y / n] as [number, number]; });
    const hpr = new Cesium.HeadingPitchRoll();
    for (const [gi, g] of gates.entries()) {
      const hx = Math.round(g.x), hy = Math.round(g.y);
      // ~80 % of stands busy, fewer the more damaged the airport is
      if (hash(hx, hy, 41) > 0.8 * (1 - hit.damage)) continue;
      // nose toward the terminal: nearest building centre within 150 m
      let tx = 0, ty = 0, td = 150;
      for (const [bx, by] of blds) { const d = Math.hypot(bx - g.x, by - g.y); if (d < td && d > 3) { td = d; tx = bx; ty = by; } }
      if (td >= 150) continue;
      const dx = (tx - g.x) / td, dy = (ty - g.y) / td;
      let w = hash(hx, hy, 42) * tw, cls = mix[0][0];
      for (const [c, wt] of mix) { if (w < wt) { cls = c; break; } w -= wt; }
      const id = resolveModel(cls, hit.a.countryId ?? undefined, `${this.tile.key}:${gi}`, { mf: mf as never });
      const info = mf[id];
      if (!info) continue;
      // the gate point is the stand's nose position: the aircraft centre sits half a length out on the apron
      const cx = g.x - dx * (info.lengthM / 2 + 3), cy = g.y - dy * (info.lengthM / 2 + 3);
      const headingDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
      hpr.heading = Cesium.Math.toRadians(headingDeg - 90 + (info.yawOffsetDeg ?? 0));
      const pos = proj.ecef(cx, cy, this.ground(cx, cy));
      const model = await Cesium.Model.fromGltfAsync({
        url: new URL(`models/${info.file}`, document.baseURI).href, scale: info.lengthM / Math.max(...info.nativeSize),
        modelMatrix: Cesium.Transforms.headingPitchRollToFixedFrame(pos, hpr), shadows: Cesium.ShadowMode.DISABLED, allowPicking: false, show: this.shown,
      });
      if (this.dead || this.airport !== hit.a.index) { model.destroy(); return; }
      this.scene.primitives.add(model);
      this.models.push(model);
    }
    this.count = this.models.length;
    this.scene.requestRender();
  }
  show(v: boolean) { if (v === this.shown) return; this.shown = v; for (const m of this.models) m.show = v; }
  private clear() { for (const m of this.models) this.scene.primitives.remove(m); this.models = []; this.count = 0; }
  dispose() { this.dead = true; this.clear(); }
}
