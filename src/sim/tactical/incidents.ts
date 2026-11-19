/**
 * Small field incidents and battlefield psychology, checked once per second:
 * - on the move a truck can get a flat tyre, an armoured vehicle can throw a track or break down (it stops for a while),
 *   a soldier can collapse from heat/exhaustion (the squad slows down while he is helped);
 * - a squad with enemies firing from several sides feels surrounded and loses morale faster;
 * - losing the squad leader (its first element) costs morale once.
 * The random draws come from a hash of (battle tick, squad), not from the battle RNG, so the rest of the simulation
 * (and its recorded replays) is unchanged.
 */
import type { Battle, Squad } from './types';
import { UNITS } from './units';
import { cacheOf } from './util';

export type IncidentKind = 'tire' | 'track' | 'engine' | 'heat';
export interface Incident { k: IncidentKind; until: number }
export interface IncidentLog { t: number; side: number; sq: number; k: IncidentKind | 'surrounded' | 'leader' }

const h01 = (a: number, b: number, c: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c, 0x27d4eb2d);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};
/** Per-second chance while moving, and how long it lasts (s). */
const RULES: Record<IncidentKind, { p: number; min: number; max: number; pace: number }> = {
  tire: { p: 0.0004, min: 40, max: 110, pace: 0 },
  track: { p: 0.00015, min: 90, max: 240, pace: 0 },
  engine: { p: 0.0001, min: 60, max: 200, pace: 0 },
  heat: { p: 0.00012, min: 50, max: 150, pace: 0.55 },
};
const kindsFor = (s: Squad): IncidentKind[] => {
  const mob = UNITS[s.kind].mob;
  if (mob === 'foot') return ['heat'];
  if (mob === 'wheel') return ['tire', 'engine'];
  if (mob === 'track') return ['track', 'engine'];
  return [];
};

/** Speed multiplier from an active incident (1 = none). */
export function incidentPace(b: Battle, s: Squad): number {
  const i = s.inc;
  if (!i) return 1;
  if (b.t >= i.until) { delete s.inc; return 1; }
  return RULES[i.k].pace;
}

const log = (b: Battle, e: IncidentLog) => { (b.incLog ??= []).push(e); if (b.incLog.length > 30) b.incLog.splice(0, b.incLog.length - 30); };

export function stepIncidents(b: Battle): void {
  const c = cacheOf(b), sec = Math.floor(b.t);
  for (const s of b.squads) {
    const ents = c.sqEnts[s.id];
    if (!ents?.length) continue;
    // field incidents, only while on the move
    const moving = s.path.length > 0 && s.pi < s.path.length && s.order !== 'hold';
    // scripted scenarios (noAi) stay exact: no random breakdowns there
    if (moving && !s.inc && !s.routed && !b.noAi) {
      for (const k of kindsFor(s)) {
        // more vehicles/men in the squad = more chances that one of them has a problem
        if (h01(sec, s.id, k.length) < RULES[k].p * Math.min(4, ents.length)) {
          const r = RULES[k];
          s.inc = { k, until: b.t + r.min + h01(sec, s.id, 7) * (r.max - r.min) };
          log(b, { t: b.t, side: s.side, sq: s.id, k });
          break;
        }
      }
    }
    // leader down: the first element of the squad (its commander) died since the last check
    const lead = s.lead ?? (s.lead = ents[0]);
    if (lead >= 0 && !b.ents[lead]?.alive) {
      s.lead = -1;
      s.morale = Math.max(0, s.morale - 0.18);
      log(b, { t: b.t, side: s.side, sq: s.id, k: 'leader' });
    }
    // surrounded: engaged enemies in three or more of the four quadrants around the squad
    if (b.t - s.engagedT < 3) {
      const cx = c.sqCx[s.id], cy = c.sqCy[s.id];
      let q = 0;
      for (const o of b.squads) {
        if (o.side === s.side || !c.sqEnts[o.id]?.length || o.routed) continue;
        const dx = c.sqCx[o.id] - cx, dy = c.sqCy[o.id] - cy;
        if (dx * dx + dy * dy > 900 * 900) continue;
        q |= 1 << ((dx >= 0 ? 1 : 0) + (dy >= 0 ? 2 : 0));
      }
      const sides = (q & 1) + ((q >> 1) & 1) + ((q >> 2) & 1) + ((q >> 3) & 1);
      if (sides >= 3) {
        s.morale = Math.max(0, s.morale - 0.012 * (sides - 2));
        if (!s.encT || b.t - s.encT > 60) { s.encT = b.t; log(b, { t: b.t, side: s.side, sq: s.id, k: 'surrounded' }); }
      }
    }
  }
}
