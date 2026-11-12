/**
 * Save/load: JSON ⇄ bytes (gzip via CompressionStream when available), IndexedDB slots and
 * export/import of save files. `encodeSave`/`decodeSave` also run in Node 22 (tests).
 */
import type { Game, SaveFile } from '../core/game';

const GZIP_MAGIC0 = 0x1f, GZIP_MAGIC1 = 0x8b;

async function pipeBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** Serialises a save to bytes; gzip when the platform supports CompressionStream. */
export async function encodeSave(save: SaveFile): Promise<{ bytes: Uint8Array; compressed: boolean }> {
  const json = new TextEncoder().encode(JSON.stringify(save));
  if (!canCompress()) return { bytes: json, compressed: false };
  return { bytes: await pipeBytes(json, new CompressionStream('gzip')), compressed: true };
}

/** Accepts gzip or plain JSON bytes (auto-detected) and returns the parsed object (not yet validated). */
export async function decodeSave(bytes: Uint8Array): Promise<unknown> {
  let raw = bytes;
  if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC0 && bytes[1] === GZIP_MAGIC1) {
    if (!canCompress()) throw new Error('Este navegador não descompacta saves gzip');
    raw = await pipeBytes(bytes, new DecompressionStream('gzip'));
  }
  return JSON.parse(new TextDecoder().decode(raw));
}

// ---------------------------------------------------------------- IndexedDB slots

export interface SaveSlotInfo {
  name: string;
  /** Wall-clock ms when saved (UI metadata only; not simulation state). */
  savedAt: number;
  hours: number;
  playerCountryId: string;
  sizeBytes: number;
  compressed: boolean;
}
interface SaveRecord extends SaveSlotInfo {
  bytes: ArrayBuffer;
}

const DB_NAME = 'meridiano';
const STORE = 'saves';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponível'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('falha ao abrir IndexedDB'));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      let result: T;
      req.onsuccess = () => (result = req.result);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error ?? req.error ?? new Error('falha na transação IndexedDB'));
      t.onabort = () => reject(t.error ?? new Error('transação IndexedDB abortada'));
    });
  } finally {
    db.close();
  }
}

export async function saveToSlot(name: string, game: Game): Promise<SaveSlotInfo> {
  const save = game.serialize();
  const { bytes, compressed } = await encodeSave(save);
  const rec: SaveRecord = {
    name,
    savedAt: Date.now(),
    hours: save.hours,
    playerCountryId: save.playerCountryId,
    sizeBytes: bytes.byteLength,
    compressed,
    bytes: bytes.slice().buffer,
  };
  await tx('readwrite', (s) => s.put(rec));
  const { bytes: _b, ...info } = rec;
  return info;
}

export async function listSaves(): Promise<SaveSlotInfo[]> {
  const all = await tx<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
  return all.map(({ bytes: _b, ...info }) => info).sort((a, b) => b.savedAt - a.savedAt);
}

/** Loads a slot into an existing game (validates version/dataHash). */
export async function loadFromSlot(name: string, game: Game): Promise<void> {
  const rec = await tx<SaveRecord | undefined>('readonly', (s) => s.get(name) as IDBRequest<SaveRecord | undefined>);
  if (!rec) throw new Error(`Save '${name}' não encontrado`);
  game.hydrate(await decodeSave(new Uint8Array(rec.bytes)));
}

export async function deleteSave(name: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(name));
}

// ---------------------------------------------------------------- files

/** Downloads the current game as `<name>.meridiano.json.gz` (or `.json` without CompressionStream). */
export async function exportSaveFile(game: Game, baseName = 'meridiano'): Promise<string> {
  const { bytes, compressed } = await encodeSave(game.serialize());
  const fileName = `${baseName}.meridiano.json${compressed ? '.gz' : ''}`;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: compressed ? 'application/gzip' : 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return fileName;
}

/** Reads a save file chosen by the user and loads it into the game. */
export async function importSaveFile(file: Blob, game: Game): Promise<void> {
  game.hydrate(await decodeSave(new Uint8Array(await file.arrayBuffer())));
}
