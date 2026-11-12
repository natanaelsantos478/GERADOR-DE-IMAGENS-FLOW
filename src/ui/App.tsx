/** UI shell: boot screens, globe, then menu or HUD. Panels/inspectors plug in through ./registry. */
import './theme.css';
import { useEffect } from 'react';
import { bootText } from '../app/bootText';
import { useAppHost } from '../app/host';
import { unlockAudio } from '../audio';
import GlobeView from '../render/globe/GlobeView';
import { onGlobe } from '../render/globe/registry';
import { GameHud, Toasts } from './hud/Hud';
import { Menu } from './menu/MainMenu';
import { applySettings } from './menu/Settings';
import { TooltipLayer } from './kit/Tooltip';
import { useUi } from './store';
import './plugins';

export default function App() {
  const phase = useAppHost((s) => s.phase);
  const progress = useAppHost((s) => s.progress);
  const error = useAppHost((s) => s.error);
  const screen = useUi((s) => s.screen);
  const hasGame = useAppHost((s) => !!s.game);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);
  useEffect(() => onGlobe((g) => { if (g) applySettings(); }), []);

  const box: React.CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' };
  if (phase === 'error')
    return (
      <div style={box} data-testid="boot-error">
        <div style={{ maxWidth: 720 }}>
          <h1>{bootText('error')}</h1>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{error}</pre>
        </div>
      </div>
    );
  if (phase === 'loading') {
    const pct = progress ? Math.round((progress.loaded / progress.total) * 100) : 0;
    return (
      <div style={box} data-testid="boot-loading">
        <div className="ui-root" style={{ position: 'static', width: 420 }}>
          <h1 style={{ fontSize: 22 }}>{bootText('title')}</h1>
          <p>{progress?.phase === 'index' ? bootText('indexing') : bootText('loading')}</p>
          <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', inset: 0 }} data-testid="boot-ready" data-screen={screen}>
      <GlobeView />
      <div className="ui-root">
        {screen === 'game' && hasGame ? <GameHud /> : <Menu />}
        <Toasts />
        <TooltipLayer />
      </div>
    </div>
  );
}
