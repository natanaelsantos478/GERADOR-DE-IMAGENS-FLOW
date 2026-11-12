/** Terrain provider that turns Terrarium PNG tiles into Cesium heightmaps (no ion, no key). */
import * as Cesium from 'cesium';
import { loadElevTile, newRequest, TILE_PX } from './elevTiles';

const GRID = 65;
export const TERRAIN_MAX_LEVEL = 13;

export function createTerrariumTerrain(): Cesium.TerrainProvider {
  const tilingScheme = new Cesium.WebMercatorTilingScheme();
  const errorEvent = new Cesium.Event();
  const credit = new Cesium.Credit('Terreno: Mapzen/Terrarium (AWS Open Data) — SRTM, ETOPO1, GMTED', true);
  const levelZeroError = Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
    Cesium.Ellipsoid.WGS84,
    GRID,
    tilingScheme.getNumberOfXTilesAtLevel(0),
  );
  const flat = () => new Cesium.HeightmapTerrainData({ buffer: new Float32Array(GRID * GRID), width: GRID, height: GRID, childTileMask: 15 });

  const provider = {
    tilingScheme,
    errorEvent,
    credit,
    hasWaterMask: false,
    hasVertexNormals: false,
    availability: undefined,
    getLevelMaximumGeometricError: (level: number) => levelZeroError / (1 << level),
    getTileDataAvailable: (_x: number, _y: number, level: number) => level <= TERRAIN_MAX_LEVEL,
    loadTileDataAvailability: () => undefined,
    requestTileGeometry(x: number, y: number, level: number, request?: Cesium.Request) {
      if (level > TERRAIN_MAX_LEVEL) return undefined;
      const req = request ?? newRequest();
      const p = loadElevTile(level, x, y, req);
      if (!p) return undefined; // throttled: Cesium retries
      return p.then(
        (src) => {
          const buf = new Float32Array(GRID * GRID);
          const s = TILE_PX - 1;
          for (let j = 0; j < GRID; j++) {
            const fy = (j / (GRID - 1)) * s;
            const y0 = Math.floor(fy), y1 = Math.min(s, y0 + 1), ty = fy - y0;
            for (let i = 0; i < GRID; i++) {
              const fx = (i / (GRID - 1)) * s;
              const x0 = Math.floor(fx), x1 = Math.min(s, x0 + 1), tx = fx - x0;
              const a = src[y0 * TILE_PX + x0], b = src[y0 * TILE_PX + x1], c = src[y1 * TILE_PX + x0], d = src[y1 * TILE_PX + x1];
              const h = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
              buf[j * GRID + i] = h > 0 ? h : 0; // sea floor flattened: ships sit at 0 m
            }
          }
          return new Cesium.HeightmapTerrainData({ buffer: buf, width: GRID, height: GRID, childTileMask: 15 });
        },
        () => flat(),
      );
    },
  };
  return provider as unknown as Cesium.TerrainProvider;
}
