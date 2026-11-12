/** Pointer input: click / right-click / hover / box select on top of the Cesium canvas. */
import type { BoxInfo, GlobeEvents, PickResult, PointerInfo } from './types';

type Handlers = { [K in keyof GlobeEvents]?: Set<(e: GlobeEvents[K]) => void> };

export class GlobeInput {
  private h: Handlers = {};
  private down: { x: number; y: number; button: number } | null = null;
  private boxEl: HTMLDivElement;
  private boxing = false;
  private lastHover = 0;
  private offs: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, container: HTMLElement, private pick: (x: number, y: number) => PickResult) {
    this.boxEl = document.createElement('div');
    Object.assign(this.boxEl.style, { position: 'absolute', display: 'none', pointerEvents: 'none', border: '1px solid #7fd0ff', background: 'rgba(127,208,255,0.14)', zIndex: '5' });
    container.appendChild(this.boxEl);
    const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement | Window, k: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      t.addEventListener(k, fn as EventListener);
      this.offs.push(() => t.removeEventListener(k, fn as EventListener));
    };
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'pointerdown', (e) => {
      const p = this.rel(e);
      this.down = { ...p, button: e.button };
    });
    on(canvas, 'pointermove', (e) => this.move(e));
    on(window, 'pointerup', (e) => this.up(e));
    on(canvas, 'dblclick', (e) => {
      const p = this.rel(e);
      this.emit('doubleclick', this.info(e, p.x, p.y));
    });
  }

  on<K extends keyof GlobeEvents>(type: K, cb: (e: GlobeEvents[K]) => void): () => void {
    const set = ((this.h as Record<string, Set<unknown>>)[type] ??= new Set()) as Set<(e: GlobeEvents[K]) => void>;
    set.add(cb);
    return () => set.delete(cb);
  }
  private emit<K extends keyof GlobeEvents>(type: K, e: GlobeEvents[K]) {
    (this.h[type] as Set<(e: GlobeEvents[K]) => void> | undefined)?.forEach((f) => f(e));
  }
  private rel(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private info(e: PointerEvent | MouseEvent, x: number, y: number): PointerInfo {
    return { x, y, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, pick: this.pick(x, y) };
  }

  private move(e: PointerEvent) {
    const p = this.rel(e);
    const d = this.down;
    if (d) {
      if (d.button === 0 && e.shiftKey && (this.boxing || Math.hypot(p.x - d.x, p.y - d.y) > 5)) {
        this.boxing = true;
        const s = this.boxEl.style;
        s.display = 'block';
        s.left = `${Math.min(d.x, p.x)}px`;
        s.top = `${Math.min(d.y, p.y)}px`;
        s.width = `${Math.abs(p.x - d.x)}px`;
        s.height = `${Math.abs(p.y - d.y)}px`;
      }
      return;
    }
    const now = performance.now();
    if (now - this.lastHover < 90 || !this.h.hover?.size) return;
    this.lastHover = now;
    this.emit('hover', this.info(e, p.x, p.y));
  }

  private up(e: PointerEvent) {
    const d = this.down;
    this.down = null;
    if (!d) return;
    const p = this.rel(e);
    if (this.boxing) {
      this.boxing = false;
      this.boxEl.style.display = 'none';
      const b: BoxInfo = { x0: Math.min(d.x, p.x), y0: Math.min(d.y, p.y), x1: Math.max(d.x, p.x), y1: Math.max(d.y, p.y), shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
      this.emit('box', b);
      return;
    }
    if (e.target !== this.canvas || Math.hypot(p.x - d.x, p.y - d.y) > 5) return;
    if (d.button === 0) this.emit('click', this.info(e, p.x, p.y));
    else if (d.button === 2) this.emit('rightclick', this.info(e, p.x, p.y));
  }

  destroy() {
    this.offs.forEach((f) => f());
    this.boxEl.remove();
  }
}
