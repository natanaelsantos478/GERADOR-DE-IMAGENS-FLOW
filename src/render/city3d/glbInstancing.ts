/** Turns a plain .glb into one using EXT_mesh_gpu_instancing (one draw call for many trees); instance data is appended to the BIN chunk. */
const MAGIC = 0x46546c67, JSON_T = 0x4e4f534a, BIN_T = 0x004e4942;
const pad4 = (n: number) => (n + 3) & ~3;

export function instanceGlb(src: ArrayBuffer, translation: Float32Array, rotation: Float32Array, scale: Float32Array): Uint8Array {
  const dv = new DataView(src);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a glb');
  let off = 12, json: Record<string, any> | null = null, bin = new Uint8Array(0);
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), body = new Uint8Array(src, off + 8, len);
    if (type === JSON_T) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === BIN_T) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error('glb without json');
  const base = pad4(bin.length), parts = [translation, rotation, scale], names = ['TRANSLATION', 'ROTATION', 'SCALE'], comps = [3, 4, 3];
  let total = base;
  const views: number[] = [];
  for (const p of parts) { views.push(total); total += p.byteLength; }
  json.bufferViews ??= []; json.accessors ??= [];
  const attrs: Record<string, number> = {};
  parts.forEach((p, i) => {
    json!.bufferViews.push({ buffer: 0, byteOffset: views[i], byteLength: p.byteLength });
    json!.accessors.push({ bufferView: json!.bufferViews.length - 1, componentType: 5126, count: p.length / comps[i], type: comps[i] === 3 ? 'VEC3' : 'VEC4' });
    attrs[names[i]] = json!.accessors.length - 1;
  });
  json.buffers = [{ byteLength: total }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_mesh_gpu_instancing'])];
  for (const n of json.nodes ?? []) if (n.mesh !== undefined) (n.extensions ??= {}).EXT_mesh_gpu_instancing = { attributes: attrs };
  const j = new TextEncoder().encode(JSON.stringify(json)), jl = pad4(j.length);
  const out = new Uint8Array(12 + 8 + jl + 8 + pad4(total)), o = new DataView(out.buffer);
  o.setUint32(0, MAGIC, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true);
  o.setUint32(12, jl, true); o.setUint32(16, JSON_T, true); out.set(j, 20); out.fill(0x20, 20 + j.length, 20 + jl);
  const bo = 20 + jl;
  o.setUint32(bo, pad4(total), true); o.setUint32(bo + 4, BIN_T, true);
  out.set(bin, bo + 8);
  parts.forEach((p, i) => out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), bo + 8 + views[i]));
  return out;
}
