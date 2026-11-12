/** Hill-shaded relief imagery computed from Terrarium tiles (hypsometric tint or grey). */
import * as Cesium from 'cesium';
import { loadElevTile, newRequest, TILE_PX } from './elevTiles';

const LAND: [number, number[]][] = [
  [0, [88, 138, 84]], [150, [128, 168, 92]], [500, [188, 190, 110]], [1000, [204, 176, 104]],
  [1800, [184, 142, 100]], [3000, [154, 124, 104]], [4500, [200, 192, 186]], [6500, [250, 250, 250]],
];
const SEA: [number, number[]][] = [
  [0, [92, 150, 196]], [-200, [66, 120, 176]], [-2000, [36, 80, 140]], [-5000, [18, 44, 92]], [-9000, [8, 20, 54]],
];
function ramp(h: number, stops: [number, number[]][], dir: 1 | -1, out: number[]) {
  let i = 0;
  while (i < stops.length - 2 && (dir === 1 ? h > stops[i + 1][0] : h < stops[i + 1][0])) i++;
  const [h0, c0] = stops[i], [h1, c1] = stops[i + 1];
  const t = Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
  for (let k = 0; k < 3; k++) out[k] = c0[k] + (c1[k] - c0[k]) * t;
}

export function createReliefImagery(style: 'tint' | 'gray'): Cesium.ImageryProvider {
  const tilingScheme = new Cesium.WebMercatorTilingScheme();
  const maxLevel = 12;
  const col = [0, 0, 0];
  const LX = -0.55, LY = 0.65, LZ = 0.52; // light from the north-west, towards the viewer
  const p = {
    tilingScheme,
    rectangle: tilingScheme.rectangle,
    tileWidth: TILE_PX,
    tileHeight: TILE_PX,
    minimumLevel: 0,
    maximumLevel: maxLevel,
    tileDiscardPolicy: undefined,
    errorEvent: new Cesium.Event(),
    credit: new Cesium.Credit('Relevo: Terrarium (SRTM, GMTED, ETOPO1) via AWS Open Data', true),
    proxy: undefined,
    hasAlphaChannel: false,
    requestImage(x: number, y: number, level: number, request?: Cesium.Request) {
      const pr = loadElevTile(level, x, y, request ?? newRequest(Cesium.RequestType.IMAGERY));
      if (!pr) return undefined;
      return pr.then((h) => {
        const c = document.createElement('canvas');
        c.width = c.height = TILE_PX;
        const g = c.getContext('2d')!;
        const img = g.createImageData(TILE_PX, TILE_PX);
        const d = img.data;
        const rect = tilingScheme.tileXYToRectangle(x, y, level);
        const lat = (rect.north + rect.south) / 2;
        const mpp = (40075016.686 * Math.cos(lat)) / (TILE_PX * (1 << level));
        const ex = level < 7 ? 4 : level < 10 ? 2.5 : 1.8;
        const W = TILE_PX;
        for (let j = 0; j < W; j++) {
          const jn = j > 0 ? j - 1 : j, js = j < W - 1 ? j + 1 : j;
          for (let i = 0; i < W; i++) {
            const k = j * W + i;
            const z = h[k];
            const iw = i > 0 ? i - 1 : i, ie = i < W - 1 ? i + 1 : i;
            const dzdx = ((h[j * W + ie] - h[j * W + iw]) / ((ie - iw) * mpp)) * ex;
            const dzdy = ((h[jn * W + i] - h[js * W + i]) / ((js - jn) * mpp)) * ex; // +y = north
            const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
            const shade = (-dzdx * LX - dzdy * LY + LZ) * inv;
            const sea = z <= 0;
            if (style === 'tint') {
              if (sea) ramp(z, SEA, -1, col);
              else ramp(z, LAND, 1, col);
            } else if (sea) {
              col[0] = 40; col[1] = 66; col[2] = 92;
            } else {
              col[0] = 168; col[1] = 172; col[2] = 166;
            }
            const f = sea ? 1 : Math.max(0.3, Math.min(1.45, 0.38 + 0.9 * shade));
            const o = k * 4;
            d[o] = col[0] * f;
            d[o + 1] = col[1] * f;
            d[o + 2] = col[2] * f;
            d[o + 3] = 255;
          }
        }
        g.putImageData(img, 0, 0);
        return c;
      }, () => document.createElement('canvas'));
    },
    pickFeatures: () => undefined,
  };
  return p as unknown as Cesium.ImageryProvider;
}
