"""Runs RoadNet on held-out real strips and writes a sheet: photo | what the network recognised (colours per class).

  <venv python> eval_real.py <weights.pt> <real test dir> <out.png> [n=10]
"""
import os, sys, time
import numpy as np
import torch
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import synth
from model import RoadNet


def main(wts, test_dir, out, n=10):
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    net = RoadNet().to(dev).eval()
    net.load_state_dict(torch.load(wts, map_location=dev))
    files = sorted(f for f in os.listdir(test_dir) if f.endswith('.npy'))
    # pick strips with paint (bright thin structures) so the sheet is informative
    rng = np.random.default_rng(3)
    cand = [files[i] for i in rng.permutation(len(files))]
    imgs = []
    for f in cand:
        a = np.load(os.path.join(test_dir, f))
        if (a[:, 40:120].mean(-1) > 200).mean() > 0.01:
            imgs.append((f, a))
        if len(imgs) >= n:
            break
    x = torch.from_numpy(np.stack([a for _, a in imgs])).permute(0, 3, 1, 2).float().div(255).to(dev)
    t = time.time()
    with torch.no_grad():
        pred = net(x).argmax(1).cpu().numpy()
    print('inference %d strips %.3fs' % (len(imgs), time.time() - t))
    import vectorize
    rows = []
    for (f, a), p in zip(imgs, pred):
        model = vectorize.build(p.astype(np.uint8))
        clean = vectorize.render(model, *p.shape)
        rows.append(np.vstack([np.rot90(a), np.rot90(synth.colour(p)), np.rot90(clean), np.full((6, 256, 3), 255, np.uint8)]))
    sheet = np.vstack(rows)
    im = Image.fromarray(sheet)
    leg = Image.new('RGB', (256, 14 * len(synth.CLASSES)), 'white')
    d = ImageDraw.Draw(leg)
    for i, c in enumerate(synth.CLASSES):
        d.rectangle((2, i * 14 + 2, 12, i * 14 + 12), fill=tuple(int(v) for v in synth.PALETTE[i]), outline='black')
        d.text((16, i * 14 + 1), c, fill='black')
    W = Image.new('RGB', (im.width + leg.width + 8, max(im.height, leg.height)), 'white')
    W.paste(im, (0, 0))
    W.paste(leg, (im.width + 8, 0))
    W.save(out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 10)
