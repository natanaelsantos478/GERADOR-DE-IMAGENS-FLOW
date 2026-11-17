/** Full-screen globe host. Mounts once the world is loaded; follows game replacement (new/load). */
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useEffect, useRef, useState } from 'react';
import { useMobile } from '../../ui/platform';
import { appHost, useAppHost } from '../../app/host';
import { createGlobe } from './createGlobe';
import { attachTacticalLayer } from '../tactical';
import { attachUnitsLayer } from '../units';
import { setGlobe } from './registry';

declare global {
  interface Window {
    __globe?: import('./types').Globe | null;
    __units?: import('../units').UnitsLayer;
    __tactical?: import('../tactical').TacticalLayer;
  }
}

export default function GlobeView() {
  const world = useAppHost((s) => s.world);
  const gameVersion = useAppHost((s) => s.gameVersion);
  const host = useRef<HTMLDivElement>(null);
  const minimapSlot = useRef<HTMLDivElement>(null);
  const globeRef = useRef<ReturnType<typeof createGlobe> | null>(null);
  const mobile = useMobile();
  const [mini, setMini] = useState(false);
  const miniEl = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!world || !host.current) return;
    const g = createGlobe(host.current, world, { getGame: () => appHost.getState().game });
    globeRef.current = g;
    window.__globe = g;
    setGlobe(g);
    const getGame = () => appHost.getState().game;
    const units = attachUnitsLayer(g, getGame);
    const tactical = attachTacticalLayer(g, getGame);
    window.__units = units;
    window.__tactical = tactical;
    const el = g.minimap.element;
    miniEl.current = el;
    minimapSlot.current?.appendChild(el);
    el.style.pointerEvents = 'auto';
    el.style.borderRadius = '4px';
    el.style.boxShadow = '0 2px 10px #0008';
    el.style.touchAction = 'none';
    return () => {
      tactical.destroy();
      units.destroy();
      setGlobe(null);
      window.__globe = null;
      globeRef.current = null;
      g.destroy();
    };
  }, [world]);

  // Desktop: bottom-right corner. Phones: smaller, inside a column above the box-select button, collapsible.
  useEffect(() => {
    const el = miniEl.current;
    if (!el) return;
    if (mobile) Object.assign(el.style, { position: 'static', width: '132px', height: '66px', display: mini ? 'block' : 'none' });
    else Object.assign(el.style, { position: 'absolute', right: '12px', bottom: '28px', width: '', height: '', display: 'block' });
  }, [mobile, mini, world]);

  useEffect(() => {
    globeRef.current?.refreshGame();
  }, [gameVersion]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} data-testid="globe" />
      <div ref={minimapSlot} className={mobile ? 'mini-slot' : undefined} style={mobile ? undefined : { position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {mobile && <button className={`fab ${mini ? 'on' : ''}`} style={{ position: 'static', width: 44, height: 44, order: 2, display: 'flex' }} data-testid="btn-minimap" aria-label="Mapa" onClick={() => setMini(!mini)}>🌐</button>}
      </div>
    </div>
  );
}
