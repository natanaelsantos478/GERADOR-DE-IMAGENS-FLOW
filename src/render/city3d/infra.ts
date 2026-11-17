/** Infrastructure points (pylons, masts, stations...) as simple solids from styles/infra.json. */
import type { VectorArea } from '../../data/vector/types';
import { hash, type TileRef } from './geo';
import type { Ground } from './ground';
import { Mesh, PAT } from './mesh';
import { pickStyle, type Styles } from './styles';

export function buildInfra(area: VectorArea, tile: TileRef, ground: Ground, st: Styles): { mesh: Mesh; count: number } {
  const m = new Mesh(tile), half = tile.sizeM / 2;
  let count = 0;
  for (const o of area.infra) {
    if (Math.abs(o.x) > half || Math.abs(o.y) > half) continue;
    const S = pickStyle(st.infra.map((p) => ({ ...p, match: { kinds: p.match.kinds } })), { kind: o.kind });
    const z = ground(o.x, o.y), rot = hash(Math.round(o.x), Math.round(o.y), 21) * 3.14;
    m.frustum(o.x, o.y, z - 0.5, z + S.height, S.width / 2, (S.top ?? S.width / 2) , rot, S.color, PAT.BLANK);
    count++;
  }
  return { mesh: m, count };
}
