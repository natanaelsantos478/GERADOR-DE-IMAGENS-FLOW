// usage: node inspect-glb.mjs file.glb...   prints bbox, tris, anims, textures
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { getBounds } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const d = await io.read(f); const sc = d.getRoot().getDefaultScene() || d.getRoot().listScenes()[0];
  const b = getBounds(sc); let tris=0; d.getRoot().listMeshes().forEach(m=>m.listPrimitives().forEach(p=>tris+=(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3));
  console.log(f.split('/').pop(), 'size', b.max.map((v,i)=>(v-b.min[i]).toFixed(2)).join('x'), 'min', b.min.map(v=>v.toFixed(2)).join(','), 'tris', Math.round(tris), 'tex', d.getRoot().listTextures().map(t=>t.getSize()?.join('x')).join(','), 'anims', d.getRoot().listAnimations().map(a=>a.getName()).join('|'));
}
