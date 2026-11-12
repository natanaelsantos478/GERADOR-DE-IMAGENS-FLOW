/** Save/load flows shared by the menu and the in-game pause menu. */
import { appHost } from '../../app/host';
import { exportSaveFile, importSaveFile, listSaves, loadFromSlot, saveToSlot, type SaveSlotInfo } from '../../app/save';
import { setMusic } from '../../audio';
import { getGlobe } from '../../render/globe/registry';
import { t } from '../i18n';
import { ui } from '../store';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function slots(): Promise<SaveSlotInfo[]> {
  try { return await listSaves(); } catch { return []; }
}

/** A Game must exist before hydrating; from the main menu we create a throw-away one first. */
function ensureGame() {
  const h = appHost.getState();
  if (h.game) return h.game;
  const first = h.world!.countries.find((c) => c.sovereign)!;
  return h.newGame({ playerCountryId: first.id });
}

function enterGame() {
  appHost.getState().touchGame();
  const game = appHost.getState().game!;
  ui().select(null);
  ui().go('game');
  ui().setPauseMenu(false);
  setMusic(game.ctx.api.diplomacy.enemies(game.state.meta.playerCountryId).length ? 'war' : 'peace');
  const cap = appHost.getState().world!.countryById.get(game.state.meta.playerCountryId)?.capital;
  if (cap) setTimeout(() => void getGlobe()?.flyTo(cap.lon, cap.lat, { height: 2_500_000, durationS: 1.5 }), 400);
}

export async function loadSlot(name: string): Promise<boolean> {
  try {
    await loadFromSlot(name, ensureGame());
    enterGame();
    ui().toast(t('ui.save.loaded', { name }), 'ok');
    return true;
  } catch (e) {
    ui().toast(t('ui.save.error', { msg: errText(e) }), 'error');
    return false;
  }
}
export async function saveSlot(name: string): Promise<boolean> {
  const game = appHost.getState().game;
  if (!game) return false;
  try {
    await saveToSlot(name, game);
    ui().toast(t('ui.save.saved', { name }), 'ok');
    return true;
  } catch (e) {
    ui().toast(t('ui.save.error', { msg: errText(e) }), 'error');
    return false;
  }
}
export async function importFile(file: File): Promise<boolean> {
  try {
    await importSaveFile(file, ensureGame());
    enterGame();
    return true;
  } catch (e) {
    ui().toast(t('ui.save.error', { msg: errText(e) }), 'error');
    return false;
  }
}
export async function exportFile(): Promise<void> {
  const game = appHost.getState().game;
  if (game) await exportSaveFile(game, `meridiano-${game.state.meta.playerCountryId}`);
}
export const AUTOSAVE = 'autosave';
