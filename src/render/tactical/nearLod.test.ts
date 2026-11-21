import { describe, expect, it } from 'vitest';
import { NEAR_BUDGET, RIG_GROUPS, animPhase, chooseAnimated, hurryOrder, nearModelFor, newRig, planLod, recoilAt, selectLod, soldierRole, stepRig, flashOn } from './nearLod';

describe('selectLod: hysteresis', () => {
  it('enters near under the range and leaves it only past range * 1.2', () => {
    expect(selectLod(149, 'far', 150)).toBe('near');
    expect(selectLod(151, 'far', 150)).toBe('far');
    expect(selectLod(170, 'near', 150)).toBe('near'); // still inside the 20 % band
    expect(selectLod(181, 'near', 150)).toBe('far');
  });
  it('a camera hovering at the limit does not flicker', () => {
    let l: 'near' | 'far' = 'far';
    const seen: string[] = [];
    for (const d of [155, 149, 152, 148, 160, 151, 149, 175, 179]) { l = selectLod(d, l, 150); seen.push(l); }
    expect(seen.filter((v, i) => i && v !== seen[i - 1]).length).toBeLessThanOrEqual(1);
  });
  it('range 0 disables the near level; the range is configurable', () => {
    expect(selectLod(5, undefined, 0)).toBe('far');
    expect(selectLod(5, undefined, 300)).toBe('near');
    expect(selectLod(250, undefined, 300)).toBe('near');
  });
});

describe('nearModelFor: far model -> detailed model', () => {
  const has = (id: string) => id !== 'near_sam';
  it('maps each class and variant', () => {
    expect(nearModelFor('mbt_t72', has)).toBe('near_mbt');
    expect(nearModelFor('mbt', has)).toBe('near_mbt');
    expect(nearModelFor('ifv_bradley', has)).toBe('near_ifv');
    expect(nearModelFor('apc_btr80', has)).toBe('near_apc');
    expect(nearModelFor('spg_pzh2000', has)).toBe('near_spg');
    expect(nearModelFor('truck', has)).toBe('near_truck');
    expect(nearModelFor('soldier_nato', has)).toBe('nsoldier');
    expect(nearModelFor('soldier_ru_f', has)).toBe('nsoldier_ru');
    expect(nearModelFor('soldier_desert', has)).toBe('nsoldier_des');
    expect(nearModelFor('soldier_urban_f', has)).toBe('nsoldier_urb');
  });
  it('null when the class has no near model or it is missing from the manifest', () => {
    expect(nearModelFor('mlrs_m270', has)).toBeNull();
    expect(nearModelFor('attack_heli', has)).toBeNull();
    expect(nearModelFor('sam_s300', has)).toBeNull(); // missing from the manifest
  });
});

describe('planLod: who is near', () => {
  const b = { ...NEAR_BUDGET.mid, swapsPerFrame: 99 };
  const u = (id: number, dist: number, over: Partial<{ near: boolean; soldier: boolean; can: boolean }> = {}) => ({ id, dist, near: false, soldier: false, can: true, ...over });
  it('units within the range go near, the others stay far', () => {
    const r = planLod([u(1, 40), u(2, 149), u(3, 300)], b, 150);
    expect([...r.entries()]).toEqual([[1, 'near'], [2, 'near']]);
  });
  it('units without a near model never change level', () => {
    expect(planLod([u(1, 10, { can: false })], b, 150).size).toBe(0);
  });
  it('a near unit past the hysteresis band goes back to far', () => {
    expect(planLod([u(1, 200, { near: true })], b, 150).get(1)).toBe('far');
    expect(planLod([u(1, 170, { near: true })], b, 150).size).toBe(0);
  });
  it('the budget per class keeps the nearest ones', () => {
    const cs = Array.from({ length: 10 }, (_, i) => u(i, 10 + i * 5, { soldier: true }));
    const r = planLod(cs, { ...b, maxSoldiers: 4 }, 150);
    expect([...r.keys()].sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
  });
  it('limits the swaps per call (a camera jump does not stall the frame) nearest first', () => {
    const cs = Array.from({ length: 8 }, (_, i) => u(i, 20 + i));
    const r = planLod(cs, { ...b, swapsPerFrame: 3 }, 150);
    expect([...r.keys()]).toEqual([0, 1, 2]);
  });
  it('the low profiles use a smaller radius', () => {
    const near = (q: keyof typeof NEAR_BUDGET) => planLod([u(1, 100)], NEAR_BUDGET[q], 150 * NEAR_BUDGET[q].rangeScale).size;
    expect(near('high')).toBe(1);
    expect(near('mobile')).toBe(0);
  });
});

describe('chooseAnimated: skeleton cap', () => {
  it('keeps the nearest `max` animated, deterministic on ties', () => {
    const c = [{ id: 5, dist: 30 }, { id: 2, dist: 10 }, { id: 9, dist: 10 }, { id: 1, dist: 80 }];
    expect([...chooseAnimated(c, 2)].sort()).toEqual([2, 9]);
    expect(chooseAnimated(c, 0).size).toBe(0);
    expect(chooseAnimated(c, 10).size).toBe(4);
  });
  it('150 of 400 soldiers animate', () => {
    const c = Array.from({ length: 400 }, (_, i) => ({ id: i, dist: (i * 37) % 400 }));
    const k = chooseAnimated(c, 150);
    expect(k.size).toBe(150);
    const worst = Math.max(...c.filter((q) => k.has(q.id)).map((q) => q.dist));
    expect(c.filter((q) => !k.has(q.id)).every((q) => q.dist >= worst)).toBe(true);
  });
});

describe('soldierRole: simulation state -> animation', () => {
  const base = { alive: true, moving: false, hurry: false, firing: false, cover: false };
  it('maps every state', () => {
    expect(soldierRole({ ...base, alive: false })).toBe('death');
    expect(soldierRole(base)).toBe('idle');
    expect(soldierRole({ ...base, moving: true })).toBe('walk');
    expect(soldierRole({ ...base, moving: true, hurry: true })).toBe('run');
    expect(soldierRole({ ...base, firing: true })).toBe('shoot');
    expect(soldierRole({ ...base, firing: true, moving: true })).toBe('walkShoot');
    expect(soldierRole({ ...base, firing: true, moving: true, hurry: true })).toBe('runShoot');
    expect(soldierRole({ ...base, cover: true })).toBe('crouch');
  });
  it('dead beats everything; firing beats cover (pops up to shoot)', () => {
    expect(soldierRole({ alive: false, moving: true, hurry: true, firing: true, cover: true })).toBe('death');
    expect(soldierRole({ ...base, cover: true, firing: true })).toBe('shoot');
  });
  it('order -> pace', () => {
    expect(hurryOrder('move', false)).toBe(true);
    expect(hurryOrder('retreat', false)).toBe(true);
    expect(hurryOrder('amove', false)).toBe(false);
    expect(hurryOrder('hold', true)).toBe(true); // routed: runs
  });
});

describe('animPhase: no two units in step', () => {
  it('is deterministic and spread', () => {
    expect(animPhase(7)).toEqual(animPhase(7));
    const ph = new Set(Array.from({ length: 50 }, (_, i) => animPhase(i).phase.toFixed(2)));
    expect(ph.size).toBeGreaterThan(40);
    for (let i = 0; i < 100; i++) { const a = animPhase(i); expect(a.phase).toBeGreaterThanOrEqual(0); expect(a.phase).toBeLessThan(2); expect(a.speed).toBeGreaterThanOrEqual(0.9); expect(a.speed).toBeLessThanOrEqual(1.1); }
  });
});

describe('vehicle rig', () => {
  const inp = (o: Partial<Parameters<typeof stepRig>[1]> = {}) => ({ group: 'mbt', dt: 0.1, hull: 0, shotAge: 99, idleS: 0, speed: 0, yawRate: 0, wheelR: 0.44, ...o });
  it('turret turns toward the target at its slew rate, the short way', () => {
    let s = newRig();
    s = stepRig(s, inp({ bearing: Math.PI / 2, range: 800 }));
    expect(s.turret).toBeCloseTo((RIG_GROUPS.mbt.slewDegS * Math.PI) / 180 * 0.1, 5); // 4 deg in 0.1 s
    for (let i = 0; i < 100; i++) s = stepRig(s, inp({ bearing: Math.PI / 2, range: 800 }));
    expect(s.turret).toBeCloseTo(Math.PI / 2, 5); // arrives and holds
    // target behind-left: shortest way is counter-clockwise
    let t = newRig();
    t = stepRig(t, inp({ bearing: (-170 * Math.PI) / 180, range: 500 }));
    expect(t.turret).toBeLessThan(0);
  });
  it('the angle is relative to the hull (hull turning keeps the gun on target)', () => {
    let s = newRig();
    for (let i = 0; i < 200; i++) s = stepRig(s, inp({ bearing: Math.PI / 2, range: 800, hull: 0 }));
    for (let i = 0; i < 200; i++) s = stepRig(s, inp({ bearing: Math.PI / 2, range: 800, hull: Math.PI / 4 }));
    expect(s.turret).toBeCloseTo(Math.PI / 4, 4);
  });
  it('turret goes back to the front when it has no target for a while; vehicles without a turret never turn it', () => {
    let s = { ...newRig(), turret: 1 };
    for (let i = 0; i < 300; i++) s = stepRig(s, inp({ idleS: 6 }));
    expect(Math.abs(s.turret)).toBeLessThan(1e-6);
    expect(stepRig(newRig(), inp({ group: 'truck', bearing: 2, range: 100 })).turret).toBe(0);
  });
  it('gun elevation grows with range and is larger for the SPG than for the tank', () => {
    const run = (group: string, range: number) => { let s = newRig(); for (let i = 0; i < 100; i++) s = stepRig(s, inp({ group, bearing: 0.2, range })); return s.elev; };
    expect(run('mbt', 1800)).toBeGreaterThan(run('mbt', 200));
    expect(run('spg', 7000)).toBeGreaterThan(run('mbt', 1800) * 3);
    expect(run('spg', 7500)).toBeLessThanOrEqual(RIG_GROUPS.spg.maxElevRad + 1e-9);
  });
  it('wheels roll with the distance and the tread scrolls at the speed; reversing reverses both', () => {
    let s = newRig();
    for (let i = 0; i < 10; i++) s = stepRig(s, inp({ speed: 4.4 })); // 4.4 u/s for 1 s on r = 0.44 -> 10 rad
    expect(s.wheel).toBeCloseTo(10, 5);
    expect(s.scroll).toBeCloseTo(4.4, 5);
    for (let i = 0; i < 10; i++) s = stepRig(s, inp({ speed: -4.4 }));
    expect(s.wheel).toBeCloseTo(0, 5);
  });
  it('recoil: fast kick back, slow return to zero; flash only at the start', () => {
    expect(recoilAt(0, 0.4, 0.5)).toBe(0);
    expect(recoilAt(0.06, 0.4, 0.5)).toBeCloseTo(0.4, 5);
    expect(recoilAt(0.3, 0.4, 0.5)).toBeLessThan(0.4);
    expect(recoilAt(0.3, 0.4, 0.5)).toBeGreaterThan(0);
    expect(recoilAt(2, 0.4, 0.5)).toBe(0);
    expect(recoilAt(-1, 0.4, 0.5)).toBe(0);
    expect(flashOn(0.02)).toBe(true);
    expect(flashOn(0.2)).toBe(false);
  });
  it('steering follows the yaw rate within limits', () => {
    let s = newRig();
    for (let i = 0; i < 50; i++) s = stepRig(s, inp({ group: 'apc', yawRate: 2 }));
    expect(s.steer).toBeCloseTo(0.5, 2);
  });
});
