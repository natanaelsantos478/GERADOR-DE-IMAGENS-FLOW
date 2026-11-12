/**
 * WebAudio manager: music by state with crossfade, UI/notification/world sounds, three volume buses.
 * `playSound(id, {lon,lat}?)` is the entry point for the render modules; positional sounds are
 * attenuated by the distance from the camera. Silent (no throw) until the browser allows audio.
 */
import { getGlobe } from '../render/globe/registry';

interface Entry { file: string; loop?: boolean }
export type MusicState = 'menu' | 'peace' | 'war' | null;
const MUSIC: Record<Exclude<MusicState, null>, string> = { menu: 'music_menu', peace: 'music_peace_1', war: 'music_war_1' };

let ctx: AudioContext | null = null;
let master: GainNode, musicBus: GainNode, sfxBus: GainNode;
let manifest: Record<string, Entry> | null = null;
let manifestP: Promise<void> | null = null;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
const vol = { master: 0.8, music: 0.5, sfx: 0.8 };
let wantMusic: MusicState = null;
let curMusic: { id: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
const lastPlayed = new Map<string, number>();

const base = () => new URL('audio/', document.baseURI).href;

function applyVolumes() {
  if (!ctx) return;
  master.gain.setTargetAtTime(vol.master, ctx.currentTime, 0.05);
  musicBus.gain.setTargetAtTime(vol.music, ctx.currentTime, 0.05);
  sfxBus.gain.setTargetAtTime(vol.sfx, ctx.currentTime, 0.05);
}
export function setVolumes(v: Partial<typeof vol>) {
  Object.assign(vol, v);
  applyVolumes();
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  musicBus = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus.connect(master);
  sfxBus.connect(master);
  master.connect(ctx.destination);
  applyVolumes();
  return ctx;
}

async function loadManifest() {
  manifestP ??= fetch(`${base()}manifest.json`)
    .then((r) => r.json())
    .then((m: Record<string, Entry>) => { manifest = m; })
    .catch(() => { manifest = {}; });
  await manifestP;
}

function load(id: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(id);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(id);
  if (!p) {
    p = (async () => {
      await loadManifest();
      const e = manifest?.[id];
      const c = ensureCtx();
      if (!e || !c) return null;
      try {
        const res = await fetch(base() + e.file);
        const buf = await c.decodeAudioData(await res.arrayBuffer());
        buffers.set(id, buf);
        return buf;
      } catch {
        return null;
      }
    })();
    loading.set(id, p);
  }
  return p;
}

/** Call from the first user gesture (the UI does this on pointerdown/keydown). */
export function unlockAudio() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') void c.resume().then(() => applyMusic());
  else applyMusic();
}

function distGain(lon: number, lat: number): number {
  const cam = getGlobe()?.cameraState();
  if (!cam) return 1;
  const rad = Math.PI / 180;
  const dLat = (lat - cam.lat) * rad, dLon = (lon - cam.lon) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(cam.lat * rad) * Math.cos(lat * rad) * Math.sin(dLon / 2) ** 2;
  const surfKm = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  const hKm = cam.height / 1000;
  const d3 = Math.hypot(surfKm, hKm);
  const r = Math.max(0, 1 - d3 / (hKm * 3 + 300));
  return r * r;
}

/** Plays a one-shot (or ambient loop) by manifest id. Returns a stop function. */
export function playSound(id: string, opts?: { lon?: number; lat?: number; volume?: number }): () => void {
  const noop = () => {};
  let g = opts?.volume ?? 1;
  if (opts?.lon !== undefined && opts.lat !== undefined) g *= distGain(opts.lon, opts.lat);
  if (g < 0.02 || !ctx || ctx.state !== 'running') {
    if (!ctx) void load(id); // warms the cache once audio is allowed
    return noop;
  }
  // Rate-limit identical sounds (battle spam).
  const now = performance.now();
  if (now - (lastPlayed.get(id) ?? -1e9) < 60) return noop;
  lastPlayed.set(id, now);
  let stopped = false;
  let node: AudioBufferSourceNode | null = null;
  void load(id).then((buf) => {
    if (!buf || stopped || !ctx) return;
    node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop = !!manifest?.[id]?.loop;
    const gn = ctx.createGain();
    gn.gain.value = g;
    node.connect(gn).connect(sfxBus);
    node.start();
  });
  return () => { stopped = true; try { node?.stop(); } catch { /* already ended */ } };
}

function applyMusic() {
  const c = ctx;
  if (!c || c.state !== 'running') return;
  const id = wantMusic ? MUSIC[wantMusic] : null;
  if (curMusic?.id === id) return;
  const old = curMusic;
  curMusic = null;
  if (old) {
    old.gain.gain.setTargetAtTime(0, c.currentTime, 0.8);
    setTimeout(() => { try { old.src.stop(); } catch { /* ended */ } }, 4000);
  }
  if (!id) return;
  void load(id).then((buf) => {
    if (!buf || wantMusic === null || MUSIC[wantMusic] !== id || !ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(musicBus);
    src.start();
    gain.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    curMusic = { id, src, gain };
  });
}
export function setMusic(state: MusicState) {
  wantMusic = state;
  applyMusic();
}
