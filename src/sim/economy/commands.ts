/** Handlers of `eco.*` commands (the player and the AI use exactly the same ones). */
import type { Command, CommandResult, Ctx } from '../../core/contracts';
import { SPEND_MAX, SPEND_MIN, TAX_MAX } from './balance';
import { cancelBuild, startBuild, startRepair } from './build';
import { spotTrade } from './resources';
import { PILLARS, RES_LIST, TAX_KINDS, type InfraTarget, type Pillar, type Tradable, type TaxKind } from './types';
import { clamp } from './util';

const no = (reason: string): CommandResult => ({ ok: false, reason });
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function handleCommand(ctx: Ctx, cmd: Command): CommandResult | undefined {
  const s = ctx.state.economy;
  const c = cmd.country;
  const e = s.c[c];
  if (!e) return no('eco.err.noCountry');
  if (!ctx.api.worldDyn.isAlive(c)) return no('eco.err.noCountry');
  switch (cmd.type) {
    case 'eco.setTax': {
      const v = num(cmd.value);
      if (!TAX_KINDS.includes(cmd.tax as TaxKind) || v === null) return no('eco.err.invalidValue');
      e.tax[cmd.tax as TaxKind] = clamp(v, 0, TAX_MAX);
      return { ok: true };
    }
    case 'eco.setSpend': {
      const v = num(cmd.level);
      if (!PILLARS.includes(cmd.pillar as Pillar) || v === null) return no('eco.err.invalidValue');
      e.spend[cmd.pillar as Pillar] = clamp(v, SPEND_MIN, SPEND_MAX);
      return { ok: true };
    }
    case 'eco.build': {
      const r = startBuild(ctx, c, {
        kind: cmd.kind as never, variant: cmd.variant as string | undefined, province: String(cmd.province),
        lon: num(cmd.lon) ?? undefined, lat: num(cmd.lat) ?? undefined, mw: num(cmd.mw) ?? undefined, nodes: cmd.nodes as [number, number] | undefined,
      });
      return r.ok ? { ok: true, id: r.id } : no(r.reason);
    }
    case 'eco.cancelBuild': {
      const r = cancelBuild(ctx, c, String(cmd.id));
      return r ? no(r) : { ok: true };
    }
    case 'eco.repair': {
      const r = startRepair(ctx, c, cmd.infra as InfraTarget, Number(cmd.index));
      return r ? no(r) : { ok: true };
    }
    case 'eco.trade': {
      const a = num(cmd.amount);
      if (a === null || !RES_LIST.includes(cmd.resource as never)) return no('eco.err.invalidValue');
      const r = spotTrade(ctx, c, cmd.resource as Tradable, a);
      return r ? no(r) : { ok: true };
    }
    case 'eco.setEmbargo': {
      const t = String(cmd.target);
      if (!s.c[t] || t === c) return no('eco.err.noCountry');
      const l = new Set(s.embargo[c] ?? []);
      if (cmd.on) l.add(t); else l.delete(t);
      s.embargo[c] = [...l].sort();
      if (!s.embargo[c].length) delete s.embargo[c];
      return { ok: true };
    }
    case 'eco.setBlockade': {
      // `country` is the blockading power; the blockaded target cannot trade until `untilHours`.
      const t = String(cmd.target);
      if (!s.c[t] || t === c) return no('eco.err.noCountry');
      const until = cmd.untilHours === null ? 0 : num(cmd.untilHours);
      if (until === null) return no('eco.err.invalidValue');
      if (until > ctx.state.time.hours) s.blockade[t] = until; else delete s.blockade[t];
      return { ok: true };
    }
    case 'eco.borrow': {
      const a = num(cmd.amount);
      if (a === null || a <= 0) return no('eco.err.invalidValue');
      if (e.debt + a > e.gdp * Math.max(0.3, 1.6 - e.inflation * 4)) return no('eco.err.debtLimit');
      e.debt += a; e.treasury += a;
      return { ok: true };
    }
    case 'eco.repay': {
      const a = num(cmd.amount);
      if (a === null || a <= 0) return no('eco.err.invalidValue');
      const pay = Math.min(a, e.debt);
      if (e.treasury < pay) return no('eco.err.noMoney');
      e.debt -= pay; e.treasury -= pay;
      return { ok: true };
    }
    case 'eco.setPowerContract': {
      const p = String(cmd.partner), mw = num(cmd.mw);
      if (!s.c[p] || p === c || mw === null) return no('eco.err.invalidValue');
      s.contracts = s.contracts.filter((k) => !(k.from === c && k.to === p));
      if (mw > 0) s.contracts.push({ from: c, to: p, mw: Math.min(mw, 20000) });
      return { ok: true };
    }
    default:
      return undefined;
  }
}
