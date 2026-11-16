/** Shrinks the output layer of nets (keeps ES-found directions but limits how far the policy departs from the rules). Usage: scale-pack.ts IN OUT strat=0.3 opGoal=0.5 ... */
import { readFileSync, writeFileSync } from 'node:fs';
import type { PolicyPack } from '../../src/sim/neural/pack';
import { paramCount } from '../../src/sim/neural/mlp';
const [inp, out, ...kv] = process.argv.slice(2);
const pack = JSON.parse(readFileSync(inp, 'utf8')) as PolicyPack;
for (const a of kv) {
  const [name, f] = a.split('=');
  const net = (pack.nets as Record<string, { sizes: number[]; w: number[] }>)[name];
  if (!net) continue;
  const L = net.sizes.length - 2, nin = net.sizes[L], nout = net.sizes[L + 1], start = net.w.length - (nin * nout + nout);
  for (let i = start; i < net.w.length; i++) net.w[i] = Math.round(net.w[i] * Number(f) * 1e5) / 1e5;
}
void paramCount;
writeFileSync(out, JSON.stringify(pack));
