import { useState } from 'react';
import { accessKeys, type LayerId } from '../../render/globe';
import { getGlobe } from '../../render/globe/registry';
import { setVolumes } from '../../audio';
import { fmtPct } from '../fmt';
import { t } from '../i18n';
import { Slider, Tabs, Toggle } from '../kit/controls';
import { useSettings } from '../settings';
import { Modal } from './Modal';

export const LAYERS: LayerId[] = ['countryBorders', 'provinceBorders', 'roads', 'railways', 'countryLabels', 'cities', 'cityLabels', 'plants', 'airports', 'ports'];

/** Applies the persisted settings to the live globe/audio (called on globe creation and on change). */
export function applySettings() {
  const s = useSettings.getState();
  setVolumes({ master: s.volMaster, music: s.volMusic, sfx: s.volSfx });
  const g = getGlobe();
  if (!g) return;
  g.viewer.resolutionScale = s.resolutionScale;
  g.setDayNight(s.dayNight);
  for (const [id, v] of Object.entries(s.layers)) g.setLayerVisible(id as LayerId, !!v);
  g.requestRender();
}

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<'gfx' | 'audio' | 'keys' | 'game'>('gfx');
  const s = useSettings();
  const [ion, setIon] = useState(accessKeys.ionToken());
  const [goog, setGoog] = useState(accessKeys.googleKey());
  const upd = (p: Parameters<typeof s.set>[0]) => { s.set(p); applySettings(); };
  const g = getGlobe();
  return (
    <Modal titleKey="ui.settings.title" onClose={onClose} width={560}>
      <Tabs value={tab} onChange={setTab} tabs={[['gfx', t('ui.settings.gfx')], ['audio', t('ui.settings.audio')], ['keys', t('ui.settings.keys')], ['game', t('ui.settings.game')]]} />
      {tab === 'gfx' && (
        <div className="col">
          <div><div className="dim">{t('ui.settings.resScale')}</div><Slider value={s.resolutionScale} min={0.5} max={2} step={0.25} onChange={(v) => upd({ resolutionScale: v })} format={(v) => `${v}×`} /></div>
          <Toggle on={s.dayNight} onChange={(v) => upd({ dayNight: v })} label={t('ui.settings.dayNight')} />
          <div className="sect-title">{t('ui.settings.layers')}</div>
          <div className="fact-grid">
            {LAYERS.map((id) => (
              <Toggle key={id} on={s.layers[id] ?? g?.isLayerVisible(id) ?? true} onChange={(v) => upd({ layers: { ...s.layers, [id]: v } })} label={t(`ui.layer.${id}`)} />
            ))}
          </div>
        </div>
      )}
      {tab === 'audio' && (
        <div className="col">
          {([['volMaster', 'ui.settings.volMaster'], ['volMusic', 'ui.settings.volMusic'], ['volSfx', 'ui.settings.volSfx']] as const).map(([k, label]) => (
            <div key={k}><div className="dim">{t(label)}</div><Slider value={s[k]} min={0} max={1} step={0.05} onChange={(v) => upd({ [k]: v })} format={(v) => fmtPct(v)} /></div>
          ))}
        </div>
      )}
      {tab === 'keys' && (
        <div className="col">
          <p className="dim">{t('ui.settings.keysHelp')}</p>
          <label className="col gap4"><span>{t('ui.settings.ionToken')}</span><input className="input" value={ion} onChange={(e) => setIon(e.target.value)} autoComplete="off" /></label>
          <label className="col gap4"><span>{t('ui.settings.googleKey')}</span><input className="input" value={goog} onChange={(e) => setGoog(e.target.value)} autoComplete="off" /></label>
          <div><button className="btn primary" onClick={() => { accessKeys.setIonToken(ion); accessKeys.setGoogleKey(goog); void getGlobe()?.applyAccessKeys(); }}>{t('ui.settings.apply')}</button></div>
        </div>
      )}
      {tab === 'game' && (
        <div className="col">
          <Toggle on={s.autosave} onChange={(v) => s.set({ autosave: v })} label={t('ui.settings.autosave')} />
          <p className="dim">{t('ui.settings.shortcuts')}</p>
        </div>
      )}
    </Modal>
  );
}
