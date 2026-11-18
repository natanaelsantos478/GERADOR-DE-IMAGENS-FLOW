/** Growable vertex-colour triangle mesh in ECEF (Float64 positions so Cesium can split them into high/low parts). */
import * as Cesium from 'cesium';
import { enuToEcef, projector, type TileRef } from './geo';

/** Alpha channel of the vertex colour = surface pattern read by the facade shader. */
export const PAT = { ROOF: 0, HOUSE: 70, OFFICE: 140, GLASS: 200, BLANK: 255 } as const;

export class Mesh {
  pos: number[] = []; nrm: number[] = []; st: number[] = []; col: number[] = []; idx: number[] = [];
  /** Surface byte / texture scale (1/m) / phase used by roofs so the textured roof of each building is repeated in real metres. */
  roofPat: number = PAT.ROOF; roofInv = 1; roofU = 0; roofV = 0;
  readonly p: ReturnType<typeof projector>;
  private nv = new Cesium.Cartesian3();
  constructor(readonly tile: TileRef) { this.p = projector(tile); }
  get verts(): number { return this.pos.length / 3; }
  get tris(): number { return this.idx.length / 3; }
  /** Vertex at local (x, y) metres, ellipsoidal height h; normal given in tile-ENU. */
  vert(x: number, y: number, h: number, e: number, n: number, u: number, s: number, t: number, c: readonly [number, number, number], pat: number): number {
    const q = this.p.ecef(x, y, h), v = enuToEcef(this.tile, e, n, u, this.nv);
    this.pos.push(q.x, q.y, q.z); this.nrm.push(v.x, v.y, v.z); this.st.push(s, t); this.col.push(c[0], c[1], c[2], pat);
    return this.verts - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  /** Square frustum (box when hw0 == hw1) rotated by `rot` rad about the vertical, with a flat top. */
  frustum(cx: number, cy: number, z0: number, z1: number, hw0: number, hw1: number, rot: number, c: readonly [number, number, number], pat: number) {
    const co = Math.cos(rot), si = Math.sin(rot), at = (u: number, v: number, hw: number): [number, number] => [cx + (u * co - v * si) * hw, cy + (u * si + v * co) * hw];
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [u0, v0] = cs[i], [u1, v1] = cs[(i + 1) % 4], a = at(u0, v0, hw0), b = at(u1, v1, hw0), d = at(u1, v1, hw1), e = at(u0, v0, hw1);
      const nx = (v1 - v0) * co + (u1 - u0) * si * 0, ny = 0; void nx; void ny;
      const mx = (u0 + u1) / 2, my = (v0 + v1) / 2, n = at(mx, my, 1), ox = n[0] - cx, oy = n[1] - cy, l = Math.hypot(ox, oy) || 1;
      const i0 = this.vert(a[0], a[1], z0, ox / l, oy / l, 0, 0, 0, c, pat), i1 = this.vert(b[0], b[1], z0, ox / l, oy / l, 0, hw0 * 2, 0, c, pat);
      const i2 = this.vert(d[0], d[1], z1, ox / l, oy / l, 0, hw1 * 2, z1 - z0, c, pat), i3 = this.vert(e[0], e[1], z1, ox / l, oy / l, 0, 0, z1 - z0, c, pat);
      this.quad(i0, i1, i2, i3);
    }
    const t = cs.map(([u, v]) => { const q = at(u, v, hw1); return this.vert(q[0], q[1], z1, 0, 0, 1, q[0], q[1], c, PAT.ROOF); });
    this.quad(t[0], t[1], t[2], t[3]);
  }
  /** Planar polygon (3D points [x,y,z]) fan-triangulated, facing up. */
  facet(pts: number[][], c: readonly [number, number, number], pat: number = this.roofPat) {
    const [a, b, d] = pts, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const flip = nz < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const ids = pts.map((q) => this.vert(q[0], q[1], q[2], nx, ny, nz, q[0] * this.roofInv + this.roofU, q[1] * this.roofInv + this.roofV, c, pat));
    for (let i = 1; i < ids.length - 1; i++) { if (flip) this.tri(ids[0], ids[i + 1], ids[i]); else this.tri(ids[0], ids[i], ids[i + 1]); }
  }
  get empty() { return !this.idx.length; }
  /** One Cesium geometry (indices are split into 16-bit chunks by Primitive when needed). */
  toGeometry(): Cesium.Geometry {
    const f = (a: number[], T: typeof Float32Array | typeof Float64Array) => new T(a);
    return new Cesium.Geometry({
      attributes: ({
        position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: f(this.pos, Float64Array) }),
        normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: f(this.nrm, Float32Array) }),
        st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: f(this.st, Float32Array) }),
        color: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, normalize: true, values: new Uint8Array(this.col) }),
      } as unknown) as Cesium.GeometryAttributes,
      indices: this.verts > 65000 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: new Cesium.BoundingSphere(this.tile.origin, this.tile.sizeM * 0.9),
    });
  }
}
