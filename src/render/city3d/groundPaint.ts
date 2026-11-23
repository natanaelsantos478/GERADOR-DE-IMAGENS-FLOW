/**
 * Own ground for the detailed battle view (instead of the satellite photo): every land-cover / land-use polygon of the
 * vector map is filled with a tiling texture of its kind (Poly Haven, CC0: public/textures/ground), over a base ground
 * chosen by the climate (sand in deserts, dry soil in semi-arid land, snow near the poles, grass elsewhere). Water and
 * roads are drawn on top by roads.ts.
 */
import type { VectorArea, VPoly } from '../../data/vector/types';
import { aridityAt } from '../../sim/military/weather';
import type { TileRef } from './geo';

export const GROUND_KINDS = ['grass', 'forest', 'farmland', 'sand', 'rock', 'snow', 'mud', 'soil', 'pavement', 'industrial', 'asphalt', 'gravel', 'scrub'] as const;
export type GroundKind = (typeof GROUND_KINDS)[number];
export type GroundTex = Record<GroundKind, HTMLImageElement>;

let texP: Promise<GroundTex | null> | null = null;
/** The ground textures (loaded once; null if any failed). */
export function loadGroundTextures(): Promise<GroundTex | null> {
  return (texP ??= Promise.all(GROUND_KINDS.map((k) => new Promise<[GroundKind, HTMLImageElement]>((ok, bad) => {
    const im = new Image();
    im.onload = () => ok([k, im]); im.onerror = bad;
    im.src = new URL(`textures/ground/${k}.jpg`, document.baseURI).href;
  }))).then((l) => Object.fromEntries(l) as GroundTex).catch(() => null));
}

/** Vector class -> ground kind (land cover is more specific than land use, so it is painted after it). */
const USE: Record<string, GroundKind> = {
  residential: 'pavement', commercial: 'pavement', school: 'pavement', hospital: 'pavement', religious: 'pavement', military: 'gravel', transport: 'pavement', port: 'industrial',
  industrial: 'industrial', quarry: 'gravel', park: 'grass', cemetery: 'grass', recreation: 'grass', agriculture: 'farmland', airport: 'grass',
};
const COVER: Record<string, GroundKind> = { wood: 'forest', grass: 'grass', scrub: 'scrub', farmland: 'farmland', rock: 'rock', sand: 'sand', wetland: 'mud', snow: 'snow', residential: 'pavement' };

/** Base ground where the map says nothing, from the climate at the tile centre. */
export function baseGround(lon: number, lat: number): GroundKind {
  const arid = aridityAt(lon, lat);
  if (Math.abs(lat) > 66) return 'snow';
  if (arid >= 0.7) return 'sand';
  if (arid >= 0.4) return 'soil';
  return 'grass';
}

/** Metres covered by one repeat of a texture on the ground (big enough to read as natural variation at 1-2 m/px). */
const REPEAT_M = 14;

/**
 * Fills the tile canvas with the ground (call before water and roads). `k` = px per metre, `half` = tile half size (m).
 */
export function paintGround(g: CanvasRenderingContext2D, area: VectorArea, tile: TileRef, k: number, half: number, tex: GroundTex): void {
  const pats = new Map<GroundKind, CanvasPattern>();
  const pat = (kind: GroundKind) => {
    let p = pats.get(kind);
    if (!p) {
      p = g.createPattern(tex[kind], 'repeat')!;
      const s = (REPEAT_M * k) / tex[kind].width;
      p.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
      pats.set(kind, p);
    }
    return p;
  };
  const fillPoly = (p: VPoly, kind: GroundKind) => {
    g.fillStyle = pat(kind); g.beginPath();
    for (const r of p.rings) for (let i = 0; i < r.length / 2; i++) { const X = (r[i * 2] + half) * k, Y = (half - r[i * 2 + 1]) * k; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.fill('evenodd');
  };
  g.fillStyle = pat(baseGround(tile.lon0, tile.lat0));
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  // generic 'urban' land cover first (it spans whole cities), then land use (parks, industry...), then natural cover
  for (const p of area.landcover) if (p.cls === 'residential') fillPoly(p, 'pavement');
  for (const p of area.landuse) { const kind = USE[p.cls]; if (kind) fillPoly(p, kind); }
  for (const p of area.landcover) { const kind = COVER[p.cls]; if (kind && p.cls !== 'residential') fillPoly(p, kind); }
  // runways / taxiways / aprons: asphalt
  g.strokeStyle = pat('asphalt'); g.lineCap = 'butt';
  for (const l of area.aeroways) {
    const w = /runway/.test(l.cls) ? 45 : /taxi/.test(l.cls) ? 18 : 0;
    if (!w || l.pts.length < 4) continue;
    g.lineWidth = w * k; g.beginPath();
    for (let i = 0; i < l.pts.length / 2; i++) { const X = (l.pts[i * 2] + half) * k, Y = (half - l.pts[i * 2 + 1]) * k; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.stroke();
  }
}

/** Asphalt / gravel pattern for the road fill (same scale as the ground). */
export function roadPattern(g: CanvasRenderingContext2D, tex: GroundTex, k: number, kind: 'asphalt' | 'gravel'): CanvasPattern {
  const p = g.createPattern(tex[kind], 'repeat')!;
  const s = (12 * k) / tex[kind].width;
  p.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
  return p;
}
