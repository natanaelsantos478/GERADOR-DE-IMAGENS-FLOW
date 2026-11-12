/** t(key, params): merges the dictionaries of every sim module with the UI keys (pt-BR). */
import { diplomacyPt } from '../sim/diplomacy/i18n.pt';
import { economyPt } from '../sim/economy/i18n.pt';
import { milPt } from '../sim/military/i18n.pt';
import { researchPt } from '../sim/research/i18n.pt';
import { tacticalPt } from '../sim/tactical/i18n.pt';
import { uiPt } from './i18n.ui.pt';

const dict: Record<string, string> = { ...diplomacyPt, ...economyPt, ...milPt, ...researchPt, ...tacticalPt, ...uiPt };

/** Extra keys from other modules/agents (merged into the global dictionary). */
export function addTexts(extra: Record<string, string>) {
  Object.assign(dict, extra);
}
export const hasText = (key: string) => key in dict;

export function t(key: string, params?: Record<string, string | number | boolean>): string {
  const raw = dict[key];
  if (raw === undefined) return params ? `${key} ${JSON.stringify(params)}` : key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}
