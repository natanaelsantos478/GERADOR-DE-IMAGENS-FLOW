import { registerPanel } from '../registry';
import '../texts.b';
import { ResearchPanel } from './ResearchPanel';

registerPanel({ id: 'research', titleKey: 'ui.panel.research', icon: 'research', component: ResearchPanel, group: 'state', order: 2, width: 800 });
