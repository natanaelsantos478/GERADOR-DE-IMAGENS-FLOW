/** Strategic map units & world effects. `attachUnitsLayer(globe, getGame)` mounts everything; returns a disposer + test handles. */
import type { Game } from '../../core/game';
import type { Globe } from '../globe/types';
import { attachCity3D, type City3D } from '../city3d';
import { ModelPool, loadModelData } from './common';
import { useUnitSelection } from './store';
import { attachStrategic, nearClusterDebug, type StrategicApi } from './strategic';
import { attachWorldLayer, type WorldLayerApi } from './world';

export { renderEvents, type RenderEvent } from './common';
export { useUnitSelection } from './store';

export interface UnitsLayer {
  strategic: StrategicApi | null;
  world: WorldLayerApi | null;
  pool: ModelPool | null;
  /** Real 3D buildings, roads and trees of the visible area. */
  city: City3D;
  nearCluster: typeof nearClusterDebug;
  destroy(): void;
}

export function attachUnitsLayer(globe: Globe, getGame: () => Game | null): UnitsLayer {
  const city = attachCity3D(globe);
  (window as unknown as { __city3d?: City3D }).__city3d = city;
  const layer: UnitsLayer = { strategic: null, world: null, pool: null, city, nearCluster: nearClusterDebug, destroy() { dead = true; city.destroy(); layer.world?.destroy(); layer.strategic?.destroy(); layer.pool?.destroy(); } };
  let dead = false;
  (window as unknown as { __unitSel?: typeof useUnitSelection }).__unitSel = useUnitSelection;
  void loadModelData().then((mf) => {
    if (dead) return;
    const pool = new ModelPool(globe.viewer.scene, mf);
    layer.pool = pool;
    layer.strategic = attachStrategic(globe, getGame, pool);
    let vis = new Set<string>(), at = 0;
    layer.world = attachWorldLayer(globe, getGame, pool, (id) => {
      if (performance.now() - at > 500) { vis = new Set(layer.strategic?.states().map((s) => s.id)); at = performance.now(); }
      return vis.has(id);
    });
  });
  return layer;
}
