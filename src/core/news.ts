import type { EventBus } from './bus';
import type { GameState, NewsItem, NewsKind, NewsOptions, NewsParams, NewsWhere, TextKey } from './contracts';
import { NEWS_LIMIT } from './contracts';

/** Appends a news item to `state.news` (dropping the oldest beyond NEWS_LIMIT) and emits `news.added`. */
export function pushNews(
  state: GameState,
  bus: EventBus | null,
  kind: NewsKind,
  textKey: TextKey,
  params: NewsParams = {},
  where?: NewsWhere,
  opts: NewsOptions = {},
): NewsItem {
  const item: NewsItem = {
    id: state.meta.nextNewsId++,
    hours: state.time.hours,
    kind,
    textKey,
    params: { ...params },
    importance: opts.importance ?? 1,
  };
  if (where) item.where = { ...where };
  if (opts.countries && opts.countries.length) item.countries = [...opts.countries];
  state.news.push(item);
  if (state.news.length > NEWS_LIMIT) state.news.splice(0, state.news.length - NEWS_LIMIT);
  bus?.emit({ type: 'news.added', item });
  return item;
}

/** News newer than `sinceId` (exclusive), oldest first. */
export function newsSince(state: GameState, sinceId: number): NewsItem[] {
  const out: NewsItem[] = [];
  for (let i = state.news.length - 1; i >= 0 && state.news[i].id > sinceId; i--) out.push(state.news[i]);
  return out.reverse();
}
