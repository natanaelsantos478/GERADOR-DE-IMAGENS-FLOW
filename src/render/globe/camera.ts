/** Camera limits, comfortable controls, keyboard pan and state helpers. */
import * as Cesium from 'cesium';
import type { BBox } from '../../core/contracts';
import type { CameraState, FlyOptions } from './types';

const { Math: CM } = Cesium;
export const MIN_HEIGHT = 200;
export const MAX_HEIGHT = 3.2e7;

export function configureCamera(viewer: Cesium.Viewer) {
  const c = viewer.scene.screenSpaceCameraController;
  c.minimumZoomDistance = MIN_HEIGHT;
  c.maximumZoomDistance = MAX_HEIGHT;
  c.enableCollisionDetection = true;
  c.inertiaSpin = 0.88;
  c.inertiaZoom = 0.75;
  c.inertiaTranslate = 0.88;
  // left drag spins, wheel/pinch zooms, middle or ctrl+left tilts; right button & shift+left are free for orders/box select
  c.rotateEventTypes = Cesium.CameraEventType.LEFT_DRAG;
  c.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
  c.tiltEventTypes = [
    Cesium.CameraEventType.MIDDLE_DRAG,
    Cesium.CameraEventType.PINCH,
    { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
  ];
  c.lookEventTypes = [];
  c.maximumMovementRatio = 0.1;
  viewer.camera.percentageChanged = 0.01;
}

export function cameraState(viewer: Cesium.Viewer): CameraState {
  const cam = viewer.camera;
  const p = cam.positionCartographic;
  let view: BBox | null = null;
  if (p.height < 6e6) {
    const r = cam.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (r) view = [CM.toDegrees(r.west), CM.toDegrees(r.south), CM.toDegrees(r.east), CM.toDegrees(r.north)];
  }
  return {
    lon: CM.toDegrees(p.longitude),
    lat: CM.toDegrees(p.latitude),
    height: p.height,
    headingDeg: CM.toDegrees(cam.heading),
    pitchDeg: CM.toDegrees(cam.pitch),
    view,
  };
}

export function flyToPoint(viewer: Cesium.Viewer, groundHeight: number, lon: number, lat: number, o: FlyOptions = {}): Promise<void> {
  const height = Math.max(MIN_HEIGHT, o.height ?? 400_000);
  const pitch = CM.toRadians(o.pitchDeg ?? -90);
  const heading = CM.toRadians(o.headingDeg ?? CM.toDegrees(viewer.camera.heading));
  const range = height / Math.max(0.15, Math.sin(-pitch));
  const target = new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, groundHeight), 1);
  return new Promise((resolve) => {
    viewer.camera.flyToBoundingSphere(target, {
      offset: new Cesium.HeadingPitchRange(heading, pitch, range),
      duration: o.durationS ?? 2.2,
      complete: resolve,
      cancel: resolve,
    });
  });
}

export function setViewPoint(viewer: Cesium.Viewer, groundHeight: number, lon: number, lat: number, o: FlyOptions = {}) {
  const height = Math.max(MIN_HEIGHT, o.height ?? 400_000);
  const pitch = CM.toRadians(o.pitchDeg ?? -90);
  const heading = CM.toRadians(o.headingDeg ?? 0);
  const range = height / Math.max(0.15, Math.sin(-pitch));
  viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(lon, lat, groundHeight), new Cesium.HeadingPitchRange(heading, pitch, range));
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

export function flyToRect(viewer: Cesium.Viewer, b: BBox, o: FlyOptions = {}): Promise<void> {
  const w = Math.min(b[2] - b[0], 340);
  const padX = w * 0.12;
  const padY = (b[3] - b[1]) * 0.12;
  const rect = Cesium.Rectangle.fromDegrees(
    Math.max(-180, b[0] - padX), Math.max(-85, b[1] - padY), Math.min(180, b[0] + w + padX), Math.min(85, b[3] + padY),
  );
  return new Promise((resolve) => {
    viewer.camera.flyTo({
      destination: rect,
      orientation: { heading: CM.toRadians(o.headingDeg ?? 0), pitch: CM.toRadians(o.pitchDeg ?? -90), roll: 0 },
      duration: o.durationS ?? 2.2,
      complete: resolve,
      cancel: resolve,
    });
  });
}

/** Arrow-key panning, relative to the camera heading and proportional to altitude. */
export function installKeyboard(viewer: Cesium.Viewer, container: HTMLElement): () => void {
  const held = new Set<string>();
  let raf = 0;
  let last = 0;
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const f = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
    const r = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
    if ((f || r) && !viewer.isDestroyed()) {
      const cam = viewer.camera;
      const p = cam.positionCartographic;
      const h = cam.heading;
      const step = (Math.min(p.height, 1.2e7) / 6.371e6) * 0.9 * dt * (held.has('Shift') ? 2.5 : 1);
      const east = r * Math.cos(h) + f * Math.sin(h);
      const north = f * Math.cos(h) - r * Math.sin(h);
      const lat = Math.max(-1.45, Math.min(1.45, p.latitude + north * step));
      const lon = p.longitude + (east * step) / Math.max(0.1, Math.cos(p.latitude));
      cam.setView({ destination: Cesium.Cartesian3.fromRadians(lon, lat, p.height), orientation: { heading: h, pitch: cam.pitch, roll: 0 } });
      viewer.scene.requestRender();
      raf = requestAnimationFrame(tick);
    } else raf = 0;
  };
  const down = (e: KeyboardEvent) => {
    if (typing(e.target) || !e.key.startsWith('Arrow')) return;
    held.add(e.key);
    if (e.shiftKey) held.add('Shift');
    e.preventDefault();
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  const up = (e: KeyboardEvent) => {
    held.delete(e.key);
    if (!e.shiftKey) held.delete('Shift');
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  void container;
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    if (raf) cancelAnimationFrame(raf);
  };
}
