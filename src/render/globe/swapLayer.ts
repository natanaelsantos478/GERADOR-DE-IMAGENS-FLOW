/** An imagery layer that can be rebuilt (recoloured) without flicker: the new layer replaces the old when loaded. */
import * as Cesium from 'cesium';

export class SwapLayer {
  layer: Cesium.ImageryLayer;
  private pending: Cesium.ImageryLayer | null = null;
  private cancel: (() => void) | null = null;
  private show: boolean;
  private alpha: number;

  constructor(
    private viewer: Cesium.Viewer,
    private make: () => Cesium.ImageryProvider,
    o: { alpha?: number; show?: boolean } = {},
  ) {
    this.alpha = o.alpha ?? 1;
    this.show = o.show ?? true;
    this.layer = viewer.imageryLayers.addImageryProvider(make());
    this.layer.alpha = this.alpha;
    this.layer.show = this.show;
  }

  setShow(b: boolean) {
    if (this.viewer.isDestroyed()) return;
    this.show = b;
    this.layer.show = b;
    if (this.pending) this.pending.show = b;
    this.viewer.scene.requestRender();
  }
  setAlpha(a: number) {
    if (this.viewer.isDestroyed()) return;
    this.alpha = a;
    this.layer.alpha = a;
    this.viewer.scene.requestRender();
  }
  isShown() {
    return this.show;
  }

  /** Rebuild the provider (new colours/data) and swap when its tiles are ready. */
  refresh() {
    if (this.viewer.isDestroyed()) return;
    this.abort();
    const layers = this.viewer.imageryLayers;
    if (!this.show) {
      const old = this.layer;
      const idx = layers.indexOf(old);
      this.layer = layers.addImageryProvider(this.make(), idx);
      this.layer.alpha = this.alpha;
      this.layer.show = false;
      layers.remove(old, true);
      return;
    }
    const old = this.layer;
    const fresh = layers.addImageryProvider(this.make(), layers.indexOf(old) + 1);
    fresh.alpha = 0;
    this.pending = fresh;
    const scene = this.viewer.scene;
    let done = false;
    const finish = () => {
      if (done || this.viewer.isDestroyed()) return;
      done = true;
      cleanup();
      fresh.alpha = this.alpha;
      this.layer = fresh;
      this.pending = null;
      layers.remove(old, true);
      scene.requestRender();
    };
    const ev = scene.globe.tileLoadProgressEvent;
    const onProgress = (n: number) => {
      if (n === 0) setTimeout(finish, 60);
    };
    ev.addEventListener(onProgress);
    const timer = setTimeout(finish, 2500);
    const cleanup = () => {
      ev.removeEventListener(onProgress);
      clearTimeout(timer);
    };
    this.cancel = () => {
      done = true;
      cleanup();
      layers.remove(fresh, true);
      this.pending = null;
    };
    scene.requestRender();
  }

  private abort() {
    this.cancel?.();
    this.cancel = null;
  }
  destroy() {
    this.abort();
    const layers = this.viewer.imageryLayers;
    if (!layers.isDestroyed()) layers.remove(this.layer, true);
  }
}
