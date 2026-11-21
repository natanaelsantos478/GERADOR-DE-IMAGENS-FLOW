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
  /** Half the side of the battle square (m). */
  half: number;
}

export const FIELD_RANGE = 7000;
/** Highest the camera may go above the field (m): the detailed view never shows the whole 10 km at full detail. */
export const MAX_HEIGHT = 4500;
/** How far past the field edge (m) the camera may drift before it is pulled back. */
const EDGE = 600;
const MIN_CLEAR = 2; // metres above terrain: the detailed view goes down to eye level (grass, soldiers up close)
export const MIN_ZOOM = 3; // metres from the orbit target / min range of focus()

/** Takes over the camera controller for the battle; returns focus/frame and a disposer that restores the globe's limits. */
export function createTacCamera(d: TacCameraDeps) {
  const { viewer } = d, cam = viewer.camera, ctl = viewer.scene.screenSpaceCameraController;
  const saved = { min: ctl.minimumZoomDistance, max: ctl.maximumZoomDistance, col: ctl.enableCollisionDetection };
  ctl.minimumZoomDistance = MIN_ZOOM;
  ctl.maximumZoomDistance = MAX_HEIGHT * 1.6;
  ctl.enableCollisionDetection = true;
  const cg = new Cesium.Cartographic();
  // Never let the camera sink under the real terrain (the globe's own collision test only knows loaded tiles).
  const guard = () => {
    const p = cam.positionCartographic;
    if (!p || !Number.isFinite(p.height)) return;
    // terrain not loaded there (camera thrown far away): the field's own height stands in
    let gh = viewer.scene.globe.getHeight(Cesium.Cartographic.fromRadians(p.longitude, p.latitude, 0, cg));
    if (gh === undefined || !Number.isFinite(gh)) gh = d.hAt(0, 0);
    // stay inside the battle square (the detailed view does not go back to the globe) and under MAX_HEIGHT
    const [lon0, lat0] = d.ll(0, 0), [lon1, lat1] = d.ll(1000, 1000);
    const kx = 1000 / (lon1 - lon0), ky = 1000 / (lat1 - lat0), lim = d.half + EDGE;
    const x = (Cesium.Math.toDegrees(p.longitude) - lon0) * kx, y = (Cesium.Math.toDegrees(p.latitude) - lat0) * ky;
    const cx = clamp(x, -lim, lim), cy = clamp(y, -lim, lim);
    const h = clamp(p.height, gh + MIN_CLEAR, gh + MAX_HEIGHT);
    if (cx !== x || cy !== y || h !== p.height) {
      cam.setView({ destination: Cesium.Cartesian3.fromDegrees(lon0 + cx / kx, lat0 + cy / ky, h), orientation: { heading: cam.heading, pitch: cam.pitch, roll: 0 } });
    }
  };
  viewer.scene.postRender.addEventListener(guard);

  function focus(t: FocusTarget, o: FocusOpts = {}) {
    const p = d.resolve(t);
    if (!p) return false;
    const [lon, lat] = d.ll(p.x, p.y);
    const range = clamp(o.range ?? FIELD_RANGE, MIN_ZOOM, MAX_HEIGHT * 1.6);
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
  /** Both sides in view over the 10x10 km field, tilted. */
  const frameField = (durationS = 2.2) => focus({ x: 0, y: 0 }, { range: FIELD_RANGE, pitchDeg: -50, headingDeg: 0, durationS });

  return {
    focus, frameField,
    destroy() {
      viewer.scene.postRender.removeEventListener(guard);
      ctl.minimumZoomDistance = saved.min; ctl.maximumZoomDistance = saved.max; ctl.enableCollisionDetection = saved.col;
    },
  };
}
