/** Phone-only floating controls (box-select toggle) and the optional FPS meter. */
import { useEffect, useState } from 'react';
import { getGlobe, onGlobe } from '../../render/globe/registry';
import { t } from '../i18n';
import { Icon } from '../kit/Icon';
import { useMobile } from '../platform';
import { useSettings } from '../settings';

export function BoxSelectFab() {
  const mobile = useMobile();
  const [on, setOn] = useState(false);
  useEffect(() => () => getGlobe()?.setBoxMode(false), []);
  if (!mobile) return null;
  const toggle = () => { const v = !on; setOn(v); getGlobe()?.setBoxMode(v); };
  return (
    <button className={`fab pe ${on ? 'on' : ''}`} data-testid="btn-boxmode" aria-pressed={on} aria-label={t('ui.mobile.boxSelect')} title={t('ui.mobile.boxSelect')} onClick={toggle}>
      <Icon name="forces" />
    </button>
  );
}

/** Rendered frames per second of the globe (counts Cesium post-render, so on-demand idle shows 0). */
export function FpsMeter() {
  const show = useSettings((s) => s.showFps);
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!show) return;
    let n = 0;
    let off: (() => void) | undefined;
    const un = onGlobe((g) => {
      off?.();
      off = g?.viewer.scene.postRender.addEventListener(() => { n++; });
    });
    const id = setInterval(() => { setFps(n); n = 0; }, 1000);
    return () => { clearInterval(id); un(); off?.(); };
  }, [show]);
  return show ? <div className="fps" data-testid="fps">{fps} FPS</div> : null;
}
