/** Spherical geometry helpers. All positions are `[lon, lat]` degrees; distances in km. */
import type { BBox, LonLat } from './world-types';

export const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Wraps longitude into [−180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const distanceKm = (a: LonLat, b: LonLat) => haversineKm(a[0], a[1], b[0], b[1]);

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const φ1 = a[1] * RAD, φ2 = b[1] * RAD, Δλ = (b[0] - a[0]) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** Point reached travelling `km` from `from` on initial bearing `bearing`. */
export function destination(from: LonLat, bearing: number, km: number): LonLat {
  const δ = km / EARTH_RADIUS_KM, θ = bearing * RAD;
  const φ1 = from[1] * RAD, λ1 = from[0] * RAD;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * sinφ2);
  return [normalizeLon(λ2 * DEG), φ2 * DEG];
}

/** Point at fraction t∈[0,1] along the great circle a→b (slerp). */
export function interpolateGreatCircle(a: LonLat, b: LonLat, t: number): LonLat {
  const φ1 = a[1] * RAD, λ1 = a[0] * RAD, φ2 = b[1] * RAD, λ2 = b[0] * RAD;
  const δ = haversineKm(a[0], a[1], b[0], b[1]) / EARTH_RADIUS_KM;
  if (δ < 1e-12) return [a[0], a[1]];
  const A = Math.sin((1 - t) * δ) / Math.sin(δ);
  const B = Math.sin(t * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [normalizeLon(Math.atan2(y, x) * DEG), Math.atan2(z, Math.sqrt(x * x + y * y)) * DEG];
}

/** `segments + 1` points along the great circle a→b (for drawing routes/arcs). */
export function greatCirclePoints(a: LonLat, b: LonLat, segments: number): LonLat[] {
  const n = Math.max(1, Math.floor(segments));
  const out: LonLat[] = [];
  for (let i = 0; i <= n; i++) out.push(interpolateGreatCircle(a, b, i / n));
  return out;
}

/** Total length of a polyline. */
export function polylineKm(points: readonly LonLat[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += distanceKm(points[i - 1], points[i]);
  return km;
}

/** Point at distance `km` along a polyline (clamped to its ends) and the heading there. */
export function alongPolyline(points: readonly LonLat[], km: number): { pos: LonLat; heading: number; done: boolean } {
  if (points.length === 0) throw new Error('alongPolyline: empty polyline');
  if (points.length === 1) return { pos: [points[0][0], points[0][1]], heading: 0, done: true };
  let left = Math.max(0, km);
  for (let i = 1; i < points.length; i++) {
    const seg = distanceKm(points[i - 1], points[i]);
    if (left <= seg) {
      const t = seg > 0 ? left / seg : 1;
      return { pos: interpolateGreatCircle(points[i - 1], points[i], t), heading: bearingDeg(points[i - 1], points[i]), done: false };
    }
    left -= seg;
  }
  const n = points.length;
  return { pos: [points[n - 1][0], points[n - 1][1]], heading: bearingDeg(points[n - 2], points[n - 1]), done: true };
}

// ---------------------------------------------------------------- bbox

export function bboxOf(points: readonly LonLat[]): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Bbox of a flat `[x, y, x, y, …]` ring. */
export function bboxOfFlat(flat: ArrayLike<number>): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i], y = flat[i + 1];
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

export const bboxContains = (b: BBox, lon: number, lat: number) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
export const bboxIntersects = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export const bboxUnion = (a: BBox, b: BBox): BBox => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/** Bbox around a point with radius `km` (clamped to the poles, not wrapped across ±180). */
export function bboxAround(lon: number, lat: number, km: number): BBox {
  const dLat = (km / EARTH_RADIUS_KM) * DEG;
  const cos = Math.cos(lat * RAD);
  const dLon = cos < 1e-6 ? 180 : Math.min(180, dLat / cos);
  return [Math.max(-180, lon - dLon), Math.max(-90, lat - dLat), Math.min(180, lon + dLon), Math.min(90, lat + dLat)];
}

// ---------------------------------------------------------------- polygons

/** Even–odd ray casting on a flat ring `[x0, y0, x1, y1, …]` (closing point optional). */
export function pointInRing(lon: number, lat: number, ring: ArrayLike<number>): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon = outer ring followed by holes (flat rings). */
export function pointInPolygon(lon: number, lat: number, rings: readonly ArrayLike<number>[]): boolean {
  if (rings.length === 0 || !pointInRing(lon, lat, rings[0])) return false;
  for (let r = 1; r < rings.length; r++) if (pointInRing(lon, lat, rings[r])) return false;
  return true;
}

/** Converts GeoJSON-style `[[x, y], …]` to a flat Float64Array. */
export function flattenRing(ring: readonly (readonly number[])[]): Float64Array {
  const out = new Float64Array(ring.length * 2);
  for (let i = 0; i < ring.length; i++) {
    out[2 * i] = ring[i][0];
    out[2 * i + 1] = ring[i][1];
  }
  return out;
}

/** Approximate km from a point to the nearest edge of a flat ring (local equirectangular; fine ≤ ~500 km). */
export function distanceToRingKm(lon: number, lat: number, ring: ArrayLike<number>): number {
  const kx = 111.32 * Math.cos(lat * RAD), ky = 110.574;
  let best = Infinity;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    let ax = ring[j] - lon, bx = ring[i] - lon;
    if (ax > 180) ax -= 360; else if (ax < -180) ax += 360;
    if (bx > 180) bx -= 360; else if (bx < -180) bx += 360;
    ax *= kx; bx *= kx;
    const ay = (ring[j + 1] - lat) * ky, by = (ring[i + 1] - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? -(ax * dx + ay * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx, qy = ay + t * dy;
    const d2 = qx * qx + qy * qy;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
