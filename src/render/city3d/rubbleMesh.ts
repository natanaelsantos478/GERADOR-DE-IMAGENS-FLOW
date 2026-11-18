/** Rubble model -> triangles of a city mesh (shares the building appearance: vertex colours + the texture atlas). */
import type { Atlas } from './atlas';
import { Mesh, PAT } from './mesh';
import type { RubbleModel } from './rubble';

type M3 = [number, number, number, number, number, number, number, number, number];
/** Rotation Rz(yaw) * Ry(roll) * Rx(pitch), row-major. */
function rotation(yaw: number, pitch: number, roll: number): M3 {
  const cz = Math.cos(yaw), sz = Math.sin(yaw), cy = Math.cos(roll), sy = Math.sin(roll), cx = Math.cos(pitch), sx = Math.sin(pitch);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}
const apply = (r: M3, x: number, y: number, z: number): [number, number, number] => [r[0] * x + r[1] * y + r[2] * z, r[3] * x + r[4] * y + r[5] * z, r[6] * x + r[7] * y + r[8] * z];
const AX: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const CORN: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/** Oriented box (12 triangles) centred at (x,y,z) of the mesh frame. `cell` = atlas cell for textured faces (u,v in repeats of real metres). */
function box(m: Mesh, x: number, y: number, z: number, size: [number, number, number], r: M3, col: readonly [number, number, number], cell?: { byte: number; mu: number; mv: number }, off = 0) {
  for (let a = 0; a < 3; a++) for (const sg of [-1, 1]) {
    const b = (a + 1) % 3, c = (a + 2) % 3, n = apply(r, AX[a][0] * sg, AX[a][1] * sg, AX[a][2] * sg);
    const ids = CORN.map(([ub, uc]) => {
      const p: [number, number, number] = [0, 0, 0];
      p[a] = sg * size[a] / 2; p[b] = ub * size[b] / 2; p[c] = uc * size[c] / 2;
      const q = apply(r, p[0], p[1], p[2]);
      const s = cell ? (ub * size[b] / 2 + size[b] / 2) / cell.mu + off : 0, t = cell ? (uc * size[c] / 2 + size[c] / 2) / cell.mv + off : 0;
      return m.vert(x + q[0], y + q[1], z + q[2], n[0], n[1], n[2], s, t, col, cell ? cell.byte : PAT.BLANK);
    });
    m.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}

/**
 * Adds the heap + loose pieces to `m`. `gz` = ground height (ellipsoidal) at the footprint centre.
 * The model's own (cx, cy) is the centre in the mesh's local frame.
 */
export function emitRubble(m: Mesh, model: RubbleModel, gz: number, atlas: Atlas | null, ground?: (x: number, y: number) => number): void {
  const { cx, cy, mound } = model, cellOf = (id?: string) => (atlas && id ? atlas.cells.get(id) : undefined);
  // ground stain: dark band around the heap foot, following the terrain, so the ruin reads from far away
  {
    const K = mound.pts.length, dc: [number, number, number] = [model.decal.color[0], model.decal.color[1], model.decal.color[2]];
    const gAt = (px: number, py: number): number => (ground ? ground(cx + px, cy + py) : gz) + 0.12;
    for (let i = 0; i < K; i++) {
      const j = (i + 1) % K, a = mound.pts[i], b = mound.pts[j], c = model.decal.pts[j], d = model.decal.pts[i];
      m.facet([[cx + a[0] * 0.8, cy + a[1] * 0.8, gAt(a[0] * 0.8, a[1] * 0.8)], [cx + b[0] * 0.8, cy + b[1] * 0.8, gAt(b[0] * 0.8, b[1] * 0.8)], [cx + c[0], cy + c[1], gAt(c[0], c[1])], [cx + d[0], cy + d[1], gAt(d[0], d[1])]], dc, PAT.BLANK);
    }
  }
  // heap body
  const mc = cellOf(mound.tex);
  m.roofPat = mc ? mc.byte : PAT.BLANK; m.roofInv = mc ? 1 / mc.mu : 1; m.roofU = (model.id % 13) / 13; m.roofV = (model.id % 7) / 7;
  const col: [number, number, number] = [mound.color[0], mound.color[1], mound.color[2]];
  const K = mound.pts.length;
  const at = (i: number, l: number): [number, number, number] => {
    const [k, h] = mound.levels[l], [px, py] = mound.pts[i % K];
    return [cx + px * k, cy + py * k, gz - 0.25 + (h > 0 ? h * mound.jit[(i % K) * 2 + (l > 1 ? 1 : 0)] : 0)];
  };
  for (let l = 0; l < mound.levels.length - 1; l++) for (let i = 0; i < K; i++) {
    const a = at(i, l), b = at(i + 1, l), c = at(i + 1, l + 1), d = at(i, l + 1);
    if (mound.levels[l + 1][0] === 0) m.facet([a, b, [cx, cy, gz - 0.25 + mound.levels[l + 1][1]]], col);
    else m.facet([a, b, c, d], col);
  }
  // loose pieces
  for (const p of model.pieces) {
    const cell = cellOf(p.tex);
    box(m, cx + p.x, cy + p.y, gz + p.z, [p.sx, p.sy, p.sz], rotation(p.yaw, p.pitch, p.roll), p.color, cell, (model.id * 0.37 + p.x) % 1);
  }
}
