/**
 * Plug-in points for other UI modules (no edits to the shell needed):
 *   registerPanel({ id, titleKey, icon, component, group })   → sidebar button + draggable window
 *   registerInspector(kind, Component)                        → right-hand inspector for Selection.kind
 */
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { Selection } from './store';

export interface PanelDef {
  id: string;
  titleKey: string;
  /** Icon name from public/icons/manifest.json. */
  icon: string;
  component: ComponentType;
  /** Sidebar group; groups are separated by a rule and ordered by `GROUP_ORDER` then first registration. */
  group: 'manage' | 'state' | 'military' | string;
  width?: number;
  /** Sort inside the group (default registration order). */
  order?: number;
}
export interface InspectorProps { sel: Selection }
export type InspectorComponent = ComponentType<InspectorProps>;

interface RegState {
  panels: PanelDef[];
  inspectors: Record<string, InspectorComponent>;
}
export const useRegistry = create<RegState>()(() => ({ panels: [], inspectors: {} }));

export function registerPanel(def: PanelDef) {
  useRegistry.setState((s) => ({ panels: [...s.panels.filter((p) => p.id !== def.id), def] }));
}
export function registerInspector(kind: string, component: InspectorComponent) {
  useRegistry.setState((s) => ({ inspectors: { ...s.inspectors, [kind]: component } }));
}
export const getInspector = (kind: string) => useRegistry.getState().inspectors[kind];
export const GROUP_ORDER = ['manage', 'state', 'military'];
