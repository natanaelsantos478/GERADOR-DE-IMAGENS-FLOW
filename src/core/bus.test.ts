import { describe, expect, it } from 'vitest';
import { createBus } from './bus';
import type { GameEvent } from './contracts';

describe('bus', () => {
  it('delivers by type, prefix and any, in subscription order', () => {
    const bus = createBus();
    const log: string[] = [];
    bus.on('time.day', (e) => log.push(`day:${e.hours}`));
    bus.onPrefix('time', (e) => log.push(`prefix:${e.type}`));
    bus.onAny((e) => log.push(`any:${e.type}`));
    bus.emit({ type: 'time.day', hours: 24 });
    bus.emit({ type: 'mil.custom', x: 1 } as GameEvent);
    expect(log).toEqual(['day:24', 'prefix:time.day', 'any:time.day', 'any:mil.custom']);
  });

  it('unsubscribes, also from inside a handler', () => {
    const bus = createBus();
    let a = 0, b = 0;
    const offA = bus.on('time.week', () => {
      a++;
      offA();
    });
    bus.on('time.week', () => b++);
    bus.emit({ type: 'time.week', hours: 0 });
    bus.emit({ type: 'time.week', hours: 0 });
    expect([a, b]).toEqual([1, 2]);
    bus.clear();
    bus.emit({ type: 'time.week', hours: 0 });
    expect(b).toBe(2);
  });

  it('supports re-entrant emits', () => {
    const bus = createBus();
    const log: string[] = [];
    bus.on('time.day', () => {
      log.push('day');
      bus.emit({ type: 'time.week', hours: 0 });
    });
    bus.on('time.week', () => log.push('week'));
    bus.emit({ type: 'time.day', hours: 0 });
    expect(log).toEqual(['day', 'week']);
  });
});
