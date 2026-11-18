/** One shared texture atlas (day + night) with every facade / roof texture of the style catalog: loaded once, every building shares it. */
import type { Styles } from './styles';

export const CELL = 256, COLS = 6;
export interface AtlasCell { byte: number; mu: number; mv: number }
export interface Atlas { sig: string; cells: Map<string, AtlasCell>; rows: number; day: HTMLCanvasElement; night: HTMLCanvasElement }

async function img(file: string): Promise<ImageBitmap> {
  const r = await fetch(new URL(`textures/city/${file}.jpg`, document.baseURI));
  if (!r.ok) throw new Error(`textures/city/${file}.jpg ${r.status}`);
  return createImageBitmap(await r.blob());
}
const cache = new Map<string, Promise<ImageBitmap>>();
const load = (f: string) => cache.get(f) ?? (cache.set(f, img(f)), cache.get(f)!);

/** Scales a day cell so every texture has the same mean brightness (the photographs range from 0.2 to 0.65): the style's tint then decides the final tone. */
function normalize(g: CanvasRenderingContext2D, x: number, y: number, target: number) {
  const im = g.getImageData(x, y, CELL, CELL), d = im.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
  const k = Math.min(3.2, target / Math.max(0.05, sum / (d.length / 4)));
  const mean = target * 255, c = 0.92; // also soften the contrast a little: the fine window grids alias into moire from afar
  for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) d[i + j] = Math.min(255, Math.max(0, mean + (d[i + j] * k - mean) * c));
  g.putImageData(im, x, y);
}

let current: { sig: string; p: Promise<Atlas | null> } | null = null;
/** Build (once per texture catalog) the atlas; resolves null when the files are unavailable (buildings then use the procedural facade). */
export function loadAtlas(st: Styles): Promise<Atlas | null> {
  const ids = Object.keys(st.textures);
  const sig = JSON.stringify(st.textures);
  if (current?.sig === sig) return current.p;
  const p = (async (): Promise<Atlas | null> => {
    if (!ids.length || ids.length > COLS * 10 || typeof document === 'undefined') return null;
    const rows = Math.ceil(ids.length / COLS), mk = () => { const c = document.createElement('canvas'); c.width = COLS * CELL; c.height = rows * CELL; return c; };
    const day = mk(), night = mk(), dctx = day.getContext('2d')!, nctx = night.getContext('2d')!, cells = new Map<string, AtlasCell>();
    dctx.imageSmoothingQuality = nctx.imageSmoothingQuality = 'high';
    try {
      await Promise.all(ids.map(async (id, i) => {
        const d = st.textures[id], x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
        const a = await load(d.file), b = d.night ? await load(d.night) : a;
        dctx.drawImage(a, x, y, CELL, CELL); nctx.drawImage(b, x, y, CELL, CELL);
        normalize(dctx, x, y, id.startsWith('roof') ? 0.62 : 0.7);
        cells.set(id, { byte: i + 1, mu: d.mu, mv: d.mv });
      }));
    } catch (e) { console.warn('[city3d] textures unavailable, procedural facades used:', (e as Error).message); return null; }
    return { sig, cells, rows, day, night };
  })();
  current = { sig, p };
  return p;
}
