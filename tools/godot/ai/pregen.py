"""Generates the synthetic training set once, in parallel, into uint8 shards (the GPU no longer waits for data).

  python pregen.py <out dir> <bg dir> [samples=24000] [processes=12]
"""
import os, sys
from multiprocessing import Pool
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import synth

_BGS = None
SHARD = 1000


def _init(bg_dir):
    global _BGS
    files = sorted(f for f in os.listdir(bg_dir) if f.endswith('.npy'))[::2]   # half of them is plenty
    _BGS = [np.load(os.path.join(bg_dir, f)).astype(np.float32) / 255 for f in files]


def _shard(args):
    out, k = args
    rng = np.random.default_rng(1000 + k)
    xs = np.zeros((SHARD, 256, 160, 3), np.uint8)
    ys = np.zeros((SHARD, 256, 160), np.uint8)
    for i in range(SHARD):
        x, y = synth.make(rng, backgrounds=_BGS)
        xs[i] = (x * 255).astype(np.uint8)
        ys[i] = y
    np.savez(os.path.join(out, f'shard_{k:03d}.npz'), x=xs, y=ys)
    return k


if __name__ == '__main__':
    out, bg = sys.argv[1], sys.argv[2]
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 24000
    procs = int(sys.argv[4]) if len(sys.argv) > 4 else 12
    os.makedirs(out, exist_ok=True)
    todo = [(out, k) for k in range(n // SHARD) if not os.path.exists(os.path.join(out, f'shard_{k:03d}.npz'))]
    with Pool(procs, initializer=_init, initargs=(bg,)) as p:
        for k in p.imap_unordered(_shard, todo):
            print('shard', k, flush=True)
