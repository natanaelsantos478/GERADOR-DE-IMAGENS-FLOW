/** Real satellite imagery without keys: ESRI → EOX → bundled Natural Earth II (offline). */
import * as Cesium from 'cesium';

export type ImageryKind = 'esri' | 'eox' | 'offline';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const EOX = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
const SOURCES = {
  esri: { url: ESRI, maxLevel: 18, credit: 'Imagens: Esri, Maxar, Earthstar Geographics e a comunidade GIS User' },
  eox: { url: EOX, maxLevel: 13, credit: 'Imagens: Sentinel-2 cloudless © EOX IT Services GmbH (contém dados Copernicus Sentinel 2020)' },
} as const;

/** URL of one imagery tile (Web Mercator z/x/y) of an online source, or null past its max level. */
export function imageryTileUrl(kind: 'esri' | 'eox', z: number, x: number, y: number): string | null {
  const s = SOURCES[kind];
  return z > s.maxLevel ? null : s.url.replace('{z}', `${z}`).replace('{y}', `${y}`).replace('{x}', `${x}`);
}

async function probe(kind: 'esri' | 'eox'): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const url = SOURCES[kind].url.replace('{z}', '2').replace('{y}', '1').replace('{x}', '1');
    const r = await fetch(url, { signal: ctl.signal, mode: 'cors' });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export function onlineProvider(kind: 'esri' | 'eox'): Cesium.ImageryProvider {
  const s = SOURCES[kind];
  return new Cesium.UrlTemplateImageryProvider({
    url: s.url,
    maximumLevel: s.maxLevel,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: new Cesium.Credit(s.credit, true),
  });
}

export function offlineProvider(): Promise<Cesium.ImageryProvider> {
  return Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'), {
    credit: new Cesium.Credit('Natural Earth II (domínio público) — naturalearthdata.com', true),
  });
}

/** First reachable online source, or 'offline'. */
export async function chooseSource(): Promise<ImageryKind> {
  if (await probe('esri')) return 'esri';
  if (await probe('eox')) return 'eox';
  return 'offline';
}

export function nextSource(k: ImageryKind): ImageryKind | null {
  return k === 'esri' ? 'eox' : k === 'eox' ? 'offline' : null;
}
