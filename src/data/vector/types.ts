/** Vector geometry of an area in local metres (x east, y north, origin = area centre). */
export interface VPoly { rings: number[][]; cls: string; sub?: string; h?: number; minH?: number; kind?: string }
/** Classification of a source class: counts it and reports unknown ones. */
export function emptyArea(lon: number, lat: number, sizeM: number, zoom: number): VectorArea {
  return { lon, lat, sizeM, zoom, tiles: 0, buildings: [], roads: [], water: [], waterways: [], landcover: [], landuse: [], aeroways: [], peaks: [], infra: [], pois: [], seen: {}, unmapped: [] };
}
export interface VLine { pts: number[]; cls: string; sub?: string; brunnel?: string; surface?: string }
export interface VectorArea {
  lon: number; lat: number; sizeM: number; zoom: number; tiles: number;
  buildings: VPoly[]; roads: VLine[]; water: VPoly[]; waterways: VLine[];
  landcover: VPoly[]; landuse: VPoly[]; aeroways: VLine[];
  peaks: { x: number; y: number; ele?: number; name?: string }[];
  /** Infrastructure points/lines/polygons reduced to a point (towers, dams, stations, ...). */
  infra: { x: number; y: number; kind: string; cls?: string }[];
  /** Places of interest (hospital, police, townhall, station, ...). */
  pois: { x: number; y: number; kind: string }[];
  /** Every raw source class met (`src:layer:class` -> count) and those the rule table does not know. */
  seen: Record<string, number>;
  unmapped: string[];
}
export type TileBytes = Uint8Array;
/** Where tile bytes come from; `null` = tile missing/unreachable. */
export interface TileSource { get(z: number, x: number, y: number): Promise<TileBytes | null> }
