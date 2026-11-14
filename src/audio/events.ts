/** Routes render-layer events (explosions, launches, tactical fire, orders) to positional sounds. */
import { renderEvents, type RenderEvent } from '../render/units/common';
import { playSound } from './index';

let radio = 0;
function onEvent(e: RenderEvent) {
  switch (e.type) {
    case 'explosion': playSound(e.size === 'large' ? 'explosion_large' : 'explosion_small', { lon: e.pos[0], lat: e.pos[1] }); break;
    case 'nuke': playSound('nuke', { lon: e.pos[0], lat: e.pos[1] }); break;
    case 'missileLaunch': playSound(/sam|aa|intercept/i.test(e.weapon) ? 'sam_launch' : 'missile_launch', { lon: e.pos[0], lat: e.pos[1] }); break;
    case 'battleStart': playSound('notify_alert', { lon: e.pos[0], lat: e.pos[1], volume: 0.6 }); break;
    case 'tacShot': {
      const id = e.kind === 'bullet' ? 'rifle_burst' : e.kind === 'shell' ? (e.dist > 1200 ? 'artillery_fire' : 'tank_cannon') : e.kind === 'rocket' ? 'mlrs_salvo' : e.kind === 'missile' ? 'missile_launch' : 'jet_flyby';
      playSound(id, { lon: e.pos[0], lat: e.pos[1], volume: 0.7 });
      break;
    }
    case 'tacExplosion': playSound(e.kind === 'bomb' ? 'explosion_large' : 'explosion_small', { lon: e.pos[0], lat: e.pos[1], volume: 0.8 }); break;
    case 'tacOrder': playSound(e.ok ? `radio_ack_${(radio++ % 3) + 1}` : 'ui_error', { volume: 0.7 }); break;
    case 'commandRejected': playSound('ui_error'); break;
  }
}

/** Subscribe once (idempotent); returns the unsubscribe. */
let off: (() => void) | null = null;
export function bindRenderAudio(): () => void {
  off ??= renderEvents.on(onEvent);
  return () => { off?.(); off = null; };
}
