/** Browser bootstrap: load data with progress, create the Game, start the loop, expose test hooks. */
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

/** Default player before the menu lets the user choose. */
const DEFAULT_PLAYER = 'BRA';

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
    const player = world.countryById.has(DEFAULT_PLAYER) ? DEFAULT_PLAYER : world.countries.find((c) => c.sovereign)?.id;
    if (!player) throw new Error('nenhum país soberano nos dados');
    appHost.getState().newGame({ playerCountryId: player });
    startLoop();
  } catch (e) {
    console.error(e);
    appHost.getState().setError(e instanceof Error ? e.message : String(e));
  }
}

void boot();
