import { registerPanel } from '../registry';
import { BudgetPanel } from './Budget';
import { ConstructionPanel } from './Construction';
import { EconomyPanel } from './Economy';
import { EnergyPanel } from './Energy';
import { PopulationPanel } from './Population';
import { TradePanel } from './Trade';

registerPanel({ id: 'economy', titleKey: 'ui.panel.economy', icon: 'economy', component: EconomyPanel, group: 'manage', order: 1, width: 500 });
registerPanel({ id: 'budget', titleKey: 'ui.panel.budget', icon: 'budget', component: BudgetPanel, group: 'manage', order: 2, width: 520 });
registerPanel({ id: 'energy', titleKey: 'ui.panel.energy', icon: 'energy', component: EnergyPanel, group: 'manage', order: 3, width: 480 });
registerPanel({ id: 'construction', titleKey: 'ui.panel.construction', icon: 'construction', component: ConstructionPanel, group: 'manage', order: 4, width: 600 });
registerPanel({ id: 'population', titleKey: 'ui.panel.population', icon: 'population', component: PopulationPanel, group: 'manage', order: 5, width: 460 });
registerPanel({ id: 'trade', titleKey: 'ui.panel.trade', icon: 'trade', component: TradePanel, group: 'manage', order: 6, width: 560 });
