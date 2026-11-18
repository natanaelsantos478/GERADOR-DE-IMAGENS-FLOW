import { describe, expect, it } from 'vitest';
import { clusterScreen, type ClusterItem } from './cluster';

const it1 = (x: number, y: number, side = 'a', kind = 'tank', weight = 1): ClusterItem<number> => ({ x, y, side, kind, weight, ref: Math.round(x * 7 + y) });
describe('clusterScreen (supercluster in screen space)', () => {
  it('groups icons that overlap on screen, by side, with the predominant kind', () => {
    const items = [it1(100, 100), it1(110, 105, 'a', 'ship', 3), it1(120, 98, 'a', 'ship', 2), it1(500, 400), it1(105, 102, 'b')];
    const r = clusterScreen(items, 46, 2);
    expect(r.groups.length).toBe(1);
    expect(r.groups[0].count).toBe(3);
    expect(r.groups[0].kind).toBe('ship');
    expect(r.groups[0].side).toBe('a');
    expect(r.singles.length).toBe(2); // the far one and the other side's icon stay single
  });
  it('dissolves when the icons spread apart (zoom in) and never loses one', () => {
    const close = [0, 1, 2, 3, 4, 5].map((i) => it1(300 + i * 6, 200));
    const far = [0, 1, 2, 3, 4, 5].map((i) => it1(100 + i * 120, 200));
    const a = clusterScreen(close), b = clusterScreen(far);
    expect(a.groups.length).toBe(1); expect(a.groups[0].count).toBe(6);
    expect(b.groups.length).toBe(0); expect(b.singles.length).toBe(6);
  });
  it('respects the minimum group size', () => {
    const r = clusterScreen([it1(10, 10), it1(14, 12)], 46, 3);
    expect(r.groups.length).toBe(0); expect(r.singles.length).toBe(2);
  });
});
