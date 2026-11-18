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
  /** Camera distance (m, to the nearest edge of a tree cell) under which the full-detail tree models are drawn. */
  treeNear: number;
  /** Same for the mid-detail models; beyond it the far models (tools/models/tree-lod.mjs). */
  treeMid: number;
  maxTiles: number;
  maxTreesPerTile: number;
  roadPx: number;
  concurrency: number;
}
export const CITY_CONFIG: Record<QualityId, CityConfig> = {
  // only what is near is drawn: small buildings within lodMinor, trees within treeDist (full models only inside treeNear,
  // mid-detail inside treeMid, 4-triangle impostors beyond). More trees per tile than before: the far ones are cheap and the
  // satellite-green placement needs them to fill a forest. Beyond treeDist the satellite photo itself shows the canopy; the impostor ring is unlit and cheap, so it reaches far.
  mobile: { enableH: 3500, enableHTac: 9000, lodMinor: 1500, treeDist: 1300, treeNear: 70, treeMid: 200, maxTiles: 4, maxTreesPerTile: 2500, roadPx: 768, concurrency: 1 },
  low: { enableH: 5000, enableHTac: 11000, lodMinor: 1900, treeDist: 1900, treeNear: 90, treeMid: 260, maxTiles: 5, maxTreesPerTile: 4000, roadPx: 1024, concurrency: 2 },
  mid: { enableH: 6500, enableHTac: 13000, lodMinor: 2500, treeDist: 2500, treeNear: 120, treeMid: 330, maxTiles: 7, maxTreesPerTile: 6000, roadPx: 1536, concurrency: 2 },
  high: { enableH: 7000, enableHTac: 14000, lodMinor: 2900, treeDist: 3000, treeNear: 150, treeMid: 400, maxTiles: 9, maxTreesPerTile: 8000, roadPx: 2048, concurrency: 3 },
};
/** Big/tall buildings that stay visible from afar. */
export const MAJOR_AREA = 650;
export const MAJOR_HEIGHT = 24;
export const ATTRIBUTION = '© OpenStreetMap contributors, Overture Maps Foundation';
