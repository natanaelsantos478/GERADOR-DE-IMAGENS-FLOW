/** Tactical camera: field framing, comfortable free camera kept above the real terrain, and the stable `focus()` helper. */
import * as Cesium from 'cesium';
import { clamp } from '../units/common';

export type FocusTarget = { ent: number } | { squad: number } | { x: number; y: number };
export interface FocusOpts { range?: number; pitchDeg?: number; headingDeg?: number; durationS?: number }

export interface TacCameraDeps {
  viewer: Cesium.Viewer;
  /** Smoothed terrain height (m) at battle coordinates. */
  hAt(x: number, y: number): number;
  /** Battle metres -> lon/lat. */
  ll(x: number, y: number): [number, number];
  resolve(t: FocusTarget): { x: number; y: number } | null;
}

export const FIELD_RANGE = 10500;
const MIN_CLEAR = 38; // metres above terrain (a vehicle seen at ~35 px is drawn exaggerated: the camera must stay out of the models)
export const MIN_ZOOM = 45; // metres from the orbit target / min range of focus()

/** Takes over the camera controller for the battle; returns focus/frame and a disposer that restores the globe's limits. */
export function createTacCamera(d: TacCameraDeps) {
  const { viewer } = d, cam = viewer.camera, ctl = viewer.scene.screenSpaceCameraController;
  const saved = { min: ctl.minimumZoomDistance, max: ctl.maximumZoomDistance, col: ctl.enableCollisionDetection };
  ctl.minimumZoomDistance = MIN_ZOOM;
  ctl.maximumZoomDistance = 22_000;
  ctl.enableCollisionDetection = true;
  const cg = new Cesium.Cartographic();
  // Never let the camera sink under the real terrain (the globe's own collision test only knows loaded tiles).
  const guard = () => {
    const p = cam.positionCartographic;
    if (!p || !Number.isFinite(p.height)) return;
    const gh = viewer.scene.globe.getHeight(Cesium.Cartographic.fromRadians(p.longitude, p.latitude, 0, cg));
    if (gh === undefined || !Number.isFinite(gh)) return;
    if (p.height < gh + MIN_CLEAR) cam.setView({ destination: Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, gh + MIN_CLEAR), orientation: { heading: cam.heading, pitch: cam.pitch, roll: 0 } });
  };
  viewer.scene.postRender.addEventListener(guard);

  function focus(t: FocusTarget, o: FocusOpts = {}) {
    const p = d.resolve(t);
    if (!p) return false;
    const [lon, lat] = d.ll(p.x, p.y);
    const range = clamp(o.range ?? FIELD_RANGE, MIN_ZOOM, 20_000);
    const target = Cesium.Cartesian3.fromDegrees(lon, lat, d.hAt(p.x, p.y) + 2);
    const offset = new Cesium.HeadingPitchRange(Cesium.Math.toRadians(o.headingDeg ?? Cesium.Math.toDegrees(cam.heading)), Cesium.Math.toRadians(o.pitchDeg ?? -50), range);
    cam.cancelFlight();
    if ((o.durationS ?? 1.4) <= 0) {
      cam.lookAt(target, offset);
      cam.lookAtTransform(Cesium.Matrix4.IDENTITY); // hand the camera back to the free controller
    } else {
      cam.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), { offset, duration: o.durationS ?? 1.4 });
    }
    viewer.scene.requestRender();
    return true;
  }
  /** Both sides in view: ~8x8 km field, tilted. */
  const frameField = (durationS = 2.2) => focus({ x: 0, y: 0 }, { range: FIELD_RANGE, pitchDeg: -50, headingDeg: 0, durationS });

  return {
    focus, frameField,
    destroy() {
      viewer.scene.postRender.removeEventListener(guard);
      ctl.minimumZoomDistance = saved.min; ctl.maximumZoomDistance = saved.max; ctl.enableCollisionDetection = saved.col;
    },
  };
}
