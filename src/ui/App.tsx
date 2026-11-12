/** Minimal shell (to be replaced by the UI module): loading progress, error, and clock controls. */
import { useEffect, useState } from 'react';
import { formatDate } from '../core/clock';
import { bootText } from '../app/bootText';
import { useAppHost } from '../app/host';
import GlobeView from '../render/globe/GlobeView';

function useFrame(ms = 250) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export default function App() {
  const phase = useAppHost((s) => s.phase);
  const progress = useAppHost((s) => s.progress);
  const error = useAppHost((s) => s.error);
  const game = useAppHost((s) => s.game);
  useFrame();

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
        <div style={{ width: 420 }}>
          <h1 style={{ fontSize: 22 }}>{bootText('title')}</h1>
          <p>{progress?.phase === 'index' ? bootText('indexing') : bootText('loading')}</p>
          <div style={{ height: 8, background: '#22303c', borderRadius: 4 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#3fa7ff', borderRadius: 4, transition: 'width .2s' }} />
          </div>
        </div>
      </div>
    );
  }
  const t = game?.state.time;
  return (
    <div style={{ position: 'absolute', inset: 0 }} data-testid="boot-ready">
      <GlobeView />
      <div style={{ position: 'absolute', top: 8, left: 12, pointerEvents: 'none', textShadow: '0 1px 3px #000' }}>
        {t && (
          <p data-testid="game-date">
            {formatDate(t.hours, navigator.language || 'pt-BR', true)} · {t.paused ? '⏸' : `▶ ×${t.speed}`}
          </p>
        )}
      </div>
    </div>
  );
}
