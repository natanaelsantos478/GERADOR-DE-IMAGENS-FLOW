/** City-3D tuning per graphics profile (distances in metres, counts per tile). */
import type { QualityId } from '../globe/quality';

export interface CityConfig {
  /** Camera height above ground below which the layer loads. */
  enableH: number;
  /** Same, while a tactical battle is on screen (the field is framed from ~8 km). */
  enableHTac: number;
  /** Tile-centre distance under which small buildings are drawn (above it only big/tall ones). */
  lodMinor: number;
  /** Tile-centre distance under which trees are drawn; the second half of the instances needs `treeDist * 0.55`. */
  treeDist: number;
  maxTiles: number;
  maxTreesPerTile: number;
  roadPx: number;
  concurrency: number;
}
export const CITY_CONFIG: Record<QualityId, CityConfig> = {
  mobile: { enableH: 4500, enableHTac: 9000, lodMinor: 1700, treeDist: 1300, maxTiles: 4, maxTreesPerTile: 900, roadPx: 768, concurrency: 1 },
  low: { enableH: 6000, enableHTac: 11000, lodMinor: 2300, treeDist: 1900, maxTiles: 6, maxTreesPerTile: 1600, roadPx: 1024, concurrency: 2 },
  mid: { enableH: 8000, enableHTac: 13000, lodMinor: 3000, treeDist: 2600, maxTiles: 9, maxTreesPerTile: 1400, roadPx: 1536, concurrency: 2 },
  high: { enableH: 8000, enableHTac: 14000, lodMinor: 3200, treeDist: 3000, maxTiles: 12, maxTreesPerTile: 2000, roadPx: 2048, concurrency: 3 },
};
/** Big/tall buildings that stay visible from afar. */
export const MAJOR_AREA = 650;
export const MAJOR_HEIGHT = 24;
export const ATTRIBUTION = '© OpenStreetMap contributors, Overture Maps Foundation';
