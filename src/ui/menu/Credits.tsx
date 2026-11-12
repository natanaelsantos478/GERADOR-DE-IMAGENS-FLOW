import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { Modal } from './Modal';

interface AudioEntry { license: string; author?: string; source?: string; synth?: boolean }
const base = (p: string) => new URL(p, document.baseURI).href;

export function CreditsDialog({ onClose }: { onClose(): void }) {
  const [audio, setAudio] = useState<Record<string, AudioEntry>>({});
  useEffect(() => {
    void fetch(base('audio/manifest.json')).then((r) => r.json()).then(setAudio).catch(() => {});
  }, []);
  const authors = new Map<string, Set<string>>();
  for (const [id, e] of Object.entries(audio)) {
    const key = `${e.author ?? (e.synth ? t('ui.credits.original') : '—')} — ${e.license}`;
    (authors.get(key) ?? authors.set(key, new Set()).get(key)!).add(id);
  }
  return (
    <Modal titleKey="ui.credits.title" onClose={onClose} width={720}>
      <div className="col" data-testid="credits">
        <section><h4 className="sect-title">{t('ui.credits.data')}</h4>
          <p>Natural Earth (domínio público): países, províncias, cidades, aeroportos, portos, estradas e ferrovias · WRI Global Power Plant Database v1 · Banco Mundial (indicadores) · SIPRI e IISS The Military Balance (inventários militares, estimativas públicas) · AWS Terrain Tiles (Terrarium, relevo).</p></section>
        <section><h4 className="sect-title">{t('ui.credits.imagery')}</h4>
          <p>Esri World Imagery (Esri, Maxar, Earthstar Geographics e a comunidade de usuários GIS) · EOX Sentinel-2 cloudless 2020 (Contém dados modificados Copernicus Sentinel, EOX, CC BY 4.0) · Natural Earth II (Cesium).</p></section>
        <section><h4 className="sect-title">{t('ui.credits.models')}</h4>
          <p>CC BY 4.0: Polyfork (https://polyfork.dev) — veículos e instalações; Geibu3D (Cheese Animal Productions) — “Attack Chopper”, opengameart.org/content/attack-chopper. CC0: Quaternius, Sketlux, Kenney, mfonasd, app4soft, yd (Cimpletoon), vi1e8. Conversões, recolorização e simplificação por Meridiano. Lista completa em public/models/LICENSES.md.</p></section>
        <section><h4 className="sect-title">{t('ui.credits.audio')}</h4>
          <p>CC BY 3.0: “Fighter engine flyby” por dklon (opengameart.org/content/fighter-engine-flyby). Demais sons: CC0 / domínio público, editados; tons de interface sintetizados (obra original).</p>
          <div className="faint" style={{ fontSize: 11.5 }}>{[...authors].map(([k, ids]) => <div key={k}>{k}: {[...ids].join(', ')}</div>)}</div></section>
        <section><h4 className="sect-title">{t('ui.credits.icons')}</h4>
          <p>Lucide (ISC License) e ícones originais do Meridiano (MIT).</p></section>
        <section><h4 className="sect-title">{t('ui.credits.software')}</h4>
          <p>CesiumJS (Apache-2.0) · React · zustand · Vite.</p></section>
      </div>
    </Modal>
  );
}
