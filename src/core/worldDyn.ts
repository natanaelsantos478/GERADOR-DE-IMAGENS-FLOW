/**
 * Core-owned dynamic world (territory, liveness, puppets, infrastructure damage).
 * Mutators write `ctx.state.world` and emit `world.*` events; reads use cached reverse indices
 * that are invalidated on every mutation and on load.
 */
import type { CountryId, Ctx, DamageMap, InfraKind, ProvinceId, WorldDyn, WorldDynApi, WorldStatic } from './contracts';

const DAMAGE_FIELD: Record<InfraKind, keyof Pick<WorldDyn, 'cityDamage' | 'plantDamage' | 'airportDamage' | 'portDamage' | 'roadDamage'>> = {
  city: 'cityDamage',
  plant: 'plantDamage',
  airport: 'airportDamage',
  port: 'portDamage',
  road: 'roadDamage',
};

/** Initial WorldDyn: every province owned and controlled by its real country. */
export function createWorldDyn(world: WorldStatic): WorldDyn {
  const owner: Record<ProvinceId, CountryId> = {};
  const alive: Record<CountryId, boolean> = {};
  for (const c of world.countries) alive[c.id] = false;
  for (const p of world.provinces) {
    owner[p.id] = p.countryId;
    alive[p.countryId] = true;
  }
  return {
    owner,
    controller: { ...owner },
    alive,
    overlord: {},
    cityDamage: {},
    plantDamage: {},
    airportDamage: {},
    portDamage: {},
    roadDamage: {},
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface WorldDynInternal extends WorldDynApi {
  /** Drop cached indices (called by Game after hydrate). */
  invalidate(): void;
}

export function createWorldDynApi(ctx: Ctx): WorldDynInternal {
  let ownedBy: Map<CountryId, ProvinceId[]> | null = null;
  let controlledBy: Map<CountryId, ProvinceId[]> | null = null;
  let aliveList: CountryId[] | null = null;
  const empty: readonly ProvinceId[] = Object.freeze([]);
  const wd = () => ctx.state.world;

  const group = (m: Record<ProvinceId, CountryId>) => {
    const out = new Map<CountryId, ProvinceId[]>();
    // Iterate in static order so results are deterministic.
    for (const p of ctx.world.provinces) {
      const c = m[p.id];
      if (c === undefined) continue;
      let l = out.get(c);
      if (!l) out.set(c, (l = []));
      l.push(p.id);
    }
    return out;
  };
  const invalidateTerritory = () => {
    ownedBy = null;
    controlledBy = null;
  };
  const checkProvince = (p: ProvinceId) => {
    if (!ctx.world.provinceById.has(p)) throw new Error(`worldDyn: unknown province ${p}`);
  };
  const checkCountry = (c: CountryId) => {
    if (!ctx.world.countryById.has(c)) throw new Error(`worldDyn: unknown country ${c}`);
  };
  const map = (kind: InfraKind): DamageMap => {
    const f = DAMAGE_FIELD[kind];
    if (!f) throw new Error(`worldDyn: unknown infrastructure kind ${kind}`);
    return wd()[f];
  };

  const api: WorldDynInternal = {
    invalidate() {
      invalidateTerritory();
      aliveList = null;
    },
    setController(p, c, cause) {
      checkProvince(p);
      checkCountry(c);
      const from = wd().controller[p];
      if (from === c) return;
      wd().controller[p] = c;
      invalidateTerritory();
      ctx.bus.emit({ type: 'world.controllerChanged', province: p, from, to: c, ...(cause ? { cause } : {}) });
    },
    setOwner(p, c, opts) {
      checkProvince(p);
      checkCountry(c);
      const from = wd().owner[p];
      if (from !== c) {
        wd().owner[p] = c;
        invalidateTerritory();
        ctx.bus.emit({ type: 'world.ownerChanged', province: p, from, to: c, ...(opts?.cause ? { cause: opts.cause } : {}) });
      }
      // Owning land means existing: a dead country given a province comes back.
      if (!wd().alive[c]) api.reviveCountry(c);
      if (!opts?.keepController) api.setController(p, c, opts?.cause);
    },
    damage(kind, index, amount, cause) {
      if (!(amount > 0)) return 0;
      const m = map(kind);
      const old = m[index] ?? 0;
      const total = clamp01(old + amount);
      const applied = total - old;
      if (applied <= 0) return 0;
      m[index] = total;
      ctx.bus.emit({ type: 'world.damaged', kind, index, amount: applied, total, cause });
      return applied;
    },
    repair(kind, index, amount) {
      if (!(amount > 0)) return 0;
      const m = map(kind);
      const old = m[index] ?? 0;
      if (old <= 0) return 0;
      const total = clamp01(old - amount);
      if (total <= 1e-6) delete m[index];
      else m[index] = total;
      const removed = old - (total <= 1e-6 ? 0 : total);
      ctx.bus.emit({ type: 'world.repaired', kind, index, amount: removed, total: m[index] ?? 0 });
      return removed;
    },
    killCountry(c, by) {
      checkCountry(c);
      if (!wd().alive[c]) return;
      wd().alive[c] = false;
      aliveList = null;
      for (const [puppet, lord] of Object.entries(wd().overlord)) if (lord === c) api.setOverlord(puppet, null);
      if (wd().overlord[c] !== undefined) api.setOverlord(c, null);
      ctx.bus.emit({ type: 'world.countryKilled', country: c, ...(by ? { by } : {}) });
    },
    reviveCountry(c) {
      checkCountry(c);
      if (wd().alive[c]) return;
      wd().alive[c] = true;
      aliveList = null;
      ctx.bus.emit({ type: 'world.countryRevived', country: c });
    },
    setOverlord(c, overlord) {
      checkCountry(c);
      if (overlord !== null) {
        checkCountry(overlord);
        if (overlord === c) throw new Error(`worldDyn: ${c} cannot be its own overlord`);
      }
      const cur = wd().overlord[c] ?? null;
      if (cur === overlord) return;
      if (overlord === null) delete wd().overlord[c];
      else wd().overlord[c] = overlord;
      ctx.bus.emit({ type: 'world.overlordChanged', country: c, overlord });
    },
    ownerOf: (p) => wd().owner[p],
    controllerOf: (p) => wd().controller[p],
    isOccupied: (p) => wd().owner[p] !== wd().controller[p],
    provincesOwnedBy(c) {
      ownedBy ??= group(wd().owner);
      return ownedBy.get(c) ?? empty;
    },
    provincesControlledBy(c) {
      controlledBy ??= group(wd().controller);
      return controlledBy.get(c) ?? empty;
    },
    isAlive: (c) => wd().alive[c] === true,
    aliveCountries() {
      aliveList ??= ctx.world.countries.filter((c) => wd().alive[c.id]).map((c) => c.id);
      return aliveList;
    },
    overlordOf: (c) => wd().overlord[c] ?? null,
    puppetsOf(c) {
      const out: CountryId[] = [];
      for (const [puppet, lord] of Object.entries(wd().overlord)) if (lord === c) out.push(puppet);
      return out.sort();
    },
    damageOf: (kind, index) => map(kind)[index] ?? 0,
    effectiveHealth: (kind, index) => 1 - (map(kind)[index] ?? 0),
  };
  return api;
}
