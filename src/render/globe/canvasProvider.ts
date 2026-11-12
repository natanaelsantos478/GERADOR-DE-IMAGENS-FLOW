/** Minimal Web-Mercator ImageryProvider that paints each tile with a callback. */
import * as Cesium from 'cesium';

export type DrawTile = (g: CanvasRenderingContext2D, z: number, x: number, y: number, size: number) => boolean | void;

export function createCanvasImagery(opts: { size: number; maxLevel: number; draw: DrawTile; credit?: string; minLevel?: number }): Cesium.ImageryProvider {
  const tilingScheme = new Cesium.WebMercatorTilingScheme();
  const empty = document.createElement('canvas');
  empty.width = empty.height = 1;
  const p = {
    tilingScheme,
    rectangle: tilingScheme.rectangle,
    tileWidth: opts.size,
    tileHeight: opts.size,
    minimumLevel: opts.minLevel ?? 0,
    maximumLevel: opts.maxLevel,
    tileDiscardPolicy: undefined,
    errorEvent: new Cesium.Event(),
    credit: opts.credit ? new Cesium.Credit(opts.credit, true) : undefined,
    proxy: undefined,
    hasAlphaChannel: true,
    requestImage(x: number, y: number, level: number) {
      const c = document.createElement('canvas');
      c.width = c.height = opts.size;
      const g = c.getContext('2d')!;
      const drew = opts.draw(g, level, x, y, opts.size);
      return Promise.resolve(drew === false ? empty : c);
    },
    pickFeatures: () => undefined,
  };
  return p as unknown as Cesium.ImageryProvider;
}
