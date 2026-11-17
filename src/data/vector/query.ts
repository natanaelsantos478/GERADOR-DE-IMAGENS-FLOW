/** Read-only queries for the renderer: buildings of a bbox and land-cover polygons by class. */
import type { NavBuilding, NavData } from './nav';
import type { VectorArea, VPoly } from './types';

/** Buildings (simplified outline + height) whose centre is inside the local-metre bbox, with footprint >= minArea m². */
export function buildingsIn(nav: NavData, bb: { x0: number; y0: number; x1: number; y1: number }, minArea = 0): NavBuilding[] {
  return nav.buildings.filter((b) => b.area >= minArea && b.cx >= bb.x0 && b.cx <= bb.x1 && b.cy >= bb.y0 && b.cy <= bb.y1);
}
/** Cover polygons (wood, rock, sand, wetland, grass, farmland, ice) from a loaded area, optionally filtered by class. */
export function coverPolygons(area: VectorArea, classes?: string[]): VPoly[] {
  return classes ? area.landcover.filter((p) => classes.includes(p.cls)) : area.landcover;
}
