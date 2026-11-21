// usage: node nodes.mjs file.glb...   prints the node tree (names, mesh tris, translation) and animations
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const d = await io.read(f); console.log('==', f.split('/').pop(), 'anims:', d.getRoot().listAnimations().map((a) => a.getName()).join('|'));
  const walk = (n, dep) => { const m = n.getMesh(); console.log(' '.repeat(dep * 2) + (n.getName() || '?'), m ? `[mesh ${m.listPrimitives().length}p ${Math.round(m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() || 0) / 3, 0))}t]` : '', n.getTranslation().map((v) => v.toFixed(2)).join(',')); n.listChildren().forEach((c) => walk(c, dep + 1)); };
  d.getRoot().listScenes()[0].listChildren().forEach((n) => walk(n, 0));
}
