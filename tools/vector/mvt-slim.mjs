// Re-encodes an MVT keeping only whitelisted layers/properties/feature types (keeps committed fixtures small).
const rv = (b, p) => { let v = 0, m = 1, c; do { c = b[p.i++]; v += (c & 0x7f) * m; m *= 128; } while (c & 0x80); return v; };
const wv = (out, v) => { while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(v); };
function fields(buf, fn) { const p = { i: 0 }; while (p.i < buf.length) { const tag = rv(buf, p), f = tag >> 3, wt = tag & 7; if (wt === 0) fn(f, rv(buf, p), null); else if (wt === 2) { const l = rv(buf, p); fn(f, null, buf.subarray(p.i, p.i + l)); p.i += l; } else throw new Error('wt' + wt); } }
const bytesField = (out, f, b) => { wv(out, (f << 3) | 2); wv(out, b.length); for (const x of b) out.push(x); };
const varField = (out, f, v) => { wv(out, f << 3); wv(out, v); };

/** spec: { layerName: { props: [names], types?: [1|2|3], keep?: (propsObj)=>bool } } */
export function slim(tile, spec) {
  const res = [];
  fields(tile, (f, _v, b) => {
    if (f !== 3) return;
    let name = '', ext = 4096; const keys = [], vals = [], feats = [];
    fields(b, (lf, lv, lb) => { if (lf === 1) name = Buffer.from(lb).toString(); else if (lf === 2) feats.push(lb); else if (lf === 3) keys.push(Buffer.from(lb).toString()); else if (lf === 4) vals.push(lb); else if (lf === 5) ext = lv; });
    const sp = spec[name]; if (!sp) return;
    const nk = [], nv = [], vmap = new Map(), kmap = new Map(), nf = [];
    for (const fb of feats) {
      let type = 0, tags = [], geom = null;
      fields(fb, (ff, fv, fbb) => { if (ff === 3) type = fv; else if (ff === 2) { const p = { i: 0 }; while (p.i < fbb.length) tags.push(rv(fbb, p)); } else if (ff === 4) geom = fbb; });
      if (sp.types && !sp.types.includes(type)) continue;
      const props = {}, kept = [];
      for (let i = 0; i + 1 < tags.length; i += 2) {
        const k = keys[tags[i]], vb = vals[tags[i + 1]];
        if (!sp.props.includes(k)) continue;
        kept.push([k, vb]);
      }
      if (sp.keep && !sp.keep(Object.fromEntries(kept.map(([k, vb]) => [k, decodeStr(vb)])))) continue;
      const nt = [];
      for (const [k, vb] of kept) {
        if (!kmap.has(k)) { kmap.set(k, nk.length); nk.push(k); }
        const h = Buffer.from(vb).toString('hex');
        if (!vmap.has(h)) { vmap.set(h, nv.length); nv.push(vb); }
        nt.push(kmap.get(k), vmap.get(h));
      }
      const o = []; const tb = []; for (const t of nt) wv(tb, t);
      if (nt.length) bytesField(o, 2, tb); varField(o, 3, type); bytesField(o, 4, geom);
      nf.push(o);
    }
    if (!nf.length) return;
    const o = []; varField(o, 15, 2); bytesField(o, 1, Buffer.from(name));
    for (const x of nf) bytesField(o, 2, x);
    for (const k of nk) bytesField(o, 3, Buffer.from(k));
    for (const v of nv) bytesField(o, 4, v);
    varField(o, 5, ext);
    const lo = []; bytesField(lo, 3, o); res.push(Buffer.from(lo));
  });
  return Buffer.concat(res);
}
// Value message: field 1 = string (wire type 2); others ignored (returns the string only for string values).
function decodeStr(vb) { if ((vb[0] >> 3) === 1 && (vb[0] & 7) === 2) { const p = { i: 1 }; const l = rv(vb, p); return Buffer.from(vb.subarray(p.i, p.i + l)).toString(); } return undefined; }
