import { Pool } from './pool';
import { loadWorldStatic } from '../../src/data/loadWorld';
import { nodeFetchJson } from '../../src/data/fetchNode';
import { stageTac } from './stage-tac';
const world = await loadWorldStatic(nodeFetchJson());
const pool = new Pool(4);
const mins = Number(process.argv[2] ?? 20);
await stageTac(pool, world, Date.now() + mins * 60000, 4, 1);
await pool.close();
