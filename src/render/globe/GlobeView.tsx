/** Full-screen globe host. Mounts once the world is loaded; follows game replacement (new/load). */
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useEffect, useRef } from 'react';
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
    Object.assign(el.style, { pointerEvents: 'auto', position: 'absolute', right: '12px', bottom: '28px', borderRadius: '4px', boxShadow: '0 2px 10px #0008' });
    minimapSlot.current?.appendChild(el);
    return () => {
      tactical.destroy();
      units.destroy();
      setGlobe(null);
      window.__globe = null;
      globeRef.current = null;
      g.destroy();
    };
  }, [world]);

  useEffect(() => {
    globeRef.current?.refreshGame();
  }, [gameVersion]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} data-testid="globe" />
      <div ref={minimapSlot} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}></div>
    </div>
  );
}
