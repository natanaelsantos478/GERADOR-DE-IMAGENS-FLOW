import { useEffect, useState } from 'react';
import type { Legend } from '../../render/globe';
import { getGlobe, onGlobe } from '../../render/globe/registry';
import { playSound } from '../../audio';
import { hasText, t } from '../i18n';
import { Icon } from '../kit/Icon';
import { LAYERS } from '../menu/Settings';
import { useSettings } from '../settings';

type ModeInfo = { id: string; label: string; labelKey?: string; available: boolean; legend: Legend | null };
const tr = (key: string | undefined, fallback: string) => (key && hasText(key) ? t(key) : fallback);

export function MapControls() {
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [cur, setCur] = useState('');
  const [open, setOpen] = useState(false);
  const layers = useSettings((s) => s.layers);
  useEffect(() => {
    let off: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const un = onGlobe((g) => {
      off?.();
      clearInterval(timer);
      if (!g) return;
      const sync = () => { setModes(g.mapModes()); setCur(g.currentMapMode()); };
      sync();
      off = g.onMapModeChange(sync);
      timer = setInterval(sync, 1500); // availability/legend of dynamic modes
    });
    return () => { un(); off?.(); clearInterval(timer); };
  }, []);
  const mode = modes.find((m) => m.id === cur);
  const g = getGlobe();
  return (
    <>
      <div className="row pe" style={{ justifyContent: 'flex-end' }}>
        <select className="select grow" data-testid="mapmode" value={cur} onChange={(e) => { playSound('ui_click'); g?.setMapMode(e.target.value); setCur(e.target.value); }}>
          {modes.map((m) => <option key={m.id} value={m.id} disabled={!m.available}>{tr(m.labelKey, m.label)}</option>)}
        </select>
        <button className={`btn ${open ? 'on' : ''}`} data-testid="btn-layers" onClick={() => setOpen(!open)}><Icon name="road" />{t('ui.layers')}</button>
      </div>
      {open && (
        <div className="legend pe col gap4" data-testid="layers-pop">
          {LAYERS.map((id) => (
            <label key={id} className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" style={{ accentColor: 'var(--accent)' }} checked={layers[id] ?? g?.isLayerVisible(id) ?? true} onChange={(e) => { g?.setLayerVisible(id, e.target.checked); useSettings.getState().set({ layers: { ...layers, [id]: e.target.checked } }); }} />
              {t(`ui.layer.${id}`)}
            </label>
          ))}
        </div>
      )}
      {mode?.legend && mode.legend.items.length > 0 && (
        <div className="legend pe" style={{ position: 'fixed', right: 12, bottom: 166 }} data-testid="legend">
          <b>{tr(mode.legend.titleKey, mode.legend.title)}</b>
          {mode.legend.items.map((it, i) => <div key={i}><i style={{ background: it.color }} />{tr(it.labelKey, it.label)}</div>)}
        </div>
      )}
    </>
  );
}
