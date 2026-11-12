import { describe, expect, it } from 'vitest';
import { aStar, MinHeap } from './astar';
import { createRng } from './rng';

describe('MinHeap', () => {
  it('pops in key order', () => {
    const h = new MinHeap<string>();
    const r = createRng(1);
    const keys = Array.from({ length: 500 }, () => r.int(0, 1000));
    keys.forEach((k) => h.push(k, `v${k}`));
    const out: number[] = [];
    while (h.size) out.push(Number(h.pop()!.slice(1)));
    expect(out).toEqual([...keys].sort((a, b) => a - b));
    expect(h.pop()).toBeUndefined();
  });
});

describe('aStar', () => {
  // 20x20 grid with a wall at x=10 except a gap at y=19.
  const W = 20;
  const blocked = (x: number, y: number) => x === 10 && y !== 19;
  const grid = (goal: number) => ({
    neighbors(n: number, visit: (m: number, c: number) => void) {
      const x = n % W, y = Math.floor(n / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= W || blocked(nx, ny)) continue;
        visit(ny * W + nx, 1);
      }
    },
    heuristic: (n: number) => Math.abs((n % W) - (goal % W)) + Math.abs(Math.floor(n / W) - Math.floor(goal / W)),
    isGoal: (n: number) => n === goal,
  });

  it('finds the optimal path around a wall (typed and map bookkeeping agree)', () => {
    const start = 0, goal = 19;
    const a = aStar(grid(goal), start, { nodeCount: W * W })!;
    const b = aStar(grid(goal), start)!;
    expect(a.cost).toBe(19 + 19 + 19);
    expect(b.cost).toBe(a.cost);
    expect(a.path[0]).toBe(start);
    expect(a.path[a.path.length - 1]).toBe(goal);
    expect(a.path).toContain(19 * W + 10);
    for (let i = 1; i < a.path.length; i++) {
      const p = a.path[i - 1], q = a.path[i];
      expect(Math.abs((p % W) - (q % W)) + Math.abs(Math.floor(p / W) - Math.floor(q / W))).toBe(1);
    }
  });

  it('returns null when unreachable or over budget', () => {
    const g = grid(5);
    const walled = { ...g, neighbors: () => {} };
    expect(aStar(walled, 0)).toBeNull();
    expect(aStar(grid(399), 0, { maxExpanded: 10 })).toBeNull();
    expect(aStar(grid(399), 0, { maxCost: 5 })).toBeNull();
  });

  it('supports multiple starts', () => {
    const r = aStar(grid(26), [0, 24], { nodeCount: W * W })!;
    expect(r.path[0]).toBe(24);
    expect(r.cost).toBe(2);
  });
});
