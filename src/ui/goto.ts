/** Camera helpers shared by the feed, alerts and inspectors. */
import type { LonLat, NewsWhere } from '../core/contracts';
import { appHost } from '../app/host';
import { getGlobe } from '../render/globe/registry';

export function locateWhere(w: NewsWhere | undefined): LonLat | null {
  const h = appHost.getState();
  if (!w || !h.world) return null;
  if ('lon' in w) return [w.lon, w.lat];
  if ('province' in w) return h.world.provinceById.get(w.province)?.centroid ?? null;
  if ('country' in w) { const c = h.world.countryById.get(w.country); return c ? [c.capital.lon, c.capital.lat] : null; }
  const api = h.game?.ctx.api;
  if ('formation' in w) return api?.military.formation(w.formation)?.pos ?? null;
  if ('battle' in w) return api?.military.battle(w.battle)?.pos ?? null;
  return null;
}
export function goTo(lon: number, lat: number, height = 1_500_000) {
  void getGlobe()?.flyTo(lon, lat, { height, durationS: 1.2 });
}
export function goToWhere(w: NewsWhere | undefined, height?: number): boolean {
  const p = locateWhere(w);
  if (p) goTo(p[0], p[1], height);
  return !!p;
}
