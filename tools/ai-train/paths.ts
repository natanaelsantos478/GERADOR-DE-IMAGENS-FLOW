import { fileURLToPath } from 'node:url';
const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
export const ckpt = (name: string) => at(`./ckpt/${name}`);
export const logs = (name: string) => at(`./logs/${name}`);
export const POLICY_OUT = at('../../public/data/ai/policy.json');
