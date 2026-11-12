/** Wars: declaration, sides/allies, score, capitulation, peace conference. */
import type { Command, CommandResult, CountryId, Ctx, ProvinceId, WarId, WarSide, WorldStatic } from '../../core/contracts';
import { fail } from './actions';
import { proposeSanction } from './assembly';
import {
  DAY, YEAR, addRep, allied, atWar, clamp, flagOn, invalidateWars, isLive, modRelation, nukeStigma, nukes, relation, setFlag, sharedBlocs, sidx,
  sideOf, st, optApi, treasury, warById, warsOf, rivalryLevel, getPair,
} from './relations';
import type { Conference, PeaceOption, WarState } from './types';

const SIDE_CAP = 8;

// ------------------------------------------------------------------ casus belli

export interface CbOption {
  id: string;
  key: string;
  /** 0 none, 1 weak, 2 medium, 3 strong. */
  strength: 0 | 1 | 2 | 3;
}
const CB_REP = [-18, -6, -3, 0];

export function casusBelliOptions(ctx: Ctx, from: CountryId, to: CountryId): CbOption[] {
  const wd = ctx.api.worldDyn;
  const out: CbOption[] = [];
  const now = ctx.state.time.hours;
  // Territory held by the target that belongs to us.
  for (const p of wd.provincesOwnedBy(from)) {
    if (wd.controllerOf(p) === to) {
      out.push({ id: 'territorial', key: 'dip.cb.territorial', strength: 3 });
      break;
    }
  }
  for (const w of warsOf(ctx, to)) {
    const sideTo = sideOf(w, to)!;
    for (const a of sideTo === 'attackers' ? w.defenders : w.attackers) {
      if (a !== to && allied(ctx, from, a) && sideTo === 'attackers') {
        out.push({ id: 'allyAttacked', key: 'dip.cb.allyAttacked', strength: 3 });
        break;
      }
    }
  }
  if (flagOn(ctx, from, to, `cb.${from}`)) out.push({ id: 'grievance', key: 'dip.cb.grievance', strength: 3 });
  const nu = st(ctx).nukeUse[to];
  if (nu !== undefined && now - nu < 3 * YEAR) out.push({ id: 'nuclear', key: 'dip.cb.nuclear', strength: 3 });
  if (flagOn(ctx, from, to, `emb.${to}`)) out.push({ id: 'embargo', key: 'dip.cb.embargo', strength: 2 });
  if ((st(ctx).sanctions[to] ?? 0) > now) out.push({ id: 'sanctioned', key: 'dip.cb.sanctioned', strength: 2 });
  if (rivalryLevel(ctx, from, to) >= 2) out.push({ id: 'rivalry', key: 'dip.cb.rivalry', strength: 1 });
  out.push({ id: 'none', key: 'dip.cb.none', strength: 0 });
  return out.sort((a, b) => b.strength - a.strength);
}

// ------------------------------------------------------------------ joining

export function joinChance(ctx: Ctx, c: CountryId, war: WarState, side: WarSide): number {
  const leader = side === 'attackers' ? war.attackerLeader : war.defenderLeader;
  const enemyLeader = side === 'attackers' ? war.defenderLeader : war.attackerLeader;
  if (ctx.state.world.overlord[c] === leader) return 1;
  let p = side === 'defenders' ? 0.6 : 0.3;
  p += relation(ctx, c, leader) / 250;
  if (st(ctx).nukeUse[enemyLeader] !== undefined && nukeStigma(ctx, enemyLeader) > 0) p += 0.3;
  if (nukes(ctx, enemyLeader) > 0 && nukes(ctx, c) === 0 && !sharedBlocs(ctx, c, enemyLeader).defense) p -= 0.25;
  p -= 0.25 * warsOf(ctx, c).length;
  if (relation(ctx, c, enemyLeader) > 40) p -= 0.3;
  return clamp(p, 0, 0.95);
}

function candidates(ctx: Ctx, leader: CountryId, enemyLeader: CountryId, war: WarState): CountryId[] {
  const set = new Set<CountryId>();
  const ix = sidx(ctx.world);
  for (const i of ix.memberOf.get(leader) ?? []) {
    if (ctx.world.alliances.alliances[i].kind !== 'defense') continue;
    for (const m of ctx.world.alliances.alliances[i].members) set.add(m);
  }
  for (const [k, p] of Object.entries(st(ctx).pairs)) {
    for (const flag of Object.keys(p.fl)) {
      if (!flag.startsWith('guar.') && flag !== 'alliance') continue;
      const [a, b] = k.split('|');
      if (a !== leader && b !== leader) continue;
      set.add(a === leader ? b : a);
    }
  }
  for (const [pup, lord] of Object.entries(ctx.state.world.overlord)) if (lord === leader) set.add(pup);
  set.delete(leader);
  return [...set].filter((c) => !war.attackers.includes(c) && !war.defenders.includes(c) && c !== enemyLeader);
}

/** Calls the allies of one side; the player is never dragged in automatically unless a puppet. */
export function recruit(ctx: Ctx, war: WarState, side: WarSide): CountryId[] {
  const leader = side === 'attackers' ? war.attackerLeader : war.defenderLeader;
  const enemyLeader = side === 'attackers' ? war.defenderLeader : war.attackerLeader;
  const mates = side === 'attackers' ? war.attackers : war.defenders;
  const player = ctx.state.meta.playerCountryId;
  const joined: CountryId[] = [];
  for (const c of candidates(ctx, leader, enemyLeader, war)) {
    if (mates.length >= SIDE_CAP) break;
    if (!isLive(ctx, c)) continue;
    if (c === player && ctx.state.world.overlord[c] !== leader) continue;
    if (allied(ctx, c, enemyLeader) || atWar(ctx, c, leader)) continue;
    const enemies = side === 'attackers' ? war.defenders : war.attackers;
    if (enemies.some((e) => allied(ctx, c, e))) continue;
    if (!ctx.rng.chance(joinChance(ctx, c, war, side))) continue;
    joinWar(ctx, war, c, side);
    joined.push(c);
  }
  return joined;
}

export function joinWar(ctx: Ctx, war: WarState, c: CountryId, side: WarSide): void {
  (side === 'attackers' ? war.attackers : war.defenders).push(c);
  invalidateWars();
  const enemies = side === 'attackers' ? war.defenders : war.attackers;
  for (const e of enemies) modRelation(ctx, c, e, -25, 'dip.cause.war');
  ctx.bus.emit({ type: 'dip.warJoined', war: war.id, country: c, side });
  ctx.news('diplomacy', 'dip.news.joined', { country: c, leader: side === 'attackers' ? war.attackerLeader : war.defenderLeader }, { country: c }, {
    countries: [c, war.attackerLeader, war.defenderLeader], importance: 1,
  });
}

// ------------------------------------------------------------------ declaration

export function startWar(ctx: Ctx, a: CountryId, d: CountryId, cb: string, opts: { recruit?: boolean; quiet?: boolean } = {}): WarState {
  const s = st(ctx);
  const war: WarState = {
    id: `W${s.nextId++}`,
    attackers: [a], defenders: [d], attackerLeader: a, defenderLeader: d,
    startedHours: ctx.state.time.hours, casusBelli: `dip.cb.${cb}`,
    score: 0, tallyA: 0, tallyD: 0, occA: 0, occD: 0, capitulated: [],
  };
  s.wars.push(war);
  s.stats.warsStarted++;
  invalidateWars();
  modRelation(ctx, a, d, -40, 'dip.cause.war');
  for (const [pup, lord] of Object.entries(ctx.state.world.overlord)) {
    if (lord === d && pup !== a && isLive(ctx, pup)) joinWar(ctx, war, pup, 'defenders');
    if (lord === a && pup !== d && isLive(ctx, pup)) joinWar(ctx, war, pup, 'attackers');
  }
  const lordD = ctx.state.world.overlord[d];
  if (lordD && lordD !== a && isLive(ctx, lordD) && !war.defenders.includes(lordD)) joinWar(ctx, war, lordD, 'defenders');
  if (opts.recruit !== false) {
    recruit(ctx, war, 'defenders');
    if (a !== ctx.state.meta.playerCountryId) recruit(ctx, war, 'attackers');
  }
  ctx.bus.emit({ type: 'dip.warDeclared', war: war.id, attacker: a, defender: d, casusBelli: war.casusBelli });
  if (!opts.quiet) {
    const player = ctx.state.meta.playerCountryId;
    ctx.news('diplomacy', 'dip.news.warDeclared', { a, b: d, cb: war.casusBelli }, { country: d }, {
      countries: [a, d], importance: a === player || d === player ? 2 : 1,
    });
  }
  return war;
}

export function declareWar(ctx: Ctx, cmd: Command): CommandResult {
  const from = cmd.country;
  const to = String(cmd.target ?? '');
  const player = ctx.state.meta.playerCountryId;
  const diff = ctx.state.meta.difficulty;
  if (from === to) return fail('dip.err.self');
  if (!isLive(ctx, from) || !isLive(ctx, to)) return fail('dip.err.dead');
  if (atWar(ctx, from, to)) return fail('dip.err.atWar');
  if (allied(ctx, from, to)) return fail('dip.err.allied');
  if (ctx.state.world.overlord[from] === to) return fail('dip.err.overlord');
  const opts = casusBelliOptions(ctx, from, to);
  const chosen = cmd.casusBelli ? opts.find((o) => o.id === cmd.casusBelli) : opts[0];
  if (!chosen) return fail('dip.err.badCb');
  if (to === player && from !== player) {
    if (diff === 'sandbox') return fail('dip.err.sandboxPeace');
    if (diff === 'normal' && chosen.strength < 3) return fail('dip.err.noStrongCb');
  }
  const bound = flagOn(ctx, from, to, 'nap') || flagOn(ctx, from, to, 'truce');
  if (bound && cmd.force !== true) return fail(flagOn(ctx, from, to, 'nap') ? 'dip.err.nap' : 'dip.err.truce');
  const guarantor = Object.keys(getPair(ctx, from, to)?.fl ?? {}).some((k) => k.startsWith('guar.') && flagOn(ctx, from, to, k) && k !== `guar.${from}`);
  if (bound || guarantor) addRep(ctx, from, -25);
  const war = startWar(ctx, from, to, chosen.id);
  addRep(ctx, from, CB_REP[chosen.strength] * (diff === 'sandbox' && from === player ? 0 : 1));
  if (chosen.strength === 0) {
    modRelation(ctx, from, to, -10, 'dip.cause.unprovoked');
    proposeSanction(ctx, from, to, 'dip.vote.aggression');
  }
  return { ok: true, war: war.id };
}

export function callAllies(ctx: Ctx, cmd: Command): CommandResult {
  const w = warById(ctx, String(cmd.war ?? ''));
  if (!w) return fail('dip.err.noWar');
  const side = sideOf(w, cmd.country);
  if (!side) return fail('dip.err.notInWar');
  const leader = side === 'attackers' ? w.attackerLeader : w.defenderLeader;
  if (leader !== cmd.country) return fail('dip.err.notLeader');
  const joined = recruit(ctx, w, side);
  return { ok: true, joined: joined.length };
}

export function joinWarCmd(ctx: Ctx, cmd: Command): CommandResult {
  const w = warById(ctx, String(cmd.war ?? ''));
  const side = cmd.side === 'attackers' ? 'attackers' : cmd.side === 'defenders' ? 'defenders' : null;
  if (!w || !side) return fail('dip.err.noWar');
  const c = cmd.country;
  if (sideOf(w, c)) return fail('dip.err.already');
  const leader = side === 'attackers' ? w.attackerLeader : w.defenderLeader;
  const enemyLeader = side === 'attackers' ? w.defenderLeader : w.attackerLeader;
  if (!allied(ctx, c, leader) && relation(ctx, c, leader) < 20) return fail('dip.err.notAllied');
  if (allied(ctx, c, enemyLeader)) return fail('dip.err.alliedEnemy');
  joinWar(ctx, w, c, side);
  return { ok: true };
}

// ------------------------------------------------------------------ score & capitulation

const weightCache = new WeakMap<WorldStatic, Map<ProvinceId, number>>();
function provWeight(w: WorldStatic, p: ProvinceId): number {
  let m = weightCache.get(w);
  if (!m) weightCache.set(w, (m = new Map()));
  let v = m.get(p);
  if (v === undefined) {
    v = 1;
    for (const i of w.citiesByProvince.get(p) ?? []) v += w.cities[i].pop / 2e6;
    m.set(p, v);
  }
  return v;
}

function occupation(ctx: Ctx, holders: CountryId[], owners: CountryId[]): number {
  const wd = ctx.api.worldDyn;
  const hs = new Set(holders);
  let total = 0, held = 0;
  for (const o of owners) {
    for (const p of wd.provincesOwnedBy(o)) {
      const wgt = provWeight(ctx.world, p);
      total += wgt;
      if (hs.has(wd.controllerOf(p))) held += wgt;
    }
  }
  return total > 0 ? held / total : 0;
}

/** Capitulation rule (PLANO 7.4): capital + ≥ 50 % of urban population occupied (or everything occupied). */
export function hasCapitulated(ctx: Ctx, x: CountryId, enemies: CountryId[]): boolean {
  const wd = ctx.api.worldDyn;
  const es = new Set(enemies);
  const owned = wd.provincesOwnedBy(x);
  if (owned.length === 0) return true;
  let occProv = 0, urbanTotal = 0, urbanOcc = 0;
  for (const p of owned) {
    const occ = es.has(wd.controllerOf(p));
    if (occ) occProv++;
    for (const i of ctx.world.citiesByProvince.get(p) ?? []) {
      const pop = ctx.world.cities[i].pop;
      urbanTotal += pop;
      if (occ) urbanOcc += pop;
    }
  }
  if (occProv === 0) return false;
  if (occProv === owned.length) return true;
  const capIdx = ctx.world.capitalCityOf(x);
  const capProv = capIdx === null ? null : ctx.world.cities[capIdx].provinceId;
  const capitalOcc = capProv !== null && wd.ownerOf(capProv) === x && es.has(wd.controllerOf(capProv));
  const share = urbanTotal > 0 ? urbanOcc / urbanTotal : occProv / owned.length;
  return capitalOcc && share >= 0.5;
}

export function updateWarScore(ctx: Ctx, w: WarState): void {
  w.occD = occupation(ctx, w.attackers, w.defenders);
  w.occA = occupation(ctx, w.defenders, w.attackers);
  const bal = (w.tallyA - w.tallyD) / (w.tallyA + w.tallyD + 10);
  w.score = Math.round(100 * clamp(1.4 * (w.occD - w.occA) + 0.35 * bal, -1, 1));
  w.tallyA *= 0.995;
  w.tallyD *= 0.995;
}

export function dailyWars(ctx: Ctx): void {
  const s = st(ctx);
  for (const w of s.wars.slice()) {
    if (!s.wars.includes(w)) continue;
    // Drop dead members.
    for (const side of [w.attackers, w.defenders]) {
      for (const c of side.slice()) if (!ctx.api.worldDyn.isAlive(c) && c !== w.attackerLeader && c !== w.defenderLeader) side.splice(side.indexOf(c), 1);
    }
    invalidateWars();
    if (!ctx.api.worldDyn.isAlive(w.attackerLeader) || !ctx.api.worldDyn.isAlive(w.defenderLeader)) {
      endWar(ctx, w, ctx.api.worldDyn.isAlive(w.attackerLeader) ? 'attackers' : ctx.api.worldDyn.isAlive(w.defenderLeader) ? 'defenders' : null, 'leaderDied');
      continue;
    }
    updateWarScore(ctx, w);
    for (const [side, enemies] of [[w.attackers, w.defenders], [w.defenders, w.attackers]] as [CountryId[], CountryId[]][]) {
      for (const x of side.slice()) {
        if (w.capitulated.includes(x)) continue;
        if (hasCapitulated(ctx, x, enemies)) {
          w.capitulated.push(x);
          capitulate(ctx, w, x);
          if (!s.wars.includes(w)) break;
        }
      }
      if (!s.wars.includes(w)) break;
    }
    // keep relations pinned low while fighting
    for (const a of w.attackers) for (const d of w.defenders) {
      const p = getPair(ctx, a, d, true)!;
      if (p.rel > -40) p.rel = -40;
    }
  }
}

// ------------------------------------------------------------------ conference & peace

function capitulate(ctx: Ctx, w: WarState, loser: CountryId): void {
  const side = sideOf(w, loser);
  if (!side) return;
  const winnersSide = side === 'attackers' ? w.defenders : w.attackers;
  const receiver = side === 'attackers' ? w.defenderLeader : w.attackerLeader;
  const conf: Conference = {
    id: st(ctx).nextId++, war: w.id, loser, winners: winnersSide.filter((c) => !w.capitulated.includes(c) || c === receiver), receiver,
    warEnds: loser === (side === 'attackers' ? w.attackerLeader : w.defenderLeader),
    occupied: occupation(ctx, winnersSide, [loser]), until: ctx.state.time.hours + 30 * DAY,
  };
  const player = ctx.state.meta.playerCountryId;
  ctx.news('diplomacy', 'dip.news.capitulated', { country: loser, by: receiver }, { country: loser }, {
    countries: [loser, receiver], importance: loser === player || receiver === player ? 2 : 1,
  });
  if (receiver === player && ctx.state.meta.automation['ai.controlsPlayer'] !== true) {
    st(ctx).conferences.push(conf);
    return;
  }
  applyPeace(ctx, conf, aiChoosePeace(ctx, conf));
}

export function peaceOptionsFor(conf: Conference): PeaceOption[] {
  const o: PeaceOption[] = ['annexOccupied', 'puppet', 'regime', 'reparations', 'white'];
  if (conf.occupied >= 0.5) o.unshift('annexAll');
  return o;
}

export function aiChoosePeace(ctx: Ctx, conf: Conference): PeaceOption {
  const player = ctx.state.meta.playerCountryId;
  const diff = ctx.state.meta.difficulty;
  const opts = peaceOptionsFor(conf);
  const weightOf: Record<PeaceOption, number> = { annexAll: conf.occupied >= 0.85 ? 10 : 2, annexOccupied: 40, puppet: conf.occupied >= 0.6 ? 15 : 3, regime: 10, reparations: 18, white: 8 };
  if (conf.loser === player) {
    if (diff === 'sandbox') return 'white';
    if (diff === 'normal') { weightOf.annexAll = 0; weightOf.puppet = 0; }
  }
  const weights = opts.map((o) => weightOf[o]);
  const i = ctx.rng.weightedIndex(weights);
  return i < 0 ? 'white' : opts[i];
}

function releaseAll(ctx: Ctx, a: CountryId[], b: CountryId[]): void {
  const wd = ctx.api.worldDyn;
  for (const [x, y] of [[a, b], [b, a]]) {
    const ys = new Set(y);
    for (const owner of x) for (const p of [...wd.provincesOwnedBy(owner)]) if (ys.has(wd.controllerOf(p))) wd.setController(p, owner, 'dip.peace');
  }
}

export function applyPeace(ctx: Ctx, conf: Conference, option: PeaceOption): void {
  const w = warById(ctx, conf.war);
  const wd = ctx.api.worldDyn;
  const { loser, receiver } = conf;
  const winners = new Set(conf.winners);
  winners.add(receiver);
  const player = ctx.state.meta.playerCountryId;
  const owned = [...wd.provincesOwnedBy(loser)];
  const occupier = (p: ProvinceId): CountryId => {
    const c = wd.controllerOf(p);
    return winners.has(c) ? c : receiver;
  };
  const eco = optApi(ctx, 'economy');
  switch (option) {
    case 'annexAll':
      for (const p of owned) wd.setOwner(p, occupier(p), { cause: 'dip.annex' });
      addRep(ctx, receiver, -6);
      break;
    case 'annexOccupied':
      for (const p of owned) if (winners.has(wd.controllerOf(p))) wd.setOwner(p, wd.controllerOf(p), { cause: 'dip.annex' });
      addRep(ctx, receiver, -1);
      break;
    case 'puppet':
      for (const p of owned) if (winners.has(wd.controllerOf(p))) wd.setController(p, loser, 'dip.peace');
      wd.setOverlord(loser, receiver);
      addRep(ctx, receiver, -3);
      break;
    case 'regime':
      for (const p of owned) if (winners.has(wd.controllerOf(p))) wd.setController(p, loser, 'dip.peace');
      eco?.addUnrest({ country: loser }, 6, 'dip.unrest.regimeChange', 180);
      optApi(ctx, 'research')?.addModifier(loser, 'eco.stability', 0.92, ctx.state.time.hours + 2 * YEAR, 'dip.regimeChange');
      setFlag(ctx, receiver, loser, `acc.${receiver}`, null);
      setFlag(ctx, receiver, loser, 'trade', null);
      addRep(ctx, receiver, -2);
      break;
    case 'reparations': {
      for (const p of owned) if (winners.has(wd.controllerOf(p))) wd.setController(p, loser, 'dip.peace');
      const amount = Math.round(Math.max(0, treasury(ctx, loser) ?? 0) * 0.4);
      if (amount > 0 && eco?.charge(loser, { money: amount }, 'dip.cost.reparations')) eco.credit(receiver, amount, 'dip.income.reparations');
      break;
    }
    case 'white':
      for (const p of owned) if (winners.has(wd.controllerOf(p))) wd.setController(p, loser, 'dip.peace');
      addRep(ctx, receiver, 2);
      break;
  }
  if (wd.provincesOwnedBy(loser).length === 0 && wd.isAlive(loser)) wd.killCountry(loser, receiver);
  else if (option !== 'puppet') modRelation(ctx, loser, receiver, option === 'white' ? 5 : -15, 'dip.cause.peace');
  setFlag(ctx, loser, receiver, 'truce', ctx.state.time.hours + 2 * YEAR);
  const confs = st(ctx).conferences;
  const ci = confs.findIndex((c) => c.id === conf.id);
  if (ci >= 0) confs.splice(ci, 1);
  ctx.news('diplomacy', `dip.news.peace.${option}`, { loser, winner: receiver }, { country: loser }, {
    countries: [loser, receiver], importance: loser === player || receiver === player ? 2 : 1,
  });
  if (!w) return;
  if (conf.warEnds) endWar(ctx, w, sideOf(w, receiver), option);
  else {
    removeFromWar(ctx, w, loser);
  }
}

function removeFromWar(ctx: Ctx, w: WarState, c: CountryId): void {
  const side = sideOf(w, c);
  if (!side) return;
  const list = side === 'attackers' ? w.attackers : w.defenders;
  const enemies = side === 'attackers' ? w.defenders : w.attackers;
  releaseAll(ctx, [c], enemies);
  list.splice(list.indexOf(c), 1);
  invalidateWars();
  if (list.length === 0 || c === (side === 'attackers' ? w.attackerLeader : w.defenderLeader)) endWar(ctx, w, side === 'attackers' ? 'defenders' : 'attackers', 'separate');
}

export function endWar(ctx: Ctx, w: WarState, winner: WarSide | null, option: string): void {
  const s = st(ctx);
  releaseAll(ctx, w.attackers, w.defenders);
  const i = s.wars.indexOf(w);
  if (i >= 0) s.wars.splice(i, 1);
  invalidateWars();
  s.stats.warsEnded++;
  setFlag(ctx, w.attackerLeader, w.defenderLeader, 'truce', ctx.state.time.hours + YEAR);
  s.conferences = s.conferences.filter((c) => c.war !== w.id);
  ctx.bus.emit({ type: 'dip.warEnded', war: w.id, winner, option });
  if (option === 'white' || option === 'treaty') {
    const player = ctx.state.meta.playerCountryId;
    ctx.news('diplomacy', 'dip.news.warEnded', { a: w.attackerLeader, b: w.defenderLeader }, { country: w.defenderLeader }, {
      countries: [w.attackerLeader, w.defenderLeader], importance: w.attackerLeader === player || w.defenderLeader === player ? 2 : 1,
    });
  }
}

// ---- peace proposals

/** Acceptance score from the point of view of `target` for a peace offered by `from`. */
export function peaceEval(ctx: Ctx, w: WarState, from: CountryId, target: CountryId, terms: string): { score: number; chance: number } {
  const side = sideOf(w, target)!;
  const sTarget = side === 'attackers' ? w.score : -w.score;
  const days = (ctx.state.time.hours - w.startedHours) / DAY;
  let score = -sTarget * 0.6 + Math.min(40, days / 12) - 5;
  if (terms === 'annexOccupied') score = -sTarget - 40 + Math.min(20, days / 20);
  const stab = optApi(ctx, 'economy')?.stability(target) ?? null;
  if (stab !== null && stab < 35) score += 15;
  void from;
  return { score: Math.round(score), chance: Math.round(clamp(0.5 + score / 50, 0.02, 0.97) * 100) / 100 };
}

export function proposePeace(ctx: Ctx, cmd: Command): CommandResult {
  const w = warById(ctx, String(cmd.war ?? ''));
  if (!w) return fail('dip.err.noWar');
  const from = cmd.country;
  const side = sideOf(w, from);
  if (!side) return fail('dip.err.notInWar');
  const target = side === 'attackers' ? w.defenderLeader : w.attackerLeader;
  const terms = cmd.terms === 'annexOccupied' ? 'annexOccupied' : 'white';
  if (terms === 'annexOccupied' && (side === 'attackers' ? w.score : -w.score) < 35) return fail('dip.err.scoreTooLow');
  const ev = peaceEval(ctx, w, from, target, terms);
  const player = ctx.state.meta.playerCountryId;
  if (target === player && from !== player) {
    const s = st(ctx);
    if (s.inbox.some((p) => p.war === w.id && p.from === from)) return fail('dip.err.already');
    s.inbox.push({ id: s.nextId++, from, to: target, kind: 'peace', until: ctx.state.time.hours + 20 * DAY, war: w.id });
    return { ok: true, pending: true };
  }
  if (!ctx.rng.chance(ev.chance)) return fail('dip.err.refused', { chance: Math.round(ev.chance * 100) });
  makePeace(ctx, w, from, target, terms);
  return { ok: true, accepted: true };
}

/** Applies an agreed peace between `from` and the enemy leader `target`. */
export function makePeace(ctx: Ctx, w: WarState, from: CountryId, target: CountryId, terms: string): void {
  const isLeader = from === w.attackerLeader || from === w.defenderLeader;
  if (terms === 'annexOccupied') {
    const winnerSide = sideOf(w, from)!;
    const winners = winnerSide === 'attackers' ? w.attackers : w.defenders;
    applyPeace(ctx, { id: -1, war: w.id, loser: target, winners: [...winners], receiver: from, warEnds: true, occupied: winnerSide === 'attackers' ? w.occD : w.occA, until: 0 }, 'annexOccupied');
    return;
  }
  if (isLeader) endWar(ctx, w, null, 'white');
  else removeFromWar(ctx, w, from);
}

export function peaceChoose(ctx: Ctx, cmd: Command): CommandResult {
  const conf = st(ctx).conferences.find((c) => c.id === Number(cmd.conference));
  if (!conf || conf.receiver !== cmd.country) return fail('dip.err.noConference');
  const opt = String(cmd.option) as PeaceOption;
  if (!peaceOptionsFor(conf).includes(opt)) return fail('dip.err.badOption');
  applyPeace(ctx, conf, opt);
  return { ok: true };
}

export function dailyConferences(ctx: Ctx): void {
  for (const c of st(ctx).conferences.slice()) if (c.until <= ctx.state.time.hours) applyPeace(ctx, c, 'annexOccupied');
}

export function endedByDeath(ctx: Ctx, country: CountryId): void {
  for (const w of st(ctx).wars.slice()) {
    const side = sideOf(w, country);
    if (!side) continue;
    const leader = country === w.attackerLeader || country === w.defenderLeader;
    if (leader) endWar(ctx, w, side === 'attackers' ? 'defenders' : 'attackers', 'leaderDied');
    else removeFromWar(ctx, w, country);
  }
}

/** Tally a province capture into the war between `from` (old controller) and `to` (new controller). */
export function onCapture(ctx: Ctx, province: ProvinceId, from: CountryId, to: CountryId): void {
  const w = warsOf(ctx, to).find((x) => sideOf(x, from) !== null && sideOf(x, from) !== sideOf(x, to));
  if (!w) return;
  const pts = provWeight(ctx.world, province);
  if (sideOf(w, to) === 'attackers') w.tallyA += pts;
  else w.tallyD += pts;
}

/** Tally a finished strategic battle (fields sniffed from `mil.*` events). */
export function onBattleResult(ctx: Ctx, attackers: CountryId[], defenders: CountryId[], winner: WarSide | null): void {
  if (!winner || !attackers.length || !defenders.length) return;
  const w = warsOf(ctx, attackers[0]).find((x) => sideOf(x, defenders[0]) !== null && sideOf(x, defenders[0]) !== sideOf(x, attackers[0]));
  if (!w) return;
  const winCountry = winner === 'attackers' ? attackers[0] : defenders[0];
  if (sideOf(w, winCountry) === 'attackers') w.tallyA += 3;
  else w.tallyD += 3;
}
