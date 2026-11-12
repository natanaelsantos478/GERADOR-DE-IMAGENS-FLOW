import type * as Cesium from 'cesium';
import type { BBox, CountryId, LonLat, ProvinceId } from '../../core/contracts';
import type { Game } from '../../core/game';

export type RGBA = [number, number, number, number];

/** What the pointer found. `feature` is a point object (city, plant, formation…), if any. */
export interface PickFeature {
  /** 'city' | 'plant' | 'airport' | 'port' | 'capital' | 'country' | external kinds ('formation', …). */
  kind: string;
  id: string | number;
  /** Dataset index for static infrastructure (key of WorldDyn damage maps). */
  index?: number;
  data?: unknown;
}
export interface PickResult {
  /** Ground position under the pointer; null when the pointer is over the sky. */
  lonLat: LonLat | null;
  provinceId: ProvinceId | null;
  countryId: CountryId | null;
  feature?: PickFeature;
}

export interface PointerInfo {
  x: number;
  y: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  pick: PickResult;
}
export interface BoxInfo {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}
export interface GlobeEvents {
  click: PointerInfo;
  rightclick: PointerInfo;
  doubleclick: PointerInfo;
  hover: PointerInfo;
  /** Shift + left-drag rectangle (screen px, relative to the canvas). */
  box: BoxInfo;
}
export interface CameraState {
  lon: number;
  lat: number;
  /** Metres above the ellipsoid. */
  height: number;
  headingDeg: number;
  pitchDeg: number;
  /** Visible ground rectangle [w,s,e,n], or null when the whole globe is in view. */
  view: BBox | null;
}
export interface FlyOptions {
  durationS?: number;
  headingDeg?: number;
  /** −90 = straight down. */
  pitchDeg?: number;
  /** Height above ground in metres. */
  height?: number;
}

/** Resolves a Cesium picked object (`scene.pick(...)`) into a feature; return undefined if not yours. */
export type PickableResolver = (picked: { primitive?: unknown; id?: unknown }) => PickFeature | undefined;

export type LayerId =
  | 'fill'
  | 'countryBorders'
  | 'provinceBorders'
  | 'roads'
  | 'railways'
  | 'countryLabels'
  | 'cities'
  | 'cityLabels'
  | 'plants'
  | 'airports'
  | 'ports';

export interface LegendItem {
  color: string;
  label: string;
  labelKey?: string;
}
export interface Legend {
  title: string;
  titleKey?: string;
  items: LegendItem[];
}
/** Colour of one province in a map mode; `hatch` overrides the automatic occupation hatch. */
export interface ProvinceFill {
  color: RGBA;
}
export interface MapModeContext {
  game: Game | null;
  /** Owner country of the province (or the synthetic territory). */
  countryOf(provinceId: ProvinceId): CountryId | null;
}
export type BaseStyle = 'satellite' | 'relief' | 'shade';
export interface MapMode {
  id: string;
  label: string;
  labelKey?: string;
  /** Base layer under the fills: real imagery, tinted relief, or grey hill-shade. */
  base: BaseStyle;
  /** Fill opacity multiplier (default 1); fills are only drawn when `colorOfProvince` exists. */
  colorOfProvince?(provinceId: ProvinceId, ctx: MapModeContext): RGBA | null;
  /** Called once before a repaint (compute caches). */
  prepare?(ctx: MapModeContext): void;
  legend?: Legend | (() => Legend);
  /** False when the needed simulation system is not registered / no game is running. */
  available?(ctx: MapModeContext): boolean;
  /** Recolour when the game day changes. */
  dynamic?: boolean;
  /** Draw hatch over occupied provinces (default true). */
  hatchOccupation?: boolean;
}
export type MapModeDef = Omit<MapMode, 'id' | 'label' | 'base'> & Partial<Pick<MapMode, 'label' | 'base'>>;

export interface Minimap {
  /** Position/size it with CSS; it draws itself at its `width`×`height` attributes. */
  element: HTMLCanvasElement;
  setSize(w: number, h: number): void;
  /** Extra drawing on top (unit dots…): `project` maps lon/lat to canvas px. */
  addOverlay(fn: (g: CanvasRenderingContext2D, project: (lon: number, lat: number) => [number, number]) => void): () => void;
  redraw(): void;
}

export interface GlobeOptions {
  /** Current game (changes on new/load). Needed for dynamic map modes, damage and dynamic overlays. */
  getGame?: () => Game | null;
  language?: 'pt' | 'en';
  /** Sun lighting driven by the game clock (default false). */
  dayNight?: boolean;
  /** Render only on demand (default true). */
  requestRenderMode?: boolean;
  /** Resolution scale for the WebGL canvas (default devicePixelRatio, max 2). */
  resolutionScale?: number;
  keyboard?: boolean;
}

export interface Globe {
  readonly viewer: Cesium.Viewer;
  readonly minimap: Minimap;
  /** Shown credits (ESRI, EOX, Natural Earth, …) — also rendered in the Cesium credit bar. */
  readonly credits: string[];
  /** Name of the imagery provider currently on screen. */
  imageryProvider(): 'esri' | 'eox' | 'offline';

  flyTo(lon: number, lat: number, o?: FlyOptions): Promise<void>;
  flyToBBox(bbox: BBox, o?: FlyOptions): Promise<void>;
  /** Teleport (no animation). */
  setView(lon: number, lat: number, o?: FlyOptions): void;
  cameraState(): CameraState;
  /** Camera height above ellipsoid (m). */
  cameraHeight(): number;
  /** Fires (throttled) on every camera change; returns unsubscribe. */
  onCamera(cb: (s: CameraState) => void): () => void;

  pick(x: number, y: number): PickResult;
  registerPickable(resolver: PickableResolver): () => void;
  on<K extends keyof GlobeEvents>(type: K, cb: (e: GlobeEvents[K]) => void): () => void;

  setMapMode(id: string): boolean;
  currentMapMode(): string;
  registerMapMode(id: string, def: MapModeDef): void;
  mapModes(): { id: string; label: string; labelKey?: string; available: boolean; legend: Legend | null }[];
  /** Recolour the current mode now (e.g. after simulation changes); throttled internally. */
  refreshMapMode(): void;
  onMapModeChange(cb: (id: string) => void): () => void;

  setLayerVisible(id: LayerId, visible: boolean): void;
  isLayerVisible(id: LayerId): boolean;
  highlightProvince(ids: ProvinceId | ProvinceId[] | null, slot?: 'select' | 'hover'): void;
  highlightCountry(ids: CountryId | CountryId[] | null, slot?: 'select' | 'hover'): void;

  /** Terrain height (m) at a point: the rendered terrain when loaded, else the 0.25° grid. */
  heightAt(lon: number, lat: number): number;
  toScreen(lon: number, lat: number, heightM?: number): { x: number; y: number } | null;
  requestRender(): void;
  /** Keep rendering every frame (animations); the default is on-demand. */
  setContinuousRender(on: boolean): void;
  /** Drive the sun by the game clock (hours since 2026-01-01T00:00Z). */
  setGameHours(hours: number): void;
  setDayNight(on: boolean): void;
  /** Re-read the current Game (after new game / load): rebinds events, damage tint and fills. */
  refreshGame(): void;
  /** Optional providers needing keys (stored in localStorage). */
  applyAccessKeys(): Promise<void>;
  destroy(): void;
}
