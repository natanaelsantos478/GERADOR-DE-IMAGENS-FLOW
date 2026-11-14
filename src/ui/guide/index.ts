import { registerPanel } from '../registry';
import '../texts.b';
import { EncyclopediaPanel } from './Encyclopedia';

registerPanel({ id: 'guide', titleKey: 'ui.panel.guide', icon: 'encyclopedia', component: EncyclopediaPanel, group: 'help', order: 1, width: 640 });
export { Tutorial } from './Tutorial';
