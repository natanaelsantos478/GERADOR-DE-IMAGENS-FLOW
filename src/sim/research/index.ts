import type { Command, CountryId, Ctx, TechId } from '../../core/contracts';
import type { TechView } from './types';
export * from './catalog';
export { TECHS, TECH_BY_ID } from './techs';
export type { TechDef } from './techs';
export type { CountryResearch, ResearchState, TechView, TempModifier } from './types';
export { researchSystem, initialTechs, branchLevels } from './system';
export { researchPt } from './i18n.pt';

// ---- command creators (UI and AI use the same commands)
export const queueTech = (country: CountryId, tech: TechId): Command => ({ type: 'res.queue', country, tech });
export const unqueueTech = (country: CountryId, tech: TechId): Command => ({ type: 'res.unqueue', country, tech });
export const startTech = (country: CountryId, tech: TechId): Command => ({ type: 'res.start', country, tech });
export const setAutoResearch = (country: CountryId, value: boolean): Command => ({ type: 'game.setAutomation', country, key: 'res.auto', value });

// ---- UI selectors
export interface TechTreeBranch {
  branch: TechView['branch'];
  /** Tier columns 1..6, each with the techs of that tier. */
  tiers: TechView[][];
}
/** Tech tree of a country grouped by branch and tier. */
export function selectTechTree(ctx: Ctx, country: CountryId): TechTreeBranch[] {
  const tree = ctx.api.research.tree(country);
  const out = new Map<string, TechTreeBranch>();
  for (const t of tree) {
    let b = out.get(t.branch);
    if (!b) out.set(t.branch, (b = { branch: t.branch, tiers: [[], [], [], [], [], []] }));
    b.tiers[t.tier - 1].push(t);
  }
  return [...out.values()];
}
/** Human-readable effects of a tech (i18n key + params) for tooltips. */
export function describeTech(t: Pick<TechView, 'unlocks' | 'mods'>): { key: string; params: Record<string, string | number> }[] {
  const lines: { key: string; params: Record<string, string | number> }[] = [];
  for (const u of t.unlocks) {
    const [kind, name] = u.split('.');
    lines.push({ key: `res.unlock.${kind}`, params: { name } });
  }
  for (const [key, value] of Object.entries(t.mods)) if (value !== 1) lines.push({ key: 'res.mod.label', params: { key, value } });
  return lines;
}
