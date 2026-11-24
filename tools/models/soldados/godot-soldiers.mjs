// Copies the near soldiers to the Godot project without KHR_mesh_quantization (Godot 4.7 cannot read it).
// Run from a folder with @gltf-transform/{core,extensions,functions}@4 installed:
//   node godot-soldiers.mjs <repo>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
const src = join(repo, 'public/models/near');
const out = join(repo, 'godot/assets/soldiers');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of readdirSync(src).filter((n) => /^nsoldier.*\.glb$/.test(n))) {
  const doc = await io.read(join(src, f));
  await doc.transform(dequantize());
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'KHR_mesh_quantization') e.dispose();
  await io.write(join(out, f), doc);
  console.log(f, (statSync(join(out, f)).size / 1e6).toFixed(2), 'MB');
}
