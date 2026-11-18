import { validateRubble, type RubbleSpec } from './rubble';
/** Editable style catalogs (public/data/styles/*.json): loaded at runtime, validated, first-match selection, hot reload in dev. */
export type RGB = [number, number, number];
export interface Match { kinds?: string[]; minHeight?: number; maxHeight?: number; minArea?: number; maxArea?: number; minAbsLat?: number; maxAbsLat?: number; minElev?: number; maxElev?: number; cover?: string[]; classes?: string[]; minLength?: number; maxLength?: number }
export interface BuildingStyle {
  id: string; match: Match; palette: RGB[]; roofPalette: RGB[];
  roof: { shape: 'flat' | 'gable' | 'dome' | 'setback'; at?: number; inset?: number; maxArea?: number; textures?: string[]; tint?: RGB[] };
  facade: { pattern: 'house' | 'office' | 'glass' | 'blank'; floorHeight?: number; windowPitch?: number; textures?: string[]; scale?: number };
  groundFloor?: { height: number; pattern: 'house' | 'office' | 'glass' | 'blank'; palette: RGB[]; texture?: string };
  rooftop?: boolean; variation?: number;
}
/** A texture of public/textures/city: `mu`/`mv` = real-world metres covered by one repeat (u along the wall/x, v up/y). `night` = lit-window variant. */
export interface TextureDef { file: string; night?: string; mu: number; mv: number }
export interface TreeSpecies { file: string; nativeHeight: number }
export interface TreeRule { id: string; match: Match; mix: { species: string; weight: number }[]; density: number; height: [number, number]; /** horizontal crown widening (default 1) */ crown?: number }
export interface RoadProfile { width?: number; lanes?: number; laneWidth?: number; shoulder?: number; fill: string; casing?: string; marking?: 'dashed' | 'none'; edges?: boolean; unpaved?: boolean; rails?: boolean; sidewalk?: { width: number; color: string } }
export interface BridgeStyle { id: string; match: Match; girder: number; parapet: number; pierSpacing: number; pierWidth: number; deck: RGB; concrete: RGB; margin: number }
export interface InfraStyle { id: string; match: { kinds?: string[] }; shape: 'mast' | 'box'; height: number; width: number; top?: number; color: RGB }
export interface WaterStyle { areas: Record<string, { color: string }>; waterways: Record<string, { width: number; color: string }> }
export interface Styles {
  textures: Record<string, TextureDef>;
  buildings: BuildingStyle[]; species: Record<string, TreeSpecies>; trees: TreeRule[];
  roads: { default: RoadProfile; classes: Record<string, RoadProfile> }; bridges: BridgeStyle[]; infra: InfraStyle[]; water: WaterStyle;
  /** Rubble of destroyed buildings (styles/rubble.json). */
  rubble: RubbleSpec;
}

const FILES = ['buildings', 'trees', 'roads', 'bridges', 'water', 'infra', 'rubble'] as const;
const isRGB = (c: unknown): c is RGB => Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === 'number' && v >= 0 && v <= 255);
const fail = (f: string, m: string): never => { throw new Error(`styles/${f}.json: ${m}`); };
const needPalette = (f: string, id: string, p: unknown) => { if (!Array.isArray(p) || !p.length || !p.every(isRGB)) fail(f, `${id}: palette must be a non-empty list of [r,g,b]`); };
const catchAll = (f: string, l: { match: object }[]) => { if (!l.length || Object.keys(l[l.length - 1].match).length) fail(f, 'last pattern must be a catch-all (match: {})'); };

export function validate(raw: Record<(typeof FILES)[number], any>): Styles {
  const b = raw.buildings, t = raw.trees, r = raw.roads, br = raw.bridges, w = raw.water, i = raw.infra;
  const rub = validateRubble(raw.rubble);
  for (const [f, v] of Object.entries(raw)) if (v?.version !== 1) fail(f, 'unsupported or missing version (expected 1)');
  if (!Array.isArray(b.patterns)) fail('buildings', 'patterns must be a list');
  for (const p of b.patterns as BuildingStyle[]) {
    if (!p.id || !p.match || !p.roof || !p.facade) fail('buildings', `${p.id ?? '?'}: id/match/roof/facade required`);
    needPalette('buildings', p.id, p.palette); needPalette('buildings', p.id, p.roofPalette);
    if (!['flat', 'gable', 'dome', 'setback'].includes(p.roof.shape)) fail('buildings', `${p.id}: unknown roof shape ${p.roof.shape}`);
    if (!['house', 'office', 'glass', 'blank'].includes(p.facade.pattern)) fail('buildings', `${p.id}: unknown facade pattern ${p.facade.pattern}`);
    if (p.groundFloor) needPalette('buildings', p.id, p.groundFloor.palette);
  }
  const tx = (b.textures ?? {}) as Record<string, TextureDef>;
  for (const [id, d] of Object.entries(tx)) if (!d.file || !(d.mu > 0) || !(d.mv > 0)) fail('buildings', `texture ${id}: file/mu/mv required`);
  const need = (p: string, id?: string) => { if (id && !tx[id]) fail('buildings', `${p}: unknown texture ${id}`); };
  for (const p of b.patterns as BuildingStyle[]) { p.facade.textures?.forEach((t) => need(p.id, t)); p.roof.textures?.forEach((t) => need(p.id, t)); need(p.id, p.groundFloor?.texture); }
  catchAll('buildings', b.patterns);
  if (!t.species || !Array.isArray(t.rules)) fail('trees', 'species and rules required');
  for (const ru of t.rules as TreeRule[]) {
    if (!ru.mix?.length || !(ru.density > 0) || ru.height?.length !== 2) fail('trees', `${ru.id}: mix/density/height required`);
    for (const m of ru.mix) if (!t.species[m.species]) fail('trees', `${ru.id}: unknown species ${m.species}`);
  }
  catchAll('trees', t.rules);
  if (!r.default || !r.classes) fail('roads', 'default and classes required');
  if (!Array.isArray(br.patterns)) fail('bridges', 'patterns must be a list');
  catchAll('bridges', br.patterns);
  if (!w.areas || !w.waterways) fail('water', 'areas and waterways required');
  if (!Array.isArray(i.patterns)) fail('infra', 'patterns must be a list');
  catchAll('infra', i.patterns);
  return { textures: tx, buildings: b.patterns, species: t.species, trees: t.rules, roads: { default: r.default, classes: r.classes }, bridges: br.patterns, infra: i.patterns, water: { areas: w.areas, waterways: w.waterways }, rubble: rub };
}

/** Facts about an object that rules can test. */
export interface Facts { kind?: string; height?: number; area?: number; absLat?: number; elev?: number; cover?: string; cls?: string; length?: number }
export function matches(m: Match, f: Facts): boolean {
  if (m.kinds && !(f.kind && m.kinds.some((k) => f.kind!.includes(k)))) return false;
  if (m.cover && !(f.cover && m.cover.includes(f.cover))) return false;
  if (m.classes && !(f.cls && m.classes.includes(f.cls))) return false;
  const rng = (v: number | undefined, lo?: number, hi?: number) => (lo === undefined || (v !== undefined && v >= lo)) && (hi === undefined || (v !== undefined && v <= hi));
  return rng(f.height, m.minHeight, m.maxHeight) && rng(f.area, m.minArea, m.maxArea) && rng(f.absLat, m.minAbsLat, m.maxAbsLat) && rng(f.elev, m.minElev, m.maxElev) && rng(f.length, m.minLength, m.maxLength);
}
export const pickStyle = <T extends { match: Match }>(list: T[], f: Facts): T => list.find((p) => matches(p.match, f)) ?? list[list.length - 1];

/** Resolved road width in metres. */
export const roadWidth = (p: RoadProfile): number => p.width ?? (p.lanes ?? 2) * (p.laneWidth ?? 3.3) + (p.shoulder ?? 0.6) * 2;

let current: Styles | null = null, loading: Promise<Styles> | null = null;
const listeners = new Set<(s: Styles) => void>();
export const styles = (): Styles | null => current;
export const onStylesChange = (fn: (s: Styles) => void) => { listeners.add(fn); return () => listeners.delete(fn); };

async function fetchAll(): Promise<{ s: Styles; sig: string }> {
  const bodies = await Promise.all(FILES.map(async (f) => {
    const r = await fetch(new URL(`data/styles/${f}.json`, document.baseURI), { cache: 'no-cache' });
    if (!r.ok) throw new Error(`styles/${f}.json: HTTP ${r.status}`);
    return [f, await r.text()] as const;
  }));
  const raw = Object.fromEntries(bodies.map(([f, t]) => [f, JSON.parse(t)])) as Record<(typeof FILES)[number], unknown>;
  return { s: validate(raw as never), sig: bodies.map(([, t]) => t).join('\u0000') };
}
let lastSig = '';
/** Load (once) and validate the catalogs. Rejects when a file is missing or invalid (the layer then stays off). */
export function loadStyles(): Promise<Styles> {
  return (loading ??= fetchAll().then(({ s, sig }) => { current = s; lastSig = sig; return s; }).catch((e) => { loading = null; throw e; }));
}
/** Re-read the catalogs; when something changed (or `force`) listeners regenerate the visible tiles. An invalid edit keeps the previous catalog. */
export async function reloadStyles(force = false): Promise<boolean> {
  try {
    const { s, sig } = await fetchAll();
    if (!force && sig === lastSig) return false;
    current = s; lastSig = sig; listeners.forEach((f) => f(s));
    return true;
  } catch (e) { console.warn('[city3d] style reload rejected:', (e as Error).message); return false; }
}
