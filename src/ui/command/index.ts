import { createElement } from 'react';
import { getInspector, registerInspector, registerPanel } from '../registry';
import './texts';
import { CommandPanel } from './CommandPanel';
import { FormationCommandBlock } from './FormationCommand';
import type { InspectorProps } from '../registry';

registerPanel({ id: 'command', titleKey: 'ui.panel.command', icon: 'base', component: CommandPanel, group: 'military', order: 4, width: 640 });

// The formation inspector (UI war module) is extended in place: its own content plus the command block.
const Base = getInspector('formation');
if (Base) {
  const Wrapped = (p: InspectorProps) => createElement('div', null, createElement(Base, p), createElement(FormationCommandBlock, { id: String(p.sel.id ?? '') }));
  registerInspector('formation', Wrapped);
}
