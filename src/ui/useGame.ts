/** Bridges React to the live Game: 5 Hz selectors, command dispatch with translated error toasts. */
import { useEffect, useRef, useState } from 'react';
import type { Command, CommandResult, Ctx, KnownCommand } from '../core/contracts';
import type { Game } from '../core/game';
import { appHost, useAppHost } from '../app/host';
import { playSound } from '../audio';
import { t } from './i18n';
import { ui } from './store';

const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
/** Forces every `useGame` to re-evaluate now (called after commands). */
export const bump = () => subs.forEach((f) => f());
function subscribe(f: () => void) {
  subs.add(f);
  timer ??= setInterval(bump, 200);
  return () => {
    subs.delete(f);
    if (!subs.size && timer) { clearInterval(timer); timer = null; }
  };
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** Re-evaluates `sel` at ~5 Hz; re-renders only when the (structurally compared) result changes. */
export function useGame<T>(sel: (game: Game, ctx: Ctx) => T): T {
  const version = useAppHost((s) => s.gameVersion);
  const selRef = useRef(sel);
  selRef.current = sel;
  const run = (): T => {
    const g = appHost.getState().game;
    return (g ? selRef.current(g, g.ctx) : undefined) as T;
  };
  const [val, setVal] = useState<T>(run);
  useEffect(() => {
    const evalNow = () => setVal((prev) => { const n = run(); return same(prev, n) ? prev : n; });
    evalNow();
    return subscribe(evalNow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return val;
}

export const theGame = () => appHost.getState().game as Game;
export const theWorld = () => appHost.getState().world!;
export const me = () => theGame().state.meta.playerCountryId;

/** Dispatches as the player; failures become a toast with the translated `reason`. */
export function dispatch(cmd: Command | KnownCommand): CommandResult {
  const r = theGame().dispatch(cmd);
  if (!r.ok) {
    ui().toast(t(r.reason, r.params), 'error');
    playSound('ui_error');
  }
  bump();
  return r;
}
export const countryName = (id: string | null | undefined) => (id ? appHost.getState().world?.countryById.get(id)?.namePt ?? id : '—');
