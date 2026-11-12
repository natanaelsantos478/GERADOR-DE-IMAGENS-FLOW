import { useState } from 'react';
import type { NewsItem, NewsKind } from '../../core/contracts';
import { appHost } from '../../app/host';
import { fmtDate } from '../fmt';
import { goToWhere, locateWhere } from '../goto';
import { t } from '../i18n';
import { Icon } from '../kit/Icon';
import { useUi } from '../store';
import { me, useGame } from '../useGame';

const KIND_ICON: Record<NewsKind, string> = { economy: 'economy', diplomacy: 'diplomacy', research: 'research', military: 'forces', tactical: 'attack', politics: 'stability', world: 'news', disaster: 'warning', game: 'news' };

/** News text with country ids replaced by their names. */
export function newsText(n: NewsItem): string {
  const w = appHost.getState().world;
  const params: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(n.params ?? {})) params[k] = typeof v === 'string' && w?.countryById.has(v) ? w.countryById.get(v)!.namePt : v;
  return t(n.textKey, params);
}
const isMine = (n: NewsItem, c: string) => !!n.countries?.includes(c) || (!!n.where && 'country' in n.where && n.where.country === c);

export function Feed() {
  const [open, setOpen] = useState(true);
  const filter = useUi((s) => s.feedFilter);
  const items = useGame((g) => g.state.news.slice(-80));
  const mine = filter.mine;
  const shown = (items ?? []).filter((n) => filter[n.kind] && (!mine || n.importance >= 2 || isMine(n, me()))).slice(-40).reverse();
  return (
    <div className={`feed pe ${open ? '' : 'collapsed'}`} data-testid="feed">
      <div className="row" style={{ padding: '6px 10px', borderBottom: open ? '1px solid var(--line)' : 'none' }}>
        <Icon name="news" /><b className="grow">{t('ui.feed.title')}</b>
        <button className={`btn sm ${mine ? 'on' : ''}`} onClick={() => useUi.getState().setFeed('mine', !mine)}>{mine ? t('ui.feed.mine') : t('ui.feed.all')}</button>
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? '▾' : '▴'}</button>
      </div>
      {open && (
        <>
          <div className="row wrap gap4" style={{ padding: '4px 10px' }}>
            {(Object.keys(KIND_ICON) as NewsKind[]).filter((k) => k !== 'game').map((k) => (
              <button key={k} title={t(`ui.news.${k}`)} className={`btn sm ${filter[k] ? 'on' : ''}`} style={{ padding: '2px 6px' }} onClick={() => useUi.getState().setFeed(k, !filter[k])}><Icon name={KIND_ICON[k]} /></button>
            ))}
          </div>
          <div className="feed-list">
            {shown.map((n) => {
              const go = !!locateWhere(n.where);
              return (
                <div key={n.id} className={`feed-item imp${n.importance} ${go ? 'go' : ''}`} onClick={() => go && goToWhere(n.where)}>
                  <span className="d">{fmtDate(n.hours)}</span><span className="grow">{newsText(n)}</span>{go && <Icon name="locate" />}
                </div>
              );
            })}
            {!shown.length && <div className="feed-item dim">{t('ui.feed.empty')}</div>}
          </div>
        </>
      )}
    </div>
  );
}

export function Alerts() {
  const [dismissed, setDismissed] = useState<number[]>([]);
  const items = useGame((g) => g.state.news.filter((n) => n.importance >= 2 && g.state.time.hours - n.hours < 72).slice(-6));
  const shown = (items ?? []).filter((n) => !dismissed.includes(n.id)).slice(-3);
  return (
    <div className="alerts" data-testid="alerts">
      {shown.map((n) => (
        <div key={n.id} className="alert pe" onClick={() => { goToWhere(n.where); setDismissed([...dismissed, n.id]); }}>
          <Icon name="alert" /><span>{newsText(n)}</span>
          <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setDismissed([...dismissed, n.id]); }}><Icon name="close" /></button>
        </div>
      ))}
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return <div className="toasts">{toasts.map((x) => <div key={x.id} className={`toast ${x.kind}`}>{x.text}</div>)}</div>;
}
