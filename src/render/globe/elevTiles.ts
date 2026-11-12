/** Terrarium elevation tiles (AWS Open Data): shared fetch + decode cache for terrain and relief shading. */
import * as Cesium from 'cesium';

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TILE_PX = 256;

const cache = new Map<string, Float32Array>();
const inflight = new Map<string, Promise<Float32Array>>();
const MAX_CACHE = 140;
let scratch: CanvasRenderingContext2D | null = null;

function decode(bmp: ImageBitmap | HTMLImageElement): Float32Array {
  if (!scratch) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE_PX;
    scratch = c.getContext('2d', { willReadFrequently: true })!;
  }
  scratch.clearRect(0, 0, TILE_PX, TILE_PX);
  scratch.drawImage(bmp, 0, 0);
  const d = scratch.getImageData(0, 0, TILE_PX, TILE_PX).data;
  const out = new Float32Array(TILE_PX * TILE_PX);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = d[p] * 256 + d[p + 1] + d[p + 2] / 256 - 32768;
  return out;
}

/**
 * Elevation in metres, row-major 256×256. Returns undefined when Cesium's request scheduler throttles
 * (the caller must hand `undefined` back to Cesium so it retries). Rejects on network failure.
 */
export function loadElevTile(z: number, x: number, y: number, request?: Cesium.Request): Promise<Float32Array> | undefined {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const res = new Cesium.Resource({ url: TERRARIUM_URL.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`), request });
  const img = res.fetchImage({ preferImageBitmap: true, flipY: false });
  if (!img) return undefined;
  const p = Promise.resolve(img)
    .then((bmp) => {
      const h = decode(bmp as ImageBitmap);
      cache.set(key, h);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
      return h;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const newRequest = (type = Cesium.RequestType.TERRAIN) => new Cesium.Request({ throttle: true, throttleByServer: true, type });
