import { useEffect, useState } from 'react';
import { setMusic } from '../../audio';
import { onGlobe } from '../../render/globe/registry';
import { t } from '../i18n';
import { Icon } from '../kit/Icon';
import { useUi } from '../store';
import { CreditsDialog } from './Credits';
import { CountryPick } from './CountryPick';
import { loadSlot, slots } from './saveOps';
import { SaveLoadDialog } from './SaveLoad';
import { SettingsDialog } from './Settings';

/** Slowly turns the globe behind the main menu. */
function useSpin(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let lon = -50;
    let g: ReturnType<typeof import('../../render/globe/registry').getGlobe> = null;
    const off = onGlobe((x) => { g = x; g?.setView(lon, 18, { height: 2.4e7, pitchDeg: -90 }); });
    const id = setInterval(() => { lon = (lon + 0.12 + 540) % 360 - 180; g?.setView(lon, 18, { height: 2.4e7, pitchDeg: -90 }); }, 70);
    return () => { clearInterval(id); off(); };
  }, [on]);
}

export function Menu() {
  const screen = useUi((s) => s.screen);
  const [dlg, setDlg] = useState<null | 'load' | 'settings' | 'credits'>(null);
  const [latest, setLatest] = useState<string | null>(null);
  useSpin(screen === 'menu' && !dlg);
  useEffect(() => { setMusic('menu'); void slots().then((l) => setLatest(l[0]?.name ?? null)); }, []);
  return (
    <>
      {screen === 'menu' && (
        <div className="menu-screen" style={{ pointerEvents: 'none' }}>
          <div className="menu-main pe" data-testid="main-menu">
            <h1>MERIDIANO</h1>
            <div className="sub">{t('ui.menu.subtitle')}</div>
            <button className="btn primary" data-testid="menu-new" onClick={() => useUi.getState().go('newgame')}><Icon name="play" />{t('ui.menu.new')}</button>
            <button className="btn" data-testid="menu-continue" disabled={!latest} onClick={() => latest && void loadSlot(latest)}><Icon name="load" />{t('ui.menu.continue')}</button>
            <button className="btn" data-testid="menu-load" onClick={() => setDlg('load')}><Icon name="save" />{t('ui.menu.load')}</button>
            <button className="btn" onClick={() => setDlg('settings')}><Icon name="settings" />{t('ui.menu.settings')}</button>
            <button className="btn" onClick={() => setDlg('credits')}><Icon name="encyclopedia" />{t('ui.menu.credits')}</button>
          </div>
        </div>
      )}
      {screen === 'newgame' && <CountryPick />}
      {dlg === 'load' && <SaveLoadDialog onClose={() => setDlg(null)} />}
      {dlg === 'settings' && <SettingsDialog onClose={() => setDlg(null)} />}
      {dlg === 'credits' && <CreditsDialog onClose={() => setDlg(null)} />}
    </>
  );
}
