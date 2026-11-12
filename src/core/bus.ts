/**
 * Synchronous typed event bus. Events are transient (never saved): subscribe in `SimSystem.init`.
 * Handlers run in subscription order; emitting from a handler is allowed (depth-first).
 */
import type { EventMap, EventOf, EventType, GameEvent, KnownEvent } from './contracts';

export type Unsubscribe = () => void;
type Handler = (e: GameEvent) => void;

export interface EventBus {
  emit<T extends EventType>(e: EventOf<T>): void;
  emit(e: GameEvent): void;
  on<T extends EventType>(type: T, fn: (e: EventOf<T>) => void): Unsubscribe;
  on(type: GameEvent['type'], fn: (e: GameEvent) => void): Unsubscribe;
  /** All events whose FIRST segment is `prefix` (`'mil'` gets `mil.*`). */
  onPrefix(prefix: string, fn: (e: GameEvent | KnownEvent) => void): Unsubscribe;
  onAny(fn: (e: GameEvent | KnownEvent) => void): Unsubscribe;
  /** Removes every handler. */
  clear(): void;
}

export function createBus(): EventBus {
  const byType = new Map<string, Handler[]>();
  const byPrefix = new Map<string, Handler[]>();
  const any: Handler[] = [];

  const add = (list: Handler[], fn: Handler): Unsubscribe => {
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  };
  const listFor = (m: Map<string, Handler[]>, k: string) => {
    let l = m.get(k);
    if (!l) m.set(k, (l = []));
    return l;
  };
  const run = (list: Handler[] | undefined, e: GameEvent) => {
    if (!list || list.length === 0) return;
    // Copy so (un)subscribing inside a handler does not skip anyone.
    for (const fn of list.slice()) fn(e);
  };

  return {
    emit(e: GameEvent | EventMap[EventType]) {
      const ev = e as GameEvent;
      run(byType.get(ev.type), ev);
      const dot = ev.type.indexOf('.');
      if (dot > 0) run(byPrefix.get(ev.type.slice(0, dot)), ev);
      run(any, ev);
    },
    on(type: string, fn: (e: never) => void) {
      return add(listFor(byType, type), fn as Handler);
    },
    onPrefix(prefix, fn) {
      return add(listFor(byPrefix, prefix.replace(/\.$/, '')), fn as Handler);
    },
    onAny(fn) {
      return add(any, fn as Handler);
    },
    clear() {
      byType.clear();
      byPrefix.clear();
      any.length = 0;
    },
  } as EventBus;
}
