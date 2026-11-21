/**
 * Cesium side of the close-range vehicle animation: moves the named glTF nodes of a near model (turret yaw, gun elevation + recoil,
 * wheel spin, steering) from the pure state of `nearLod.ts`, and scrolls the tread of tracked hulls with a small custom shader
 * (track triangles carry vertex alpha 0.5 = mask, see tools/models/near-build.mjs).
 */
import * as Cesium from 'cesium';
import type { NearRig } from '../units/common';
import type { RigState } from './nearLod';

interface Rt {
  turret?: Cesium.ModelNode; gun?: Cesium.ModelNode; recoil?: Cesium.ModelNode; wheels: Cesium.ModelNode[]; steer: Cesium.ModelNode[];
  o: Map<Cesium.ModelNode, Cesium.Matrix4>; shader?: Cesium.CustomShader;
}
const rigs = new WeakMap<Cesium.Model, Rt | null>();
const RX = new Cesium.Matrix4(), RY = new Cesium.Matrix4(), T = new Cesium.Matrix4(), M = new Cesium.Matrix4(), R3 = new Cesium.Matrix3(), V = new Cesium.Cartesian3();
const rotX = (a: number, out: Cesium.Matrix4) => Cesium.Matrix4.fromRotation(Cesium.Matrix3.fromRotationX(a, R3), out);
const rotY = (a: number, out: Cesium.Matrix4) => Cesium.Matrix4.fromRotation(Cesium.Matrix3.fromRotationY(a, R3), out);

/** Scrolling-tread overlay: darkens the gaps of a cleat pattern that runs along the hull; the top run moves forward, the ground run backward. */
const TREAD_FS = `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec4 c = fsInput.attributes.color_0;
  if (c.a < 0.75) {
    float top = fsInput.attributes.positionMC.y > u_mid ? 1.0 : -1.0;
    float k = fract((fsInput.attributes.positionMC.z + top * u_scroll) / 0.17);
    float cleat = smoothstep(0.30, 0.45, k) * (1.0 - smoothstep(0.80, 0.95, k));
    material.diffuse *= mix(0.2, 1.7, cleat);
  }
}`;

function bind(m: Cesium.Model, rig: NearRig): Rt | null {
  if (!m.ready) return null;
  const rt: Rt = { wheels: [], steer: [], o: new Map() };
  const get = (n?: string) => {
    if (!n) return undefined;
    const node = m.getNode(n);
    if (node) rt.o.set(node, Cesium.Matrix4.clone(node.originalMatrix));
    return node;
  };
  rt.turret = get(rig.turret); rt.gun = get(rig.elevate ?? rig.gun); rt.recoil = get(rig.recoil);
  rt.wheels = (rig.wheels ?? []).map(get).filter((n): n is Cesium.ModelNode => !!n);
  rt.steer = (rig.steer ?? []).map(get).filter((n): n is Cesium.ModelNode => !!n);
  if (rig.track) {
    rt.shader = new Cesium.CustomShader({
      uniforms: { u_scroll: { type: Cesium.UniformType.FLOAT, value: 0 }, u_mid: { type: Cesium.UniformType.FLOAT, value: rig.track.midY } },
      fragmentShaderText: TREAD_FS,
    });
    m.customShader = rt.shader;
  }
  return rt;
}
/** Rig of a loaded model (cached); null while the glTF is still loading or when the model has no rig. */
export function rigOf(m: Cesium.Model | null, rig: NearRig | undefined): Rt | null {
  if (!m || !rig) return null;
  let rt = rigs.get(m);
  if (rt === undefined) { rt = bind(m, rig); if (rt) rigs.set(m, rt); }
  return rt ?? null;
}
const setNode = (rt: Rt, n: Cesium.ModelNode, f: (o: Cesium.Matrix4, out: Cesium.Matrix4) => Cesium.Matrix4) => { const o = rt.o.get(n); if (o) n.matrix = f(o, new Cesium.Matrix4()); };

/**
 * Applies the state to the nodes. `recoilM` is the barrel kick in model units (backward along the gun axis, +Z forward in the glTFs).
 * Turret angle is clockwise-positive seen from above; glTF +Y is up and +X is the vehicle's left, so the rotation about +Y is the negative.
 */
export function applyRig(rt: Rt, s: RigState, rig: NearRig, recoilM: number) {
  if (rt.turret) setNode(rt, rt.turret, (o, out) => Cesium.Matrix4.multiplyTransformation(o, rotY(-s.turret, RY), out));
  const same = rt.gun && rt.recoil && rt.gun === rt.recoil;
  if (rt.gun) setNode(rt, rt.gun, (o, out) => {
    Cesium.Matrix4.multiplyTransformation(o, rotX(-s.elev, RX), M);
    return same ? Cesium.Matrix4.multiplyTransformation(M, Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.fromElements(0, 0, -recoilM, V), T), out) : Cesium.Matrix4.clone(M, out);
  });
  if (rt.recoil && !same) setNode(rt, rt.recoil, (o, out) => Cesium.Matrix4.multiplyTransformation(o, Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.fromElements(0, 0, -recoilM, V), T), out));
  for (const w of rt.wheels) setNode(rt, w, (o, out) => Cesium.Matrix4.multiplyTransformation(o, rotX(s.wheel, RX), out));
  for (const n of rt.steer) setNode(rt, n, (o, out) => Cesium.Matrix4.multiplyTransformation(o, rotY(s.steer, RY), out));
  rt.shader?.setUniform('u_scroll', s.scroll);
}
