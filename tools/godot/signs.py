"""Road-sign atlas (Belgian / Vienna-convention shapes and colours) drawn from scratch: 256 x 256 cells, RGBA.
Order = sign index used by godot/scripts/world/sign_field.gd SIGNS.
  python tools/godot/signs.py godot/assets/signs/signs.png
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFont

RED = (200, 16, 30, 255)
WHITE = (250, 250, 250, 255)
BLACK = (20, 20, 20, 255)
BLUE = (0, 76, 152, 255)
YELLOW = (250, 196, 0, 255)
S = 256
SIGNS = ['stop', 'give_way', 'speed30', 'speed50', 'speed70', 'speed90', 'speed120', 'crossing', 'priority', 'no_entry']


def font(size):
    for f in ('arialbd.ttf', 'DejaVuSans-Bold.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def text(d, s, size, fill, y=S / 2):
    f = font(size)
    b = d.textbbox((0, 0), s, font=f)
    d.text(((S - (b[2] - b[0])) / 2 - b[0], y - (b[3] - b[1]) / 2 - b[1]), s, font=f, fill=fill)


def cell(name):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    if name == 'stop':
        r = 124
        pts = [(c + r * math.cos(math.radians(22.5 + 45 * k)), c + r * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]
        d.polygon(pts, fill=WHITE)
        r2 = 112
        d.polygon([(c + r2 * math.cos(math.radians(22.5 + 45 * k)), c + r2 * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)], fill=RED)
        text(d, 'STOP', 74, WHITE)
    elif name == 'give_way':
        d.polygon([(6, 14), (S - 6, 14), (c, S - 10)], fill=RED)
        d.polygon([(46, 38), (S - 46, 38), (c, S - 66)], fill=WHITE)
    elif name.startswith('speed'):
        d.ellipse((4, 4, S - 4, S - 4), fill=RED)
        d.ellipse((34, 34, S - 34, S - 34), fill=WHITE)
        v = name[5:]
        text(d, v, 104 if len(v) < 3 else 82, BLACK)
    elif name == 'crossing':
        d.rectangle((8, 8, S - 8, S - 8), fill=BLUE)
        d.polygon([(c, 34), (S - 34, S - 40), (34, S - 40)], fill=WHITE)
        # walking figure and zebra bars
        for k in range(4):
            x = 78 + k * 28
            d.rectangle((x, S - 70, x + 14, S - 52), fill=BLACK)
        d.ellipse((c - 12, 78, c + 12, 102), fill=BLACK)
        d.line([(c, 104), (c - 4, 150)], fill=BLACK, width=12)
        d.line([(c - 4, 148), (c - 26, 180)], fill=BLACK, width=10)
        d.line([(c - 4, 148), (c + 20, 178)], fill=BLACK, width=10)
        d.line([(c - 2, 116), (c - 26, 138)], fill=BLACK, width=8)
        d.line([(c - 2, 116), (c + 24, 132)], fill=BLACK, width=8)
    elif name == 'priority':
        d.polygon([(c, 4), (S - 4, c), (c, S - 4), (4, c)], fill=WHITE)
        d.polygon([(c, 34), (S - 34, c), (c, S - 34), (34, c)], fill=YELLOW)
    elif name == 'no_entry':
        d.ellipse((4, 4, S - 4, S - 4), fill=RED)
        d.rectangle((40, c - 22, S - 40, c + 22), fill=WHITE)
    return im


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    atlas = Image.new('RGBA', (S * len(SIGNS), S), (0, 0, 0, 0))
    for i, n in enumerate(SIGNS):
        atlas.paste(cell(n), (i * S, 0))
    atlas.save(out)
    print('signs', len(SIGNS), out)
