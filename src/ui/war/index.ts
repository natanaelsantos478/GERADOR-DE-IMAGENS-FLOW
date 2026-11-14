import { registerInspector, registerPanel } from '../registry';
import '../texts.b';
import { BattleInspector } from './BattleInspector';
import { FormationInspector } from './FormationInspector';
import { ForcesPanel } from './ForcesPanel';
import { IntelPanel } from './IntelPanel';
import { ProductionPanel } from './ProductionPanel';

registerPanel({ id: 'forces', titleKey: 'ui.panel.forces', icon: 'forces', component: ForcesPanel, group: 'military', order: 1, width: 560 });
registerPanel({ id: 'production', titleKey: 'ui.panel.production', icon: 'production', component: ProductionPanel, group: 'military', order: 2, width: 560 });
registerPanel({ id: 'intelligence', titleKey: 'ui.panel.intelligence', icon: 'intelligence', component: IntelPanel, group: 'military', order: 3, width: 520 });
registerInspector('formation', FormationInspector);
registerInspector('battle', BattleInspector);
export { UnitSelectionBridge } from './ForcesPanel';
export { AdviceCard } from './IntelPanel';
