/** z14 tile geometry and exact local-metre -> WGS84/ECEF conversion consistent with the vector decoder (`tileConverter`). */
import * as Cesium from 'cesium';

export const TZ = 14;
const R = 6378137;
export interface TileRef {
  x: number; y: number; key: string;
  lon0: number; lat0: number;
  /** Ground metres across the tile at its centre latitude (what the decoder calls `mPerTile`). */
  sizeM: number;
  west: number; south: number; east: number; north: number;
  origin: Cesium.Cartesian3;
  enu: Cesium.Matrix4; inv: Cesium.Matrix4;
}
const lonOf = (gx: number, n: number) => (gx / n) * 360 - 180;
const latOf = (gy: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) * 180) / Math.PI;
export const tileXY = (lon: number, lat: number, z = TZ): [number, number] => {
  const n = 2 ** z;
  return [((lon + 180) / 360) * n, ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n];
};
export function tileRef(x: number, y: number): TileRef {
  const n = 2 ** TZ, lon0 = lonOf(x + 0.5, n), lat0 = latOf(y + 0.5, n);
  const origin = Cesium.Cartesian3.fromDegrees(lon0, lat0, 0);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  return { x, y, key: `${x}/${y}`, lon0, lat0, sizeM: (2 * Math.PI * R * Math.cos((lat0 * Math.PI) / 180)) / n, west: lonOf(x, n), east: lonOf(x + 1, n), north: latOf(y, n), south: latOf(y + 1, n), origin, enu, inv: Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4()) };
}
/** Converts tile-local metres (x east, y north from the centre) + ellipsoidal height to ECEF / tile-ENU. */
export function projector(t: TileRef) {
  const n = 2 ** TZ, k = t.sizeM, gx0 = t.x + 0.5, gy0 = t.y + 0.5, d2r = Math.PI / 180;
  const c = new Cesium.Cartesian3();
  return {
    lonLat(x: number, y: number): [number, number] { return [lonOf(gx0 + x / k, n), latOf(gy0 - y / k, n)]; },
    ecef(x: number, y: number, h: number, out = c): Cesium.Cartesian3 {
      const [lo, la] = [lonOf(gx0 + x / k, n), latOf(gy0 - y / k, n)];
      return Cesium.Cartesian3.fromRadians(lo * d2r, la * d2r, h, undefined, out);
    },
    local(x: number, y: number, h: number, out = new Cesium.Cartesian3()): Cesium.Cartesian3 {
      return Cesium.Matrix4.multiplyByPoint(t.inv, this.ecef(x, y, h, c), out);
    },
  };
}
/** Rotates a tile-ENU vector into ECEF. */
export const enuToEcef = (t: TileRef, e: number, n: number, u: number, out = new Cesium.Cartesian3()) =>
  Cesium.Matrix4.multiplyByPointAsVector(t.enu, Cesium.Cartesian3.fromElements(e, n, u, out), out);
export const hash = (a: number, b: number, s = 0): number => {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
