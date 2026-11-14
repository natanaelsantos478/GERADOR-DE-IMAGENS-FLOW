import { useEffect, useState } from 'react';
import { appHost, useAppHost } from '../../app/host';
import { playSound, setMusic } from '../../audio';
import { SaveLoadDialog } from '../menu/SaveLoad';
import { AUTOSAVE, saveSlot } from '../menu/saveOps';
import { SettingsDialog } from '../menu/Settings';
import { Modal } from '../menu/Modal';
import { t } from '../i18n';
import { useSettings } from '../settings';
import { ui, useUi } from '../store';
import { dispatch, me, theGame, useGame } from '../useGame';
import { Alerts, Feed, Toasts } from './Feed';
import { MapControls } from './MapControls';
import { InspectorDock, SelectionController } from './Selection';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Windows } from './Windows';
import { EventModal } from '../diplo';
import { Tutorial } from '../guide';
import { TacticalHud } from '../tactical/TacticalHud';
import { AdviceCard, UnitSelectionBridge } from '../war';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') && e.key !== 'Escape') return;
      const s = useUi.getState();
      if (s.screen !== 'game' || !appHost.getState().game) return;
      if (e.key === 'Escape') {
        if (s.pickMode) s.setPick(null);
        else if (s.selection) s.select(null);
        else {
          const front = Object.entries(s.wins).sort((a, b) => b[1].z - a[1].z)[0];
          if (front) s.closeWin(front[0]);
          else s.setPauseMenu(!s.pauseMenu);
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        dispatch({ type: 'game.togglePause', country: me() });
      } else if (/^[1-5]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        dispatch({ type: 'game.setSpeed', country: me(), speed: Number(e.key) as 1 });
        if (theGame().state.time.paused) dispatch({ type: 'game.resume', country: me() });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Monthly autosave + sound/music reactions to simulation events. */
function useGameEffects() {
  const game = useAppHost((s) => s.game)!;
  useEffect(() => {
    const offs = [
      game.bus.on('time.month', () => { if (useSettings.getState().autosave) void saveSlot(AUTOSAVE); }),
      game.bus.on('news.added', ({ item }) => {
        const k = item.textKey;
        if (k === 'dip.news.warDeclared') playSound('war_declared');
        else if (k === 'dip.news.warEnded') playSound('peace');
        else if (k === 'dip.news.nuclearUse' || k === 'mil.news.nuke') playSound('nuke');
        else if (k === 'res.news.done') playSound('research_complete');
        else if (k === 'eco.news.structureDone') playSound('build_complete');
        else if (item.importance >= 2) playSound('notify_alert');
        else if (item.importance === 1 && item.countries?.includes(game.state.meta.playerCountryId)) playSound('notify_info');
        if (item.where && 'lon' in item.where && /^(mil|tac)\./.test(k)) playSound(k === 'mil.news.strike' ? 'missile_launch' : 'explosion_small', item.where);
      }),
    ];
    const id = setInterval(() => setMusic(game.ctx.api.diplomacy.enemies(game.state.meta.playerCountryId).length ? 'war' : 'peace'), 2000);
    return () => { offs.forEach((f) => f()); clearInterval(id); };
  }, [game]);
}

function PauseMenu() {
  const [dlg, setDlg] = useState<null | 'save' | 'settings'>(null);
  const close = () => ui().setPauseMenu(false);
  if (dlg === 'save') return <SaveLoadDialog onClose={() => setDlg(null)} />;
  if (dlg === 'settings') return <SettingsDialog onClose={() => setDlg(null)} />;
  return (
    <Modal titleKey="ui.menu.pause" onClose={close} width={360}>
      <div className="col" data-testid="pause-menu">
        <button className="btn primary" onClick={close}>{t('ui.menu.resume')}</button>
        <button className="btn" data-testid="pm-save" onClick={() => setDlg('save')}>{t('ui.menu.saveLoad')}</button>
        <button className="btn" onClick={() => setDlg('settings')}>{t('ui.menu.settings')}</button>
        <button className="btn danger" data-testid="pm-quit" onClick={() => { dispatch({ type: 'game.pause', country: me() }); close(); ui().go('menu'); }}>{t('ui.menu.quit')}</button>
      </div>
    </Modal>
  );
}

export function GameHud() {
  const pauseMenu = useUi((s) => s.pauseMenu);
  useShortcuts();
  useGameEffects();
  const tactical = useGame((g) => !!g.state.tactical?.battle);
  return (
    <>
      <TopBar />
      {tactical ? <TacticalHud /> : (
        <>
          <Sidebar />
          <div className="right-col">
            <MapControls />
            <InspectorDock />
          </div>
          <Windows />
          <Feed />
          <Alerts />
          <AdviceCard />
          <Tutorial />
        </>
      )}
      <UnitSelectionBridge />
      {!tactical && <EventModal />}
      <SelectionController />
      {pauseMenu && <PauseMenu />}
    </>
  );
}
export { Toasts };
