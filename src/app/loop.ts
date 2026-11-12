/** requestAnimationFrame driver: advances the current game by the real frame time. */
import { appHost } from './host';

export function startLoop(): () => void {
  let last = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    const game = appHost.getState().game;
    if (game) {
      try {
        game.step(dt);
      } catch (e) {
        console.error('simulação falhou', e);
        game.dispatch({ type: 'game.pause', country: game.state.meta.playerCountryId });
        appHost.getState().setError(e instanceof Error ? e.message : String(e));
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
