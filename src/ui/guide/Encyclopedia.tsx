import { useState } from 'react';
import { RESOURCES } from '../../core/contracts';
import { BASELINE_UNLOCKS, STRUCTURE_IDS } from '../../sim/research/catalog';
import { UNIT_LIST } from '../../sim/military';
import { TECHS } from '../../sim/research';
import { fmtDec, fmtInt } from '../fmt';
import { hasText, t } from '../i18n';
import { Tabs } from '../kit/controls';
import { Icon } from '../kit/Icon';
import { costText } from '../war/ProductionPanel';
import { modText, unlockName } from '../research/ResearchPanel';
import { startTutorial } from './Tutorial';
import { resIcon } from '../panels/common';

type Tab = 'units' | 'buildings' | 'techs' | 'resources';
const techFor = (unlock: string) => TECHS.find((x) => x.unlocks.includes(unlock));
const gate = (unlock: string) => { const x = techFor(unlock); return BASELINE_UNLOCKS.includes(unlock) || !x ? t('ui.guide.base') : `${t('ui.guide.requires')}: ${t(`tech.${x.id}`)}`; };

export function EncyclopediaPanel() {
  const [tab, setTab] = useState<Tab>('units');
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const m = (s: string) => !ql || s.toLowerCase().includes(ql);
  return (
    <div className="col" data-testid="guide-panel">
      <div className="row">
        <input className="input grow" placeholder={t('ui.guide.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn sm" data-testid="tut-restart" onClick={startTutorial}>{t('ui.tut.restart')}</button>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[['units', t('ui.guide.units')], ['buildings', t('ui.guide.buildings')], ['techs', t('ui.guide.techs')], ['resources', t('ui.guide.resources')]]} />
      {tab === 'units' && UNIT_LIST.filter((u) => m(t(`mil.unit.${u.id}`))).map((u) => (
        <div key={u.id} className="card col gap4">
          <div className="row sp"><b><Icon name={u.iconId} /> {t(`mil.unit.${u.id}`)}</b><span className="chip">{t(`ui.mil.domain.${u.domain}`)}</span></div>
          <div className="dim" style={{ fontSize: 12 }}>{t('ui.guide.unitStats', { soft: fmtDec(u.soft, 1), hard: fmtDec(u.hard, 1), air: fmtDec(u.air, 1), naval: fmtDec(u.naval, 1), def: fmtDec(u.def, 1), range: fmtInt(u.range), vis: fmtInt(u.vis), men: fmtInt(u.men) })}</div>
          <div style={{ fontSize: 12 }}>{t('ui.prod.cost')}: {costText(u.cost)} · {fmtInt(u.pts)} {t('ui.prod.pts')}</div>
          <div className="dim" style={{ fontSize: 12 }}>{gate(`unit.${u.id}`)}</div>
        </div>
      ))}
      {tab === 'buildings' && STRUCTURE_IDS.filter((k) => m(t(`ui.kind.${k}`))).map((k) => (
        <div key={k} className="card col gap4">
          <b>{t(`ui.kind.${k}`)}</b>
          <div style={{ fontSize: 12.5 }}>{t(`ui.guide.build.${k}`)}</div>
          <div className="dim" style={{ fontSize: 12 }}>{gate(`build.${k}`)}</div>
        </div>
      ))}
      {tab === 'techs' && TECHS.filter((x) => m(t(`tech.${x.id}`))).map((x) => (
        <div key={x.id} className="card col gap4">
          <div className="row sp"><b>{t(`tech.${x.id}`)}</b><span className="chip">{t(`ui.res.br.${x.branch}`)} · {t('ui.res.tier', { n: x.tier })}</span></div>
          <div className="dim" style={{ fontSize: 12 }}>{t('ui.res.cost')}: {fmtInt(x.cost)} {t('ui.res.pts')}{x.requires.length ? ` · ${t('ui.res.requires')}: ${x.requires.map((r) => t(`tech.${r}`)).join(', ')}` : ''}</div>
          <div style={{ fontSize: 12 }} className="col gap4">
            {x.unlocks.map((u) => <span key={u} className="good">{t(`res.unlock.${u.split('.')[0]}`, { name: unlockName(u) })}</span>)}
            {Object.entries(x.mods).map(([k, v]) => <span key={k} className="dim">{modText(k, v)}</span>)}
          </div>
        </div>
      ))}
      {tab === 'resources' && RESOURCES.filter((r) => m(t(`eco.res.${r}`))).map((r) => (
        <div key={r} className="card col gap4">
          <b><Icon name={resIcon(r)} /> {t(`eco.res.${r}`)}</b>
          <div style={{ fontSize: 12.5 }}>{hasText(`ui.guide.res.${r}`) ? t(`ui.guide.res.${r}`) : ''}</div>
        </div>
      ))}
    </div>
  );
}
