/**
 * Game clock: time is `hours` since 2026-01-01T00:00Z (UTC, no DST). Date conversion uses
 * `Date.UTC` arithmetic only (deterministic; never the wall clock).
 */
import type { Speed } from './contracts';

export const START_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
const HOUR_MS = 3_600_000;

/** Game hours per real second for each speed (PLANO §6); index 0 = stopped. */
export const SPEED_HOURS_PER_SECOND: readonly number[] = [0, 1, 4, 12, 24, 96];
export const MAX_SPEED: Speed = 5;
/** Longest simulation substep in game hours. */
export const MAX_SUBSTEP_HOURS = 1;
/** Clamp for a single real frame, so a background tab does not simulate weeks at once. */
export const MAX_REAL_DT_SECONDS = 0.25;

export interface GameDate {
  year: number;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Whole days since 2026-01-01. */
  dayIndex: number;
}

export function hoursToDate(hours: number): GameDate {
  const d = new Date(START_EPOCH_MS + Math.floor(hours * 60) * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
    dayIndex: Math.floor(hours / 24),
  };
}

/** Hours since the epoch for a UTC calendar date (month 1..12). */
export function dateToHours(year: number, month: number, day: number, hour = 0): number {
  return (Date.UTC(year, month - 1, day, hour) - START_EPOCH_MS) / HOUR_MS;
}

/** ISO-like `2026-01-01 00:00`. */
export function formatDateIso(hours: number): string {
  const g = hoursToDate(hours);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${g.year}-${p(g.month)}-${p(g.day)} ${p(g.hour)}:${p(g.minute)}`;
}

/** Localised date for the UI (e.g. `pt-BR` → `1 de jan. de 2026`). */
export function formatDate(hours: number, locale = 'pt-BR', withHour = false): string {
  const d = new Date(START_EPOCH_MS + Math.floor(hours * 60) * 60_000);
  return d.toLocaleString(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withHour ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export interface Boundary {
  day: boolean;
  week: boolean;
  month: boolean;
  year: boolean;
}

/** Calendar triggers when the clock lands exactly on integer hour `h`. */
export function boundaryAt(h: number): Boundary {
  if (h % 24 !== 0) return { day: false, week: false, month: false, year: false };
  const g = hoursToDate(h);
  return { day: true, week: g.weekday === 1, month: g.day === 1, year: g.day === 1 && g.month === 1 };
}

const EPS = 1e-9;

/**
 * Splits advancing the clock from `from` to `to` into substeps that never exceed
 * MAX_SUBSTEP_HOURS and never cross an integer hour. Calls `step(dt, landedOnHour)` for each:
 * `landedOnHour` is the integer hour reached exactly (snap target), or null.
 */
export function forEachSubstep(from: number, to: number, step: (dt: number, newHours: number, landedOnHour: number | null) => void): number {
  let h = from;
  while (to - h > EPS) {
    const nextHour = Math.floor(h + EPS) + 1;
    if (to >= nextHour - EPS) {
      const dt = nextHour - h;
      h = nextHour;
      step(dt, h, nextHour);
    } else {
      const dt = to - h;
      h = to;
      step(dt, h, null);
    }
  }
  return h;
}
