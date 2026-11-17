/** Platform glue for phones: mobile layout flag, PWA install/service worker, wake lock, background pause and autosave. */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { appHost } from '../app/host';
import { t } from './i18n';
import { AUTOSAVE, saveSlot } from './menu/saveOps';
import { useSettings } from './settings';
import { ui, useUi } from './store';
import { dispatch, me } from './useGame';

const MOBILE_Q = '(max-width: 819px), (pointer: coarse)';
const mq = () => (typeof matchMedia === 'function' ? matchMedia(MOBILE_Q) : null);
export const isMobileLayout = () => !!mq()?.matches;

/** Re-renders when the mobile layout flag flips (resize / rotation). */
export function useMobile(): boolean {
  const [m, setM] = useState(isMobileLayout);
  useEffect(() => {
    const q = mq();
    if (!q) return;
    const f = () => setM(q.matches);
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, []);
  return m;
}

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null;
export const useInstall = create<{ can: boolean; installed: boolean }>()(() => ({ can: false, installed: false }));
export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  useInstall.setState({ can: false });
}

let wake: { release(): Promise<void> } | null = null;
async function acquireWake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void>; addEventListener(e: string, f: () => void): void }> } };
    if (!nav.wakeLock || wake || document.visibilityState !== 'visible') return;
    const l = await nav.wakeLock.request('screen');
    wake = l;
    l.addEventListener('release', () => { if (wake === l) wake = null; });
  } catch { /* denied or unsupported: harmless */ }
}
function releaseWake() {
  const w = wake;
  wake = null;
  void w?.release().catch(() => undefined);
}

let pausedByHide = false;
function onHidden() {
  const game = appHost.getState().game;
  if (!game || ui().screen !== 'game') return;
  releaseWake();
  if (useSettings.getState().autosave) void saveSlot(AUTOSAVE);
  if (!game.state.time.paused) {
    pausedByHide = true;
    dispatch({ type: 'game.pause', country: me() });
  }
}
function onVisible() {
  const game = appHost.getState().game;
  if (!game || ui().screen !== 'game') return;
  void acquireWake();
  if (pausedByHide) {
    pausedByHide = false;
    ui().toast(t('ui.mobile.pausedBg'), 'info');
  }
}

export function initPlatform() {
  const root = document.documentElement;
  const sync = () => root.classList.toggle('m', isMobileLayout());
  sync();
  mq()?.addEventListener('change', sync);

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; useInstall.setState({ can: true }); });
  window.addEventListener('appinstalled', () => { deferred = null; useInstall.setState({ can: false, installed: true }); });

  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? onHidden() : onVisible()));
  window.addEventListener('pagehide', () => {
    if (appHost.getState().game && useSettings.getState().autosave) void saveSlot(AUTOSAVE);
  });
  // Wake lock follows "a game is on screen".
  let had = false;
  const sub = () => {
    const on = !!appHost.getState().game && ui().screen === 'game';
    if (on && !had) void acquireWake();
    if (!on && had) releaseWake();
    had = on;
  };
  appHost.subscribe(sub);
  useUi.subscribe(sub);
  // Wake lock needs a user gesture on some browsers: retry on first touch.
  window.addEventListener('pointerdown', () => { if (had) void acquireWake(); }, { passive: true });

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => undefined);
    });
  }
}
