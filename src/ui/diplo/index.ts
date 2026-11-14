import { registerPanel } from '../registry';
import '../texts.b';
import { DiplomacyPanel } from './DiplomacyPanel';

registerPanel({ id: 'diplomacy', titleKey: 'ui.panel.diplomacy', icon: 'diplomacy', component: DiplomacyPanel, group: 'state', order: 1, width: 640 });
export { EventModal } from './EventModal';
