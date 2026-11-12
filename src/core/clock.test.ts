import { describe, expect, it } from 'vitest';
import { boundaryAt, dateToHours, forEachSubstep, formatDateIso, hoursToDate, SPEED_HOURS_PER_SECOND } from './clock';

describe('clock', () => {
  it('converts hours to dates from 2026-01-01', () => {
    expect(hoursToDate(0)).toMatchObject({ year: 2026, month: 1, day: 1, hour: 0, weekday: 4, dayIndex: 0 });
    expect(hoursToDate(24 * 31 + 5)).toMatchObject({ year: 2026, month: 2, day: 1, hour: 5 });
    expect(hoursToDate(dateToHours(2027, 3, 15, 12))).toMatchObject({ year: 2027, month: 3, day: 15, hour: 12 });
    expect(dateToHours(2027, 1, 1)).toBe(365 * 24);
    expect(formatDateIso(1.5)).toBe('2026-01-01 01:30');
  });

  it('has the speed table of the plan', () => {
    expect(SPEED_HOURS_PER_SECOND).toEqual([0, 1, 4, 12, 24, 96]);
  });

  it('detects day/week/month/year boundaries', () => {
    expect(boundaryAt(5)).toEqual({ day: false, week: false, month: false, year: false });
    expect(boundaryAt(24)).toMatchObject({ day: true, week: false, month: false });
    expect(boundaryAt(dateToHours(2026, 1, 5))).toMatchObject({ day: true, week: true }); // Monday
    expect(boundaryAt(dateToHours(2026, 2, 1))).toMatchObject({ day: true, month: true, year: false });
    expect(boundaryAt(dateToHours(2027, 1, 1))).toMatchObject({ month: true, year: true });
  });

  it('substeps never exceed 1h nor cross an hour, and land exactly on hours', () => {
    const steps: [number, number, number | null][] = [];
    const end = forEachSubstep(0.25, 3.5, (dt, h, landed) => steps.push([dt, h, landed]));
    expect(end).toBe(3.5);
    expect(steps.map((s) => s[2])).toEqual([1, 2, 3, null]);
    expect(steps[0][0]).toBeCloseTo(0.75);
    for (const [dt] of steps) expect(dt).toBeLessThanOrEqual(1);
    const total = steps.reduce((a, s) => a + s[0], 0);
    expect(total).toBeCloseTo(3.25);
  });

  it('accumulating tiny frames still lands exactly on integer hours', () => {
    let h = 0;
    const landed: number[] = [];
    for (let i = 0; i < 600; i++) h = forEachSubstep(h, h + 1 / 60, (_dt, _h, l) => l !== null && landed.push(l));
    expect(landed).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(h).toBeCloseTo(10, 9);
  });
});
