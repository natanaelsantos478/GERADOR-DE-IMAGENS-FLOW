/** geojson-vt backed canvas drawing: fills (map mode), borders, highlights, roads. */
import GeoJSONVT, { type LegacyFeature } from 'geojson-vt';
import type { GeoFeature, GeoFeatureCollection } from '../../core/contracts';
import type { DrawTile } from './canvasProvider';
import type { RGBA } from './types';

export const EXTENT = 4096;
const VT_OPTS = { maxZoom: 15, indexMaxZoom: 3, indexMaxPoints: 150000, tolerance: 3, extent: EXTENT, buffer: 96 };

export const buildIndex = (data: GeoFeatureCollection | GeoJSON.FeatureCollection) =>
  new GeoJSONVT(data as GeoJSON.FeatureCollection, VT_OPTS);

export const css = (c: RGBA | number[], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Adds the rings of a polygon / lines of a line feature to the current path (tile px). */
export function tracePath(g: CanvasRenderingContext2D, f: LegacyFeature, k: number, close: boolean) {
  if (f.type === 1) return;
  const rings = f.geometry as [number, number][][];
  for (const r of rings) {
    if (r.length < 2) continue;
    g.moveTo(r[0][0] * k, r[0][1] * k);
    for (let i = 1; i < r.length; i++) g.lineTo(r[i][0] * k, r[i][1] * k);
    if (close) g.closePath();
  }
}

// ------------------------------------------------------------------ fills

export class FillPainter {
  readonly index: GeoJSONVT;
  /** feature id → css colour (opaque). */
  colors = new Map<string, string>();
  /** feature id → css colour of the occupier (hatch). */
  hatch = new Map<string, string>();
  private patterns = new Map<string, CanvasPattern>();
  private patCtx = document.createElement('canvas').getContext('2d')!;

  constructor(fc: GeoFeatureCollection) {
    this.index = buildIndex(fc);
  }

  private pattern(color: string): CanvasPattern {
    let p = this.patterns.get(color);
    if (!p) {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const g = c.getContext('2d')!;
      g.strokeStyle = color;
      g.lineWidth = 2.2;
      g.beginPath();
      for (const o of [-8, 0, 8]) {
        g.moveTo(o, 8);
        g.lineTo(o + 8, 0);
      }
      g.stroke();
      p = this.patCtx.createPattern(c, 'repeat')!;
      this.patterns.set(color, p);
    }
    return p;
  }

  draw: DrawTile = (g, z, x, y, size) => {
    const t = this.index.getTile(z, x, y);
    if (!t) return false;
    const k = size / EXTENT;
    for (const f of t.features) {
      const id = (f.tags?.id as string | undefined) ?? '';
      const c = this.colors.get(id);
      if (!c) continue;
      g.beginPath();
      tracePath(g, f, k, true);
      g.fillStyle = c;
      g.fill('evenodd');
      const h = this.hatch.get(id);
      if (h) {
        g.fillStyle = this.pattern(h);
        g.fill('evenodd');
      }
    }
  };
}

// ------------------------------------------------------------------ borders

export function bordersDraw(index: GeoJSONVT, kind: 'country' | 'province'): DrawTile {
  return (g, z, x, y, size) => {
    if (kind === 'province' && z < 3) return false;
    const t = index.getTile(z, x, y);
    if (!t) return false;
    const k = size / EXTENT;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    for (const f of t.features) tracePath(g, f, k, true);
    if (kind === 'province') {
      const a = Math.min(0.75, 0.25 + (z - 3) * 0.12);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.6;
      g.stroke();
      g.strokeStyle = `rgba(255,255,255,${a})`;
      g.lineWidth = 0.7;
      g.stroke();
    } else {
      const w = z >= 8 ? 1.4 : Math.min(3.2, 1.1 + z * 0.26);
      const fade = z >= 8 ? 0.55 : 0.95;
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = w + 1.6;
      g.stroke();
      g.strokeStyle = `rgba(255,244,214,${fade})`;
      g.lineWidth = w;
      g.stroke();
    }
  };
}

// ------------------------------------------------------------------ highlight

export interface HighlightSet {
  provinces: string[];
  countries: string[];
}
export class HighlightPainter {
  private idx: Partial<Record<'select' | 'hover', { p?: GeoJSONVT; c?: GeoJSONVT }>> = {};
  private empty = true;
  constructor(
    private provinceFeature: (id: string) => GeoFeature | undefined,
    private countryFeature: (id: string) => GeoFeature | undefined,
  ) {}

  set(slot: 'select' | 'hover', s: HighlightSet) {
    const mk = (ids: string[], get: (id: string) => GeoFeature | undefined) => {
      const features = ids.map(get).filter(Boolean) as GeoFeature[];
      return features.length ? buildIndex({ type: 'FeatureCollection', features }) : undefined;
    };
    this.idx[slot] = { p: mk(s.provinces, this.provinceFeature), c: mk(s.countries, this.countryFeature) };
    this.empty = !Object.values(this.idx).some((v) => v && (v.p || v.c));
  }
  isEmpty() {
    return this.empty;
  }

  draw: DrawTile = (g, z, x, y, size) => {
    if (this.empty) return false;
    const k = size / EXTENT;
    g.lineJoin = 'round';
    const pass = (ix: GeoJSONVT | undefined, fill: string, stroke: string, w: number) => {
      const t = ix?.getTile(z, x, y);
      if (!t) return;
      g.beginPath();
      for (const f of t.features) tracePath(g, f, k, true);
      g.fillStyle = fill;
      g.fill('evenodd');
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = w + 2;
      g.stroke();
      g.strokeStyle = stroke;
      g.lineWidth = w;
      g.stroke();
    };
    const h = this.idx.hover;
    const s = this.idx.select;
    pass(h?.c, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.9)', 2);
    pass(h?.p, 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.95)', 1.6);
    pass(s?.c, 'rgba(255,214,64,0.10)', 'rgba(255,214,64,1)', 3);
    pass(s?.p, 'rgba(255,214,64,0.22)', 'rgba(255,214,64,1)', 2.4);
  };
}

// ------------------------------------------------------------------ roads

export class RoadPainter {
  private base: GeoJSONVT;
  private damaged: GeoJSONVT | null = null;
  showRoads = true;
  showRail = true;
  constructor(lines: { cls: number; coords: number[][] }[]) {
    const features: GeoJSON.Feature[] = [];
    for (let c = 0; c < 5; c++) {
      const coordinates = lines.filter((l) => l.cls === c).map((l) => l.coords);
      if (coordinates.length) features.push({ type: 'Feature', properties: { c }, geometry: { type: 'MultiLineString', coordinates } });
    }
    this.base = new GeoJSONVT({ type: 'FeatureCollection', features }, { ...VT_OPTS, maxZoom: 14, tolerance: 4 });
  }
  setDamaged(lines: number[][][]) {
    this.damaged = lines.length
      ? new GeoJSONVT(
          { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }] },
          { ...VT_OPTS, maxZoom: 14, tolerance: 2 },
        )
      : null;
  }
  hasDamage() {
    return !!this.damaged;
  }

  draw: DrawTile = (g, z, x, y, size) => {
    const k = size / EXTENT;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const t = this.base.getTile(z, x, y);
    if (t) {
      for (const f of t.features) {
        const c = f.tags?.c as number;
        const rail = c === 3;
        if (rail ? !this.showRail : !this.showRoads) continue;
        const minZ = c === 0 ? 4 : c === 3 ? 6 : c === 1 ? 6 : c === 2 ? 8 : 7;
        if (z < minZ) continue;
        g.beginPath();
        tracePath(g, f, k, false);
        const grow = Math.max(0, z - minZ) * 0.15;
        if (rail) {
          g.setLineDash([]);
          g.strokeStyle = 'rgba(20,20,20,0.7)';
          g.lineWidth = 2 + grow;
          g.stroke();
          g.setLineDash([5, 5]);
          g.strokeStyle = 'rgba(235,235,235,0.9)';
          g.lineWidth = 1.2 + grow;
          g.stroke();
          g.setLineDash([]);
        } else if (c === 4) {
          g.setLineDash([3, 4]);
          g.strokeStyle = 'rgba(120,190,255,0.8)';
          g.lineWidth = 1;
          g.stroke();
          g.setLineDash([]);
        } else {
          const w = (c === 0 ? 2.4 : c === 1 ? 1.8 : 1.2) + grow;
          g.strokeStyle = 'rgba(0,0,0,0.55)';
          g.lineWidth = w + 1.4;
          g.stroke();
          g.strokeStyle = c === 0 ? 'rgba(255,196,84,0.98)' : c === 1 ? 'rgba(255,236,170,0.95)' : 'rgba(250,250,250,0.85)';
          g.lineWidth = w;
          g.stroke();
        }
      }
    }
    const d = this.damaged?.getTile(z, x, y);
    if (d && z >= 3) {
      g.beginPath();
      for (const f of d.features) tracePath(g, f, k, false);
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = 'rgb(255,48,40)';
      g.lineWidth = 3;
      g.stroke();
    }
  };
}
