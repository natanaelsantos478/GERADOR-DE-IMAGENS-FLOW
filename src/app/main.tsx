/** Browser bootstrap: load data with progress, start the loop and expose test hooks. The Game is created by the menu (src/ui). */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { WorldStatic } from '../core/contracts';
import type { Game } from '../core/game';
import { browserFetchJson, loadWorldStatic } from '../data/loadWorld';
import App from '../ui/App';
import { appHost, type AppHostState } from './host';
import { startLoop } from './loop';

declare global {
  interface Window {
    /** Current game (e2e/debug). */
    __game?: Game | null;
    __world?: WorldStatic | null;
    __app?: typeof appHost;
    CESIUM_BASE_URL?: string;
  }
}

async function boot() {
  window.__app = appHost;
  appHost.subscribe((s: AppHostState) => {
    window.__game = s.game;
    window.__world = s.world;
  });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  try {
    const world = await loadWorldStatic(browserFetchJson(new URL('data/', document.baseURI)), (p) => appHost.getState().setProgress(p));
    appHost.getState().setWorld(world);
    startLoop();
  } catch (e) {
    console.error(e);
    appHost.getState().setError(e instanceof Error ? e.message : String(e));
  }
}

void boot();
