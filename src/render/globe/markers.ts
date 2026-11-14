/** Labels and point markers (countries, cities, power plants, airports, ports) in primitive collections with LOD. */
import * as Cesium from 'cesium';
import type { Fuel, InfraKind, WorldStatic } from '../../core/contracts';
import { haversineKm } from '../../core/geo';
import type { LayerId, PickFeature } from './types';

const FUEL_COLOR: Record<Fuel, string> = {
  coal: '#9a9a9a', gas: '#ff9f43', oil: '#c2874f', nuclear: '#b8e61e', hydro: '#3fa7ff',
  wind: '#7be0c3', solar: '#ffd93d', biomass: '#86c64e', geothermal: '#ff6b5a', other: '#c4c4d4',
};
const FUEL_ICON: Record<Fuel, string> = {
  coal: 'coal', gas: 'gas', oil: 'oil_plant', nuclear: 'nuclear', hydro: 'hydro',
  wind: 'wind', solar: 'solar', biomass: 'biomass', geothermal: 'geothermal', other: 'energy',
};

const MARK = Symbol('globe-marker');
export interface MarkerId {
  [MARK]: true;
  kind: string;
  index: number;
  ref?: string;
}
const mk = (kind: string, index: number, ref?: string): MarkerId => ({ [MARK]: true, kind, index, ref });
export function markerFeature(picked: { id?: unknown }): PickFeature | undefined {
  const id = picked.id as Partial<MarkerId> | undefined;
  return id && id[MARK] ? { kind: id.kind!, id: id.ref ?? id.index!, index: id.index } : undefined;
}

async function svgText(name: string): Promise<string> {
  const r = await fetch(new URL(`icons/${name}.svg`, document.baseURI));
  if (!r.ok) throw new Error(`ícone ${name}: HTTP ${r.status}`);
  return r.text();
}

/** Round badge with a tinted glyph. */
async function badge(name: string, color: string, size = 44, bg = 'rgba(10,16,24,0.86)'): Promise<HTMLCanvasElement> {
  const svg = (await svgText(name)).replace(/currentColor/g, color);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = color;
  g.stroke();
  const m = size * 0.24;
  g.drawImage(img, m, m, size - 2 * m, size - 2 * m);
  URL.revokeObjectURL(url);
  return c;
}

function dot(size: number, fill: string, ring = 'rgba(0,0,0,0.85)'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = ring;
  g.stroke();
  return c;
}

const DDC = Cesium.DistanceDisplayCondition;
const frame = () => new Promise<void>((r) => setTimeout(r, 0));
const RED = new Cesium.Color(1, 0.3, 0.25, 1);
const tint = (damage: number) => (damage > 0.05 ? Cesium.Color.lerp(Cesium.Color.WHITE, RED, Math.min(1, damage * 1.4), new Cesium.Color()) : Cesium.Color.WHITE);

export class Markers {
  private col: Partial<Record<LayerId, Cesium.BillboardCollection | Cesium.LabelCollection>> = {};
  private bb: Record<'city' | 'plant' | 'airport' | 'port', Cesium.Billboard[]> = { city: [], plant: [], airport: [], port: [] };
  private cityLabels: (Cesium.Label | null)[] = [];
  private lazyQueue: number[] = [];
  private lazyBusy = false;
  private cityLabelCol!: Cesium.LabelCollection;
  private disposed = false;

  constructor(private viewer: Cesium.Viewer, private world: WorldStatic, private lang: 'pt' | 'en') {}

  setVisible(id: LayerId, v: boolean) {
    const c = this.col[id];
    if (c) c.show = v;
    this.viewer.scene.requestRender();
  }
  isVisible(id: LayerId) {
    return this.col[id]?.show ?? true;
  }

  private add<T extends Cesium.BillboardCollection | Cesium.LabelCollection>(id: LayerId, c: T): T {
    this.viewer.scene.primitives.add(c);
    this.col[id] = c;
    return c;
  }

  async build() {
    const w = this.world;
    const scene = this.viewer.scene;
    const [cityIcons, airportIcon, milAirportIcon, portIcon, capIcon, plantIcons] = await Promise.all([
      Promise.resolve({ dot: dot(24, '#f4f1e6'), admin: dot(24, '#9fb4c8') }),
      badge('airport', '#e8eef5', 40),
      badge('airport', '#a6c46a', 40),
      badge('port', '#59b8e6', 40),
      badge('capital', '#ffcf4a', 52),
      Promise.all((Object.keys(FUEL_COLOR) as Fuel[]).map(async (f) => [f, await badge(FUEL_ICON[f], FUEL_COLOR[f])] as const)),
    ]);
    if (this.disposed) return;
    const elev = (lon: number, lat: number) => Math.max(0, w.elevationAt(lon, lat)) + 8;
    const pos = (lon: number, lat: number) => Cesium.Cartesian3.fromDegrees(lon, lat, elev(lon, lat));

    // ---- country labels
    const countryLabels = this.add('countryLabels', new Cesium.LabelCollection({ scene }));
    for (const c of w.countries) {
      const [west, south, east, north] = c.bbox;
      const diag = haversineKm(west, south, east > west ? east : east + 360, north) * 1000;
      const near = diag * 0.4;
      let far = Math.min(3e7, Math.max(1.5e6, diag * 9));
      if (!c.sovereign) far = Math.min(far, 2.2e6);
      if (diag < 6e3) continue;
      const big = diag > 2e6;
      countryLabels.add({
        position: Cesium.Cartesian3.fromDegrees(c.centroid[0], c.centroid[1], 0),
        text: (this.lang === 'pt' ? c.namePt || c.name : c.name).toUpperCase(),
        font: `${big ? 600 : 500} ${big ? 15 : 12}px system-ui, sans-serif`,
        fillColor: Cesium.Color.fromCssColorString('#f6f1e0').withAlpha(c.sovereign ? 0.95 : 0.7),
        outlineColor: Cesium.Color.fromCssColorString('#0b1016'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        distanceDisplayCondition: new DDC(near, far),
        id: mk('country', w.countries.indexOf(c), c.id),
      });
    }

    // ---- cities
    const cityBb = this.add('cities', new Cesium.BillboardCollection({ scene }));
    this.cityLabelCol = this.add('cityLabels', new Cesium.LabelCollection({ scene }));
    const order = w.cities.map((_, i) => i).sort((a, b) => w.cities[a].pop - w.cities[b].pop);
    for (let n = 0; n < order.length; n++) {
      const i = order[n];
      const c = w.cities[i];
      const nat = c.capital === 2;
      const reach = nat ? 7e6 : c.pop >= 5e6 ? 9e6 : c.pop >= 1.5e6 ? 4.5e6 : c.pop >= 5e5 ? 1.8e6 : c.pop >= 2e5 ? 7e5 : c.pop >= 8e4 ? 2.6e5 : 8e4;
      const maxD = c.capital === 1 ? Math.max(reach, 3.5e5) : reach;
      const b = cityBb.add({
        position: pos(c.lon, c.lat),
        scale: nat ? 0.36 : Math.max(0.3, Math.min(0.62, 0.3 + 0.07 * Math.log10(Math.max(1e4, c.pop) / 1e4))),
        distanceDisplayCondition: new DDC(0, maxD),
        id: mk('city', i),
      });
      b.setImage(nat ? 'cap' : c.capital === 1 ? 'adm' : 'dot', nat ? capIcon : c.capital === 1 ? cityIcons.admin : cityIcons.dot);
      this.bb.city[i] = b;
      if (n % 1500 === 1499) await frame();
      if (this.disposed) return;
    }
    // labels: the big ones now, the rest on demand (see ensureLazyLabels)
    this.cityLabels = new Array(w.cities.length).fill(null);
    for (let n = order.length - 1; n >= 0; n--) {
      const i = order[n];
      const c = w.cities[i];
      if (c.capital === 2 || c.pop >= 4e5) this.addCityLabel(i);
      else this.lazyQueue.push(i);
    }
    this.lazyQueue.reverse(); // pop ascending → pop() takes the biggest first

    // ---- power plants
    const plantCol = this.add('plants', new Cesium.BillboardCollection({ scene }));
    const plantImg = Object.fromEntries(plantIcons) as Record<Fuel, HTMLCanvasElement>;
    const porder = w.plants.map((_, i) => i).sort((a, b) => w.plants[a].mw - w.plants[b].mw);
    for (let n = 0; n < porder.length; n++) {
      const i = porder[n];
      const p = w.plants[i];
      const mw = Math.max(0.5, p.mw);
      const far = mw >= 3000 ? 9e6 : mw >= 1000 ? 3.2e6 : mw >= 500 ? 1.1e6 : mw >= 300 ? 6e5 : mw >= 100 ? 2.5e5 : mw >= 30 ? 1.1e5 : mw >= 10 ? 5e4 : 2.5e4;
      const b = plantCol.add({
        position: pos(p.lon, p.lat),
        scale: Math.max(0.2, Math.min(0.6, 0.1 + 0.12 * Math.log10(mw + 1))),
        scaleByDistance: new Cesium.NearFarScalar(2e4, 1.5, 2.5e6, 0.6),
        distanceDisplayCondition: new DDC(0, far),
        id: mk('plant', i),
      });
      b.setImage(`plant-${p.fuel}`, plantImg[p.fuel] ?? plantImg.other);
      this.bb.plant[i] = b;
      if (n % 3000 === 2999) {
        await frame();
        if (this.disposed) return;
      }
    }

    // ---- airports & ports
    const airCol = this.add('airports', new Cesium.BillboardCollection({ scene }));
    w.airports.forEach((a, i) => {
      const b = airCol.add({
        position: pos(a.lon, a.lat),
        scale: a.size === 2 ? 0.45 : a.size === 1 ? 0.36 : 0.28,
        scaleByDistance: new Cesium.NearFarScalar(2e4, 1.5, 2e6, 0.6),
        distanceDisplayCondition: new DDC(0, a.size === 2 ? 1.6e6 : a.size === 1 ? 5e5 : 1.2e5),
        id: mk('airport', i),
      });
      b.setImage(a.military ? 'air-mil' : 'air', a.military ? milAirportIcon : airportIcon);
      this.bb.airport[i] = b;
    });
    const portCol = this.add('ports', new Cesium.BillboardCollection({ scene }));
    w.ports.forEach((p, i) => {
      const b = portCol.add({
        position: pos(p.lon, p.lat),
        scale: p.size === 2 ? 0.45 : p.size === 1 ? 0.36 : 0.28,
        scaleByDistance: new Cesium.NearFarScalar(2e4, 1.5, 2e6, 0.6),
        distanceDisplayCondition: new DDC(0, p.size === 2 ? 1.4e6 : p.size === 1 ? 4e5 : 1e5),
        id: mk('port', i),
      });
      b.setImage('port', portIcon);
      this.bb.port[i] = b;
    });
    // text always on top of icons (primitives draw in insertion order)
    for (const id of ['cityLabels', 'countryLabels'] as const) { const c = this.col[id]; if (c) this.viewer.scene.primitives.raiseToTop(c); }
    scene.requestRender();
  }

  private addCityLabel(i: number) {
    const c = this.world.cities[i];
    const nat = c.capital === 2;
    const reach = nat ? 6e6 : c.pop >= 5e6 ? 3.5e6 : c.pop >= 1.5e6 ? 1.8e6 : c.pop >= 5e5 ? 8e5 : c.pop >= 2e5 ? 3.5e5 : c.pop >= 8e4 ? 1.3e5 : 5e4;
    this.cityLabels[i] = this.cityLabelCol.add({
      position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, Math.max(0, this.world.elevationAt(c.lon, c.lat)) + 8),
      text: c.name,
      font: `${nat ? 600 : 500} ${nat ? 13 : 11}px system-ui, sans-serif`,
      fillColor: nat ? Cesium.Color.fromCssColorString('#ffe08a') : Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#0b1016'),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(nat ? 14 : 8, 0),
      distanceDisplayCondition: new DDC(0, Math.max(reach, c.capital === 1 ? 2.5e5 : 0)),
      id: mk('city', i),
    });
  }

  /** Creates the small-city labels once the camera is close enough for them to matter. */
  ensureLazyLabels(cameraHeight: number) {
    if (this.disposed || this.lazyBusy || !this.lazyQueue.length || cameraHeight > 6e5) return;
    this.lazyBusy = true;
    const step = () => {
      if (this.disposed) return;
      for (let n = 0; n < 500 && this.lazyQueue.length; n++) this.addCityLabel(this.lazyQueue.pop()!);
      this.viewer.scene.requestRender();
      if (this.lazyQueue.length) setTimeout(step, 0);
      else this.lazyBusy = false;
    };
    step();
  }

  /** Red tint proportional to damage. */
  setDamage(kind: InfraKind, index: number, damage: number) {
    if (this.disposed) return;
    const b = kind === 'city' ? this.bb.city[index] : kind === 'plant' ? this.bb.plant[index] : kind === 'airport' ? this.bb.airport[index] : kind === 'port' ? this.bb.port[index] : undefined;
    if (!b) return;
    b.color = tint(damage);
    if (kind === 'city') {
      const l = this.cityLabels[index];
      if (l) l.fillColor = damage > 0.05 ? Cesium.Color.fromCssColorString('#ff8a7a') : this.world.cities[index].capital === 2 ? Cesium.Color.fromCssColorString('#ffe08a') : Cesium.Color.WHITE;
    }
    this.viewer.scene.requestRender();
  }
  /** Re-applies every damage value from a WorldDyn snapshot (new game / load). */
  syncDamage(d: { cityDamage: Record<number, number>; plantDamage: Record<number, number>; airportDamage: Record<number, number>; portDamage: Record<number, number> } | null) {
    if (this.disposed) return;
    for (const kind of ['city', 'plant', 'airport', 'port'] as const) this.bb[kind].forEach((b) => (b.color = Cesium.Color.WHITE));
    if (d) {
      for (const [i, v] of Object.entries(d.cityDamage)) this.setDamage('city', +i, v);
      for (const [i, v] of Object.entries(d.plantDamage)) this.setDamage('plant', +i, v);
      for (const [i, v] of Object.entries(d.airportDamage)) this.setDamage('airport', +i, v);
      for (const [i, v] of Object.entries(d.portDamage)) this.setDamage('port', +i, v);
    }
    this.viewer.scene.requestRender();
  }

  destroy() {
    this.disposed = true;
    if (this.viewer.isDestroyed()) return;
    for (const c of Object.values(this.col)) if (c) this.viewer.scene.primitives.remove(c);
  }
}
