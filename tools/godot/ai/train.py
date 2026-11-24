"""Trains RoadNet on synthetic strips (exact labels) with real ortho textures as surroundings.

  <venv python> train.py --out <dir> [--steps 20000] [--bg <dir of real strip .npy>]
Writes <out>/roadnet.pt (best on the synthetic validation set) and a log. Validation also renders a few real
strips (if --real given) so the result can be checked by eye against the photo.
"""
import argparse, os, time
import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import IterableDataset, DataLoader

import synth
from model import RoadNet

# class weights: thin marks are rare pixels but what matters
WEIGHTS = torch.tensor([0.5, 0.5, 4.0, 4.0, 3.0, 4.0, 4.0, 3.0, 3.0, 1.0])


class Synthetic(IterableDataset):
    def __init__(self, bgs, seed):
        self.bgs, self.seed = bgs, seed

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        rng = np.random.default_rng(self.seed + (info.id if info else 0) * 7919 + int(time.time()))
        while True:
            x, y = synth.make(rng, backgrounds=self.bgs)
            if rng.random() < 0.5:
                x, y = x[::-1], y[::-1]             # driving direction
            if rng.random() < 0.5:
                x, y = x[:, ::-1], y[:, ::-1]       # left / right
            yield torch.from_numpy(np.ascontiguousarray(x.transpose(2, 0, 1))), torch.from_numpy(np.ascontiguousarray(y)).long()


def load_bgs(d):
    if not d or not os.path.isdir(d):
        return None
    out = []
    for f in sorted(os.listdir(d)):
        if f.endswith('.npy'):
            a = np.load(os.path.join(d, f)).astype(np.float32) / 255
            if a.shape[0] >= 256 and a.shape[1] >= 160:
                out.append(a)
    return out


def miou(conf):
    inter = np.diag(conf)
    union = conf.sum(0) + conf.sum(1) - inter
    return inter / np.maximum(union, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--steps', type=int, default=20000)
    ap.add_argument('--data', required=True, help='dir of pregen.py shards')
    ap.add_argument('--init', default=None, help='weights to start from (fine-tune)')
    ap.add_argument('--lr', type=float, default=3e-3)
    ap.add_argument('--batch', type=int, default=32)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    # pre-generated shards (pregen.py) kept in RAM as uint8; the last shard is the validation set
    files = sorted(f for f in os.listdir(args.data) if f.endswith('.npz'))
    shards = [np.load(os.path.join(args.data, f)) for f in files]
    X = torch.from_numpy(np.concatenate([s['x'] for s in shards[:-1]]))
    Y = torch.from_numpy(np.concatenate([s['y'] for s in shards[:-1]]))
    vx = torch.from_numpy(shards[-1]['x'][:256]).permute(0, 3, 1, 2).float().div(255).to(dev)
    vy = shards[-1]['y'][:256]
    print('device', dev, 'train', len(X), 'val', len(vy), flush=True)
    g = torch.Generator().manual_seed(1)

    def batches():
        while True:
            idx = torch.randint(0, len(X), (args.batch,), generator=g)
            x = X[idx].to(dev, non_blocking=True).permute(0, 3, 1, 2).float().div(255)
            y = Y[idx].to(dev, non_blocking=True).long()
            if torch.rand(1, generator=g).item() < 0.5:
                x, y = x.flip(2), y.flip(1)
            if torch.rand(1, generator=g).item() < 0.5:
                x, y = x.flip(3), y.flip(2)
            # brightness / contrast jitter per sample
            x = (x - 0.5) * (0.8 + 0.4 * torch.rand(len(x), 1, 1, 1, device=dev)) + 0.5 + 0.08 * (torch.rand(len(x), 1, 1, 1, device=dev) - 0.5)
            yield x.clamp(0, 1), y
    net = RoadNet().to(dev)
    if args.init:
        net.load_state_dict(torch.load(args.init, map_location=dev))
        print('init from', args.init, flush=True)
    opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.steps, pct_start=0.05)
    scaler = torch.amp.GradScaler(enabled=dev == 'cuda')
    wts = WEIGHTS.to(dev)
    best = -1
    t0 = time.time()
    it = batches()
    for step in range(1, args.steps + 1):
        x, y = next(it)
        with torch.autocast(dev, enabled=dev == 'cuda'):
            out = net(x)
            loss = F.cross_entropy(out.float(), y, weight=wts)
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.step(opt)
        scaler.update()
        sched.step()
        if step % 500 == 0 or step == args.steps:
            net.eval()
            with torch.no_grad():
                pred = torch.cat([net(vx[i:i + 32]).argmax(1) for i in range(0, len(vx), 32)]).cpu().numpy()
            net.train()
            conf = np.bincount(vy.ravel() * 10 + pred.ravel(), minlength=100).reshape(10, 10)
            iou = miou(conf)
            marks = float(iou[2:9].mean())
            msg = f'step {step} loss {loss.item():.3f} mIoU {iou.mean():.3f} marks {marks:.3f} ' + \
                  ' '.join(f'{c}:{v:.2f}' for c, v in zip(synth.CLASSES, iou)) + f' {time.time() - t0:.0f}s'
            print(msg, flush=True)
            if marks > best:
                best = marks
                torch.save(net.state_dict(), os.path.join(args.out, 'roadnet.pt'))
    print('best marks mIoU', best)


if __name__ == '__main__':
    main()
