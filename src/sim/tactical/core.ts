/** Battle construction, fixed-step loop, victory, result and snapshot. */
import type { TacticalSnapshot } from '../../core/contracts';
import { seedRng } from '../../core/rng';
import { runAi } from './ai';
import { acquire, fireWeapons, secondly, stepEffects, stepProjectiles } from './combat';
import { cellOf } from './grid';
import { stepEnts, stepSquads } from './move';
import { layout, newEnt } from './orders';
import type { Battle, Objective, Rect, Side, Squad, SquadResult, TacticalBattleInput, TacticalResult, UnitKind } from './types';
import { UNITS } from './units';
import { DT, cacheOf, nearby, rebuildCache } from './util';

const FRONT: UnitKind[] = ['infantry', 'special', 'engineer', 'mech', 'mbt', 'attackHeli'];
const depthOf = (k: UnitKind) => (FRONT.includes(k) ? 0.2 : k === 'recon' ? 0.05 : 0.8);

export function createBattle(input: TacticalBattleInput, seed: number): Battle {
  const m = input.map;
  const half = m.sizeM / 2;
  const defaultRect = (side: Side): Rect => ({ x: 0, y: side === 0 ? -half * 0.68 : half * 0.68, w: m.sizeM * 0.7, h: m.sizeM * 0.2 });
  const deploy: [Rect, Rect] = [input.sides[0].deploy ?? defaultRect(0), input.sides[1].deploy ?? defaultRect(1)];
  const b: Battle = {
    v: 1, id: input.id, strategicBattleId: input.strategicBattleId, center: input.center, map: m,
    country: [input.sides[0].country, input.sides[1].country], rng: seedRng(seed),
    t: 0, acc: 0, tick: 0, phase: 'deploy', deployLimit: input.deployLimitS ?? 120, timeLimit: input.timeLimitS ?? 1800,
    attacker: input.attacker, player: input.player ?? null, auto: [false, false], ready: [false, false], withdrawing: [false, false],
    deploy, ents: [], squads: [], proj: [], smokes: [], pend: [], objs: [],
    support: [{ ...input.sides[0].support }, { ...input.sides[1].support }], score: [0, 0], urbanHits: 0, nextProj: 0, result: null,
  };
  for (const side of [0, 1] as Side[]) {
    const r = deploy[side], dir = side === 0 ? 1 : -1;
    const list = input.sides[side].squads;
    const rows = new Map<number, number[]>();
    list.forEach((sq, i) => { const dp = depthOf(sq.kind); rows.set(dp, [...(rows.get(dp) ?? []), i]); });
    list.forEach((si, i) => {
      const row = rows.get(depthOf(si.kind))!;
      const k = row.indexOf(i);
      const d = UNITS[si.kind];
      const s: Squad = {
        id: b.squads.length, ref: si.ref, name: si.name ?? si.ref, side, kind: si.kind, modelId: si.modelId ?? d.model,
        form: si.kind === 'infantry' || si.kind === 'special' || si.kind === 'engineer' ? 'scatter' : 'line', face: side === 0 ? 0 : Math.PI,
        x: r.x + ((k + 0.5) / row.length - 0.5) * r.w * 0.9, y: r.y + dir * (r.h / 2 - depthOf(si.kind) * r.h),
        order: 'idle', ox: 0, oy: 0, target: -1, path: [], pi: 0, repath: -99, fireFree: true, dug: 0, digging: false,
        morale: Math.max(0.05, Math.min(1, si.morale)), routed: false, ai: !!si.ai, n0: Math.max(1, si.count) + (si.cargo ?? 0),
        smoke: d.smoke, cargo: si.cargo ?? 0, engagedT: -99,
      };
      b.squads.push(s);
      for (let j = 0; j < Math.max(1, si.count); j++) newEnt(b, s, Math.max(0, Math.min(1, si.ammo)), s.x, s.y);
      layout(b, s);
    });
  }
  const objs = input.objectives?.length ? input.objectives : [{ name: 'center', x: 0, y: 0 }];
  const defender: Side = input.attacker === 0 ? 1 : 0;
  b.objs = objs.map((o, i): Objective => ({ id: i, name: o.name ?? `obj${i + 1}`, x: o.x, y: o.y, r: o.r ?? 220, value: o.value ?? 1, owner: defender, cap: defender === 0 ? 1 : -1 }));
  rebuildCache(b);
  return b;
}

export function stepBattle(b: Battle, dt: number): void {
  b.acc += Math.min(dt, 10);
  while (b.acc >= DT && b.phase !== 'ended') { b.acc -= DT; tick(b); }
}

function tick(b: Battle): void {
  if (b.phase === 'deploy') {
    for (const s of [0, 1] as Side[]) if (b.player !== s || b.auto[s]) b.ready[s] = true;
    b.t += DT;
    if ((b.ready[0] && b.ready[1]) || b.t >= b.deployLimit) { b.phase = 'combat'; b.t = 0; b.tick = 0; }
    return;
  }
  b.tick++; b.t += DT;
  rebuildCache(b);
  acquire(b);
  stepSquads(b);
  stepEnts(b);
  fireWeapons(b);
  stepProjectiles(b);
  stepEffects(b);
  if (b.tick % 20 === 0) { secondly(b); objectives(b); victory(b); }
  if (b.tick % 40 === 20) runAi(b, 0); else if (b.tick % 40 === 0) runAi(b, 1);
}

function objectives(b: Battle): void {
  for (const o of b.objs) {
    const n = [0, 0];
    nearby(b, o.x, o.y, o.r, (e) => { if (e.kind !== 'attackHeli' && !b.squads[e.sq].routed) n[e.side]++; });
    if (n[0] && !n[1]) o.cap = Math.min(1, o.cap + 0.05); else if (n[1] && !n[0]) o.cap = Math.max(-1, o.cap - 0.05);
    o.owner = o.cap > 0.5 ? 0 : o.cap < -0.5 ? 1 : -1;
    if (o.owner !== -1) b.score[o.owner] += o.value;
  }
}

interface Strength { fit: number; alive: number; routed: number; gone: number; morale: number }
function strength(b: Battle, side: Side): Strength {
  const r: Strength = { fit: 0, alive: 0, routed: 0, gone: 0, morale: 0 };
  let mw = 0;
  for (const e of b.ents) {
    if (e.side !== side || !e.alive) continue;
    if (e.gone) { r.gone++; continue; }
    r.alive++;
    const sq = b.squads[e.sq];
    if (sq.routed) r.routed++; else if (e.kind !== 'logistics') r.fit++;
    r.morale += sq.morale; mw++;
  }
  r.morale = mw ? r.morale / mw : 0;
  return r;
}

function victory(b: Battle): void {
  const s = [strength(b, 0), strength(b, 1)];
  const lose = (side: Side, reason: TacticalResult['reason']) => finish(b, (1 - side) as Side, reason);
  for (const side of [0, 1] as Side[]) {
    const st = s[side];
    if (b.withdrawing[side] && st.alive === 0) return lose(side, 'withdrawn');
    if (st.fit === 0 && st.alive + st.gone >= 0) return lose(side, st.alive === 0 && st.gone === 0 ? 'destruction' : 'morale');
  }
  if (b.score[0] - b.score[1] > 2400) return finish(b, 0, 'points');
  if (b.score[1] - b.score[0] > 2400) return finish(b, 1, 'points');
  if (b.t >= b.timeLimit) {
    const diff = b.score[0] - b.score[1];
    if (diff !== 0) return finish(b, diff > 0 ? 0 : 1, 'points');
    const a = s[0].fit, c = s[1].fit;
    return finish(b, a === c ? null : a > c ? 0 : 1, 'points');
  }
}

export function finish(b: Battle, winner: Side | null, reason: TacticalResult['reason']): void {
  b.phase = 'ended';
  b.result = buildResult(b, winner, reason);
}

function buildResult(b: Battle, winner: Side | null, reason: TacticalResult['reason']): TacticalResult {
  const byRef = new Map<string, SquadResult>();
  const cas: [number, number] = [0, 0];
  for (const e of b.ents) if (!e.alive) cas[e.side]++;
  for (const s of b.squads) {
    const es = b.ents.filter((e) => e.sq === s.id);
    const key = `${s.side}|${s.ref}`;
    let r = byRef.get(key);
    if (!r) { r = { ref: s.ref, side: s.side, kind: s.kind, initial: 0, alive: 0, strength: 0, morale: s.morale, ammo: 0, withdrawn: false }; byRef.set(key, r); }
    const hpSum = es.reduce((a, e) => a + (e.alive ? e.hp / UNITS[e.kind].hp : 0), 0);
    const aliveN = es.filter((e) => e.alive).length;
    r.initial += es.length; r.alive += aliveN; r.strength += hpSum;
    if (s.cargo > 0) { const f = es.length ? hpSum / es.length : 0; r.initial += s.cargo; r.alive += Math.round(s.cargo * f); r.strength += s.cargo * f; }
    const am = es.filter((e) => e.alive).map((e) => { const d = UNITS[e.kind]; return d.w[0].n ? e.am[0] / d.w[0].n : 1; });
    r.ammo = am.length ? am.reduce((a, v) => a + v, 0) / am.length : 0;
    r.withdrawn = r.withdrawn || es.some((e) => e.alive && e.gone);
    r.morale = Math.min(r.morale, s.morale);
  }
  const squads = [...byRef.values()].map((r) => ({ ...r, strength: r.initial ? r.strength / r.initial : 0 }));
  return { winner, reason, elapsedS: b.t, score: [b.score[0], b.score[1]], squads, casualties: cas, collateral: Math.min(1, b.urbanHits) };
}

/** Final result, or a provisional one (reason 'aborted', no winner) while the battle is still running. */
export function result(b: Battle): TacticalResult {
  return b.result ?? buildResult(b, null, 'aborted');
}

export function snapshotBattle(b: Battle, timeScale: number, paused: boolean): TacticalSnapshot {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const cache = cacheOf(b);
  void cache;
  const alive = new Array<number>(b.squads.length).fill(0);
  for (const e of b.ents) if (e.alive && !e.gone) alive[e.sq]++;
  return {
    battle: {
      id: b.id, strategicBattleId: b.strategicBattleId, center: b.center, sizeM: b.map.sizeM, timeScale, elapsedS: r1(b.t), finished: b.phase === 'ended',
      phase: b.phase, paused, auto: b.player === null || (b.player !== null && b.auto[b.player]), player: b.player, result: b.result,
    },
    entities: b.ents.filter((e) => !e.gone).map((e) => {
      const sq = b.squads[e.sq];
      return {
        id: e.id, side: e.side, modelId: sq.modelId, x: r1(e.x), y: r1(e.y), heading: r1((e.h * 180) / Math.PI), hp: Math.round((e.hp / UNITS[e.kind].hp) * 100) / 100,
        alive: e.alive, squad: e.sq, kind: e.kind, moving: e.moving, suppressed: e.supp > 0.4,
      };
    }),
    squads: b.squads.map((s) => ({
      id: s.id, side: s.side, kind: s.kind, name: s.name, x: r1(s.x), y: r1(s.y), face: r1((s.face * 180) / Math.PI), alive: alive[s.id], n0: s.n0,
      morale: Math.round(s.morale * 100) / 100, routed: s.routed, order: s.order, form: s.form, dug: Math.round(s.dug * 100) / 100, smoke: s.smoke, fireFree: s.fireFree, ai: s.ai, cargo: s.cargo,
    })),
    projectiles: b.proj.map((p) => ({ id: p.id, kind: p.kind, x0: r1(p.x0), y0: r1(p.y0), x1: r1(p.x1), y1: r1(p.y1), t0: Math.round(p.t0 * 100) / 100, t1: Math.round(p.t1 * 100) / 100 })),
    smokes: b.smokes, objectives: b.objs, deploy: b.deploy, score: [Math.round(b.score[0]), Math.round(b.score[1])], support: b.support,
  };
}

export { cellOf };
