/** 2D equirectangular minimap: countries, camera frame, overlays; click/drag recentres the globe. */
import type { WorldStatic } from '../../core/contracts';
import type { CameraState, Minimap } from './types';

export function createMinimap(world: WorldStatic, go: (lon: number, lat: number) => void, getCam: () => CameraState): Minimap {
  const el = document.createElement('canvas');
  el.width = 240;
  el.height = 120;
  el.style.cursor = 'pointer';
  const bg = document.createElement('canvas');
  const overlays = new Set<(g: CanvasRenderingContext2D, p: (lon: number, lat: number) => [number, number]) => void>();
  const g = el.getContext('2d')!;
  const project = (lon: number, lat: number): [number, number] => [((lon + 180) / 360) * el.width, ((90 - lat) / 180) * el.height];

  function paintBg() {
    bg.width = el.width;
    bg.height = el.height;
    const b = bg.getContext('2d')!;
    b.fillStyle = '#0d2233';
    b.fillRect(0, 0, bg.width, bg.height);
    for (const f of world.countriesGeo.features) {
      const c = world.countryById.get(f.properties.id as string)?.color ?? [90, 90, 90];
      b.fillStyle = `rgb(${c[0] * 0.8 + 20},${c[1] * 0.8 + 20},${c[2] * 0.8 + 20})`;
      b.beginPath();
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys)
        for (const ring of poly) {
          ring.forEach(([lon, lat], i) => {
            const [x, y] = project(lon, lat);
            if (i) b.lineTo(x, y);
            else b.moveTo(x, y);
          });
          b.closePath();
        }
      b.fill('evenodd');
    }
  }
  paintBg();

  function redraw() {
    g.drawImage(bg, 0, 0);
    overlays.forEach((fn) => fn(g, project));
    const c = getCam();
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    if (c.view) {
      const [w, s, e, n] = c.view;
      const [x0, y0] = project(w, n);
      const [x1, y1] = project(e, s);
      g.strokeRect(x0, y0, x1 - x0 || 2, y1 - y0 || 2);
    } else {
      const [x, y] = project(c.lon, c.lat);
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.strokeRect(0.5, 0.5, el.width - 1, el.height - 1);
  }

  let drag = false;
  const at = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const lon = ((e.clientX - r.left) / r.width) * 360 - 180;
    const lat = 90 - ((e.clientY - r.top) / r.height) * 180;
    go(Math.max(-180, Math.min(180, lon)), Math.max(-85, Math.min(85, lat)));
  };
  el.addEventListener('pointerdown', (e) => {
    drag = true;
    el.setPointerCapture(e.pointerId);
    at(e);
  });
  el.addEventListener('pointermove', (e) => drag && at(e));
  el.addEventListener('pointerup', () => (drag = false));
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    element: el,
    setSize(w, h) {
      el.width = w;
      el.height = h;
      paintBg();
      redraw();
    },
    addOverlay(fn) {
      overlays.add(fn);
      return () => overlays.delete(fn);
    },
    redraw,
  };
}
