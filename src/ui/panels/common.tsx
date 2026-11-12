import { setEcoAutomation } from '../../sim/economy';
import { t } from '../i18n';
import { Toggle } from '../kit/controls';
import { dispatch, me, useGame } from '../useGame';

export const resIcon = (r: string) => (r === 'rareEarth' ? 'rare_earth' : r === 'consumerGoods' ? 'consumer_goods' : r);

/** Toggle for one economy automation (`eco.budget` | `eco.build` | `eco.trade`). */
export function AutoToggle({ k }: { k: 'eco.budget' | 'eco.build' | 'eco.trade' }) {
  const on = useGame((g) => g.state.meta.automation[k] === true);
  return <Toggle on={!!on} onChange={(v) => dispatch(setEcoAutomation(me(), k, v))} label={<span title={t(`ui.autoHelp.${k}`)}>{t(`ui.auto.${k}`)}</span>} />;
}
