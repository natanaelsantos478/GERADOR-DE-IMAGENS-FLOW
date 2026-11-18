import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { instanceGlb } from './glbInstancing';
import { matches, pickStyle, roadWidth, validate } from './styles';

const J = (f: string) => JSON.parse(readFileSync(`public/data/styles/${f}.json`, 'utf8'));
const raw = () => ({ buildings: J('buildings'), trees: J('trees'), roads: J('roads'), bridges: J('bridges'), water: J('water'), infra: J('infra'), rubble: J('rubble') });

describe('style catalogs', () => {
  it('shipped catalogs validate', () => { expect(() => validate(raw() as never)).not.toThrow(); });
  it('rejects a catalog without catch-all, with bad palette or unknown species', () => {
    const r = raw(); r.buildings.patterns.pop();
    expect(() => validate(r as never)).toThrow(/catch-all/);
    const p = raw(); p.buildings.patterns[0].palette = [[1, 2]];
    expect(() => validate(p as never)).toThrow(/palette/);
    const t = raw(); t.trees.rules[0].mix[0].species = 'nope';
    expect(() => validate(t as never)).toThrow(/unknown species/);
  });
  it('first matching pattern wins, specific before generic', () => {
    const s = validate(raw() as never);
    expect(pickStyle(s.buildings, { kind: 'hospital', height: 20, area: 900, absLat: 48 }).id).toBe('hospital');
    expect(pickStyle(s.buildings, { height: 120, area: 900, absLat: 48 }).id).toBe('tower-glass');
    expect(pickStyle(s.buildings, { height: 5, area: 120, absLat: 48 }).id).toBe('rural-house');
    expect(pickStyle(s.buildings, { height: 8, area: 50, absLat: -22 }).id).toBe('informal-dense-tropical');
    expect(pickStyle(s.trees, { cover: 'wood', absLat: 48, elev: 300 }).id).toBe('temperate-forest');
    expect(pickStyle(s.trees, { cover: 'wood', absLat: -22, elev: 100 }).id).toBe('tropical-forest');
    expect(pickStyle(s.bridges, { cls: 'minor', length: 30 }).id).toBe('generic');
  });
  it('matches ranges and road widths', () => {
    expect(matches({ minHeight: 10, maxHeight: 20 }, { height: 15 })).toBe(true);
    expect(matches({ minHeight: 10 }, {})).toBe(false);
    expect(roadWidth({ lanes: 4, laneWidth: 3.6, shoulder: 1, fill: '#000' })).toBeCloseTo(16.4);
  });
});

describe('glb instancing', () => {
  it('adds EXT_mesh_gpu_instancing data to a real tree glb', () => {
    const b = readFileSync('public/models/nature/commontree_1.glb');
    const src = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const out = instanceGlb(src, new Float32Array(6), new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]), new Float32Array([1, 1, 1, 2, 2, 2]));
    const dv = new DataView(out.buffer);
    expect(dv.getUint32(8, true)).toBe(out.length);
    const jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(out.subarray(20, 20 + jl)));
    expect(json.extensionsUsed).toContain('EXT_mesh_gpu_instancing');
    const node = json.nodes.find((n: any) => n.mesh !== undefined);
    expect(json.accessors[node.extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION].count).toBe(2);
  });
});
