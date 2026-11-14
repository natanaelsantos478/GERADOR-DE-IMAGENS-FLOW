import type { LonLat, TextKey } from '../../core/contracts';
import { t } from '../i18n';
import { ui } from '../store';
import { theWorld } from '../useGame';
import type { TargetRef } from '../../sim/military';

export const kmBetween = (a: LonLat, b: LonLat) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/** Asks for a point on the globe, then calls back with it (shared by every "choose destination/target" flow). */
export function pickPoint(labelKey: TextKey, cb: (p: LonLat) => void) {
  ui().setPick({ labelKey, onPick: ({ lonLat }) => cb(lonLat) });
}
export const orderLabel = (o: string) => t(`ui.mil.order.${o}`);

export function targetName(tg: TargetRef): string {
  const w = theWorld();
  if (tg.kind === 'city') return w.cities[tg.index]?.name ?? '?';
  if (tg.kind === 'plant') return w.plants[tg.index]?.name ?? '?';
  if (tg.kind === 'airport') return w.airports[tg.index]?.name ?? '?';
  if (tg.kind === 'port') return w.ports[tg.index]?.name ?? '?';
  if (tg.kind === 'road') return t('ui.kind.road');
  return t('ui.mil.targetFormation');
}
export function targetPos(tg: TargetRef, formPos?: (id: string) => LonLat | null): LonLat | null {
  const w = theWorld();
  const o = tg.kind === 'city' ? w.cities[tg.index] : tg.kind === 'plant' ? w.plants[tg.index] : tg.kind === 'airport' ? w.airports[tg.index] : tg.kind === 'port' ? w.ports[tg.index] : null;
  if (o) return [o.lon, o.lat];
  return tg.kind === 'formation' ? formPos?.(tg.id) ?? null : null;
}
export const targetKey = (tg: TargetRef) => `${tg.kind}:${'index' in tg ? tg.index : tg.id}`;
