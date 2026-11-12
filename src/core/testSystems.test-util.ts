/**
 * Test-only systems exercising the SimSystem contract (slices, hooks, commands, events, rng).
 * They use generic (unaugmented) slices so they do not leak types into the real modules.
 */
import type { AnySimSystem, Command, Ctx, SimSystem, SystemId } from './contracts';

export interface CounterSlice {
  ticks: number;
  hoursSeen: number;
  days: number;
  weeks: number;
  months: number;
  rolls: number[];
  log: string[];
}

const slice = (ctx: Ctx, id: SystemId) => (ctx.state as unknown as Record<string, CounterSlice>)[id];

export function counterSystem(id: SystemId, log?: string[]): AnySimSystem {
  const sys: SimSystem = {
    id,
    createSlice: () => ({ ticks: 0, hoursSeen: 0, days: 0, weeks: 0, months: 0, rolls: [], log: [] }) satisfies CounterSlice,
    update(ctx, dt) {
      const s = slice(ctx, id);
      s.ticks++;
      s.hoursSeen += dt;
      log?.push(`${id}.update`);
    },
    onDay(ctx) {
      const s = slice(ctx, id);
      s.days++;
      s.rolls.push(ctx.rng.int(0, 1000));
      if (s.rolls.length > 50) s.rolls.shift();
      log?.push(`${id}.day`);
    },
    onWeek(ctx) {
      slice(ctx, id).weeks++;
    },
    onMonth(ctx) {
      slice(ctx, id).months++;
      ctx.news('game', 'test.month', { system: id });
    },
    handle(ctx, cmd: Command) {
      if (cmd.type.endsWith('.ping')) {
        slice(ctx, id).log.push(`ping:${cmd.country}`);
        return { ok: true };
      }
      return undefined;
    },
    api: (ctx: Ctx) => ({ ticks: () => slice(ctx, id).ticks }) as never,
    metrics: (ctx) => ({ ticks: slice(ctx, id).ticks }),
  };
  return sys as AnySimSystem;
}
