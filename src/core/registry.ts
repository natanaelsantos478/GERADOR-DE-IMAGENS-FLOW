/** System registry: canonical ordering (PLANO §6) and command routing by prefix. */
import type { AnySimSystem, Command, CommandResult, Ctx, SimSystem, SystemId } from './contracts';
import { SYSTEM_ORDER, SYSTEM_PREFIX } from './contracts';

/** Identity helper giving full inference of the slice/API types of a system. */
export function defineSystem<K extends SystemId>(sys: SimSystem<K>): SimSystem<K> {
  return sys;
}

export interface Registry {
  /** Registered systems in update order. */
  readonly systems: readonly AnySimSystem[];
  has(id: SystemId): boolean;
  get(id: SystemId): AnySimSystem | undefined;
  /** System that owns a command/event prefix, if registered. */
  byPrefix(prefix: string): AnySimSystem | undefined;
  /** Routes a non-core command to its system; never throws for unknown routes. */
  route(ctx: Ctx, cmd: Command): CommandResult;
}

const PREFIX_TO_SYSTEM = new Map<string, SystemId>(
  (Object.entries(SYSTEM_PREFIX) as [SystemId, string][]).map(([id, p]) => [p, id]),
);

export function prefixOf(type: string): string {
  const dot = type.indexOf('.');
  return dot > 0 ? type.slice(0, dot) : '';
}

export function createRegistry(list: readonly AnySimSystem[]): Registry {
  const byId = new Map<SystemId, AnySimSystem>();
  for (const s of list) {
    if (!SYSTEM_ORDER.includes(s.id)) throw new Error(`registry: unknown system id '${s.id}'`);
    if (byId.has(s.id)) throw new Error(`registry: system '${s.id}' registered twice`);
    byId.set(s.id, s);
  }
  const systems = SYSTEM_ORDER.filter((id) => byId.has(id)).map((id) => byId.get(id)!);

  return {
    systems,
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    byPrefix(prefix) {
      const id = PREFIX_TO_SYSTEM.get(prefix);
      return id ? byId.get(id) : undefined;
    },
    route(ctx, cmd) {
      const prefix = prefixOf(cmd.type);
      const id = PREFIX_TO_SYSTEM.get(prefix);
      if (!id) return { ok: false, reason: 'err.command.unknownPrefix', params: { type: cmd.type } };
      const sys = byId.get(id);
      if (!sys) return { ok: false, reason: 'err.command.systemMissing', params: { type: cmd.type, system: id } };
      if (!sys.handle) return { ok: false, reason: 'err.command.unknown', params: { type: cmd.type } };
      return sys.handle(ctx, cmd) ?? { ok: false, reason: 'err.command.unknown', params: { type: cmd.type } };
    },
  };
}
