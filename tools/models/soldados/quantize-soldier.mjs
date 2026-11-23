// Light-weight pass for the exported soldiers: weld + quantize the vertex attributes (KHR_mesh_quantization), keeps skin and clips.
//   node tools/models/soldados/quantize-soldier.mjs <in.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { weld, quantize, prune, dedup } from '@gltf-transform/functions';
const [, , inp, out] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
await doc.transform(weld(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 14, quantizeWeight: 8, quantizeColor: 8 }), prune(), dedup());
await io.write(out, doc);
