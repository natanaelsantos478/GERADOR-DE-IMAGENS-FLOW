/** Particle effects: explosions, persistent fire/smoke, nuclear mushroom. Everything is pooled by count and removed by timer. */
import * as Cesium from 'cesium';
import type { LonLat } from '../../core/contracts';
import type { Globe } from '../globe/types';
import { clamp, renderLock, spriteCanvas } from './common';

const C = Cesium.Color;
const V = (x: number, y: number) => new Cesium.Cartesian2(x, y);

/** cannon: tank gun / auto: autocannon or heavy MG / rifle: small arms / artillery: indirect fire (no tracer, lobbed shell). */
export type ShotKind = 'cannon' | 'auto' | 'rifle' | 'artillery';
export interface FxApi {
  explosion(pos: LonLat, big?: boolean): void;
  nuke(pos: LonLat): void;
  /** One shot at real scale (close-up battles): muzzle flash, tracer and impact. Positions are lon/lat/height (m). */
  shot(from: [number, number, number], to: [number, number, number], kind: ShotKind): void;
  /** Keeps a fire+smoke column at `key`; call `stopFire` to remove. */
  fire(key: string, pos: LonLat, height?: number): void;
  stopFire(key: string): void;
  fireKeys(): string[];
  active(): number;
  destroy(): void;
}

export function createFx(globe: Globe): FxApi {
  const scene = globe.viewer.scene;
  const smoke = spriteCanvas([90, 90, 90], 0.9);
  const flame = spriteCanvas([255, 170, 60], 1);
  const fires = new Map<string, Cesium.ParticleSystem>();
  const timed = new Set<Cesium.ParticleSystem>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const enu = (p: LonLat, h = 0) => Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(p[0], p[1], h));
  const lock = () => renderLock(globe, 'fx', timed.size > 0 || fires.size > 0);
  const add = (opts: ConstructorParameters<typeof Cesium.ParticleSystem>[0], ttlMs: number) => {
    const ps = scene.primitives.add(new Cesium.ParticleSystem(opts)) as Cesium.ParticleSystem;
    timed.add(ps);
    lock();
    const t = setTimeout(() => { timers.delete(t); timed.delete(ps); scene.primitives.remove(ps); lock(); globe.requestRender(); }, ttlMs);
    timers.add(t);
    return ps;
  };
  /** Metres per on-screen pixel-ish scale so effects stay readable from far away. */
  const unit = () => clamp(globe.cameraHeight() / 120, 40, 40_000);

  const tracers = scene.primitives.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection;
  const burst = (p: [number, number, number], size: number, n: number, life: number, color: string) => add({
    image: flame, startColor: C.fromCssColorString(color), endColor: C.fromCssColorString('#3a3a3a').withAlpha(0),
    startScale: 0.5, endScale: 1.8, minimumParticleLife: life * 0.5, maximumParticleLife: life, minimumSpeed: size * 0.3, maximumSpeed: size * 1.2,
    imageSize: V(size, size), sizeInMeters: true, emissionRate: 0, bursts: [new Cesium.ParticleBurst({ time: 0, minimum: n, maximum: n + 3 })],
    lifetime: life, loop: false, emitter: new Cesium.SphereEmitter(size * 0.2), modelMatrix: enu([p[0], p[1]], p[2]),
  }, life * 1000 + 400);

  return {
    shot(from, to, kind) {
      if (timed.size > 40) return;
      const big = kind === 'cannon' || kind === 'artillery';
      const S = { cannon: [3, 0.5, 7, 1.6, 220], auto: [1.4, 0.2, 2.5, 0.6, 160], rifle: [0.8, 0.15, 1.2, 0.4, 120], artillery: [5, 0.8, 12, 2.4, 1400] }[kind];
      burst(from, S[0], big ? 8 : 3, S[1], '#fff2b0');
      const line = kind === 'artillery' ? null : tracers.add({
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([...from, ...to]), width: kind === 'cannon' ? 3 : kind === 'auto' ? 2 : 1.5,
        material: Cesium.Material.fromType('Color', { color: C.fromCssColorString(kind === 'rifle' ? '#ffe9a8' : '#ffd27a').withAlpha(0.9) }),
      });
      const t1 = setTimeout(() => {
        timers.delete(t1); if (line) tracers.remove(line);
        burst(to, S[2], big ? 16 : 4, S[3], big ? '#ffb347' : '#d8c8a0');
        globe.requestRender();
      }, S[4]);
      timers.add(t1);
      globe.requestRender();
    },
    explosion(pos, big = false) {
      if (timed.size > 24) return;
      const u = unit() * (big ? 1.6 : 1);
      add({
        image: flame, startColor: C.fromCssColorString('#ffd27a'), endColor: C.fromCssColorString('#3a3a3a').withAlpha(0),
        startScale: 0.6, endScale: 2.4, minimumParticleLife: 0.8, maximumParticleLife: 2.6, minimumSpeed: u * 0.1, maximumSpeed: u * 0.7,
        imageSize: V(u * 1.2, u * 1.2), sizeInMeters: true, emissionRate: 0, bursts: [new Cesium.ParticleBurst({ time: 0, minimum: 14, maximum: 22 })],
        lifetime: 3, loop: false, emitter: new Cesium.SphereEmitter(u * 0.15), modelMatrix: enu(pos),
      }, 5000);
      add({
        image: smoke, startColor: C.fromCssColorString('#555').withAlpha(0.7), endColor: C.fromCssColorString('#888').withAlpha(0),
        startScale: 1, endScale: 3, minimumParticleLife: 3, maximumParticleLife: 7, minimumSpeed: u * 0.05, maximumSpeed: u * 0.2,
        imageSize: V(u * 1.4, u * 1.4), sizeInMeters: true, emissionRate: 0, bursts: [new Cesium.ParticleBurst({ time: 0.2, minimum: 6, maximum: 10 })],
        lifetime: 4, loop: false, emitter: new Cesium.ConeEmitter(Cesium.Math.toRadians(25)), modelMatrix: enu(pos),
      }, 9000);
      globe.requestRender();
    },
    nuke(pos) {
      const k = clamp(globe.cameraHeight() / 200_000, 0.2, 6);
      const r = 2500 * k;
      add({
        image: flame, startColor: C.WHITE, endColor: C.fromCssColorString('#ff7a1a').withAlpha(0), startScale: 1, endScale: 3,
        minimumParticleLife: 1, maximumParticleLife: 3, minimumSpeed: r * 0.3, maximumSpeed: r, imageSize: V(r * 2, r * 2), sizeInMeters: true,
        emissionRate: 0, bursts: [new Cesium.ParticleBurst({ time: 0, minimum: 30, maximum: 40 })], lifetime: 2, loop: false,
        emitter: new Cesium.SphereEmitter(r * 0.3), modelMatrix: enu(pos),
      }, 6000);
      // stem
      add({
        image: smoke, startColor: C.fromCssColorString('#6a5a50').withAlpha(0.85), endColor: C.fromCssColorString('#3a3a3a').withAlpha(0.2),
        startScale: 1, endScale: 2, minimumParticleLife: 14, maximumParticleLife: 22, minimumSpeed: r * 0.25, maximumSpeed: r * 0.35,
        imageSize: V(r * 0.9, r * 0.9), sizeInMeters: true, emissionRate: 30, lifetime: 30, loop: false, emitter: new Cesium.ConeEmitter(Cesium.Math.toRadians(5)), modelMatrix: enu(pos),
      }, 60_000);
      // cap
      add({
        image: smoke, startColor: C.fromCssColorString('#ff9a3c').withAlpha(0.9), endColor: C.fromCssColorString('#4a4038').withAlpha(0.25),
        startScale: 1, endScale: 1.8, minimumParticleLife: 14, maximumParticleLife: 24, minimumSpeed: r * 0.04, maximumSpeed: r * 0.12,
        imageSize: V(r * 1.4, r * 1.4), sizeInMeters: true, emissionRate: 45, lifetime: 28, loop: false, emitter: new Cesium.SphereEmitter(r * 0.9),
        modelMatrix: enu(pos, r * 4.5), updateCallback: undefined,
      }, 60_000);
      globe.requestRender();
    },
    fire(key, pos, height = 0) {
      if (fires.has(key)) return;
      const u = clamp(globe.cameraHeight() / 400, 25, 600);
      const ps = scene.primitives.add(new Cesium.ParticleSystem({
        image: smoke, startColor: C.fromCssColorString('#ff8a2a').withAlpha(0.85), endColor: C.fromCssColorString('#2b2b2b').withAlpha(0),
        startScale: 0.7, endScale: 2.6, minimumParticleLife: 2.5, maximumParticleLife: 6, minimumSpeed: u * 0.15, maximumSpeed: u * 0.4,
        imageSize: V(u, u), sizeInMeters: true, emissionRate: 7, lifetime: 1e9, loop: true,
        emitter: new Cesium.ConeEmitter(Cesium.Math.toRadians(12)), modelMatrix: enu(pos, height),
      })) as Cesium.ParticleSystem;
      fires.set(key, ps);
      lock();
    },
    stopFire(key) {
      const ps = fires.get(key);
      if (!ps) return;
      scene.primitives.remove(ps);
      fires.delete(key);
      lock();
    },
    fireKeys: () => [...fires.keys()],
    active: () => timed.size + fires.size,
    destroy() {
      timers.forEach(clearTimeout);
      timed.forEach((p) => scene.primitives.remove(p));
      fires.forEach((p) => scene.primitives.remove(p));
      timed.clear(); fires.clear();
      scene.primitives.remove(tracers);
      lock();
    },
  };
}
