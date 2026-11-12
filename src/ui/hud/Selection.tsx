/** Globe → selection: clicks pick the contextual target; hover highlights the province; pick mode for placement. */
import { useEffect } from 'react';
import { appHost } from '../../app/host';
import { onGlobe } from '../../render/globe/registry';
import { playSound } from '../../audio';
import { getInspector, useRegistry } from '../registry';
import { useUi, ui, type Selection } from '../store';
import { t } from '../i18n';

const POINT_KINDS = ['city', 'plant', 'airport', 'port'];

export function SelectionController() {
  const selection = useUi((s) => s.selection);
  const pick = useUi((s) => s.pickMode);

  useEffect(() => {
    let offs: Array<() => void> = [];
    let lastHover: string | null = null;
    const un = onGlobe((g) => {
      offs.forEach((f) => f());
      offs = [];
      if (!g) return;
      offs.push(g.on('hover', (e) => {
        if (e.pick.provinceId !== lastHover) { lastHover = e.pick.provinceId; g.highlightProvince(lastHover, 'hover'); }
      }));
      offs.push(g.on('click', (e) => {
        const game = appHost.getState().game;
        if (!game || ui().screen !== 'game') return;
        const p = e.pick;
        const pm = ui().pickMode;
        if (pm) {
          if (p.lonLat) { ui().setPick(null); pm.onPick({ lonLat: p.lonLat, province: p.provinceId }); }
          return;
        }
        playSound('ui_click');
        const me = game.state.meta.playerCountryId;
        const base = { province: p.provinceId, country: p.countryId, lonLat: p.lonLat };
        const f = p.feature;
        if (f && (POINT_KINDS.includes(f.kind) || getInspector(f.kind))) {
          ui().select({ ...base, kind: f.kind, id: f.id, index: f.index });
          return;
        }
        if (p.lonLat) {
          const st = game.ctx.api.economy.structureAt(p.lonLat[0], p.lonLat[1], 4);
          if (st) { ui().select({ ...base, kind: 'structure', id: st.id }); return; }
        }
        const prov = p.provinceId;
        const owner = prov ? game.state.world.owner[prov] ?? p.countryId : p.countryId;
        if (!prov && !owner) { ui().select(null); return; }
        if (owner && owner !== me) ui().select({ ...base, kind: 'country', country: owner, id: owner });
        else ui().select({ ...base, kind: 'province', id: prov ?? undefined });
      }));
    });
    return () => { un(); offs.forEach((f) => f()); };
  }, []);

  useEffect(() => onGlobe((g) => g?.highlightProvince(selection?.province ?? null, 'select')), [selection]);
  useEffect(() => () => onGlobe((g) => g?.highlightProvince(null, 'select'))(), []);
  return pick ? <div className="banner pe" data-testid="pick-banner">{t(pick.labelKey)} <button className="btn sm" onClick={() => ui().setPick(null)}>{t('ui.cancel')}</button></div> : null;
}

/** The right-hand inspector dock: renders the component registered for `selection.kind`. */
export function InspectorDock() {
  const sel = useUi((s) => s.selection);
  const inspectors = useRegistry((s) => s.inspectors);
  if (!sel) return null;
  const C = inspectors[sel.kind];
  if (!C) return null;
  return (
    <div className="inspector pe" data-testid={`inspector-${sel.kind}`}>
      <div className="win-body"><C sel={sel as Selection} /></div>
    </div>
  );
}
