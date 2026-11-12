import { playSound } from '../../audio';
import { hasText, t } from '../i18n';
import { Icon } from '../kit/Icon';
import { GROUP_ORDER, useRegistry } from '../registry';
import { useUi } from '../store';
import { Tip } from '../kit/Tooltip';

export function Sidebar() {
  const panels = useRegistry((s) => s.panels);
  const wins = useUi((s) => s.wins);
  const groups = [...new Set(panels.map((p) => p.group))].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return (
    <nav className="sidebar pe" data-testid="sidebar">
      {groups.map((g, gi) => (
        <div key={g} style={{ display: 'contents' }}>
          {gi > 0 && <div className="sb-sep" />}
          {panels.filter((p) => p.group === g).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => (
            <Tip key={p.id} tip={t(p.titleKey)}>
              <button className={`sb-item ${wins[p.id] ? 'on' : ''}`} data-testid={`sb-${p.id}`} onClick={() => { playSound(wins[p.id] ? 'ui_close' : 'ui_open'); useUi.getState().toggleWin(p.id); }}>
                <Icon name={p.icon} /><span style={{ maxWidth: 58, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(hasText(p.titleKey + '.short') ? p.titleKey + '.short' : p.titleKey)}</span>
              </button>
            </Tip>
          ))}
        </div>
      ))}
    </nav>
  );
}
