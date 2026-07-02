/**
 * Команда news: новости рынка (общая лента) или по конкретной бумаге.
 * Сервер ленту по инструменту не фильтрует — фильтрация клиентская,
 * по привязкам item.instrumentId[] (см. types-info.ts).
 *
 * Экспорты:
 * - NewsApi — контракт клиента;
 * - NewsItemView — представление новости;
 * - filterNewsByInstrument(items, uid, ticker) — клиентский фильтр;
 * - toNewsViews(items) — маппинг в представление;
 * - fetchNews(api, params) — лента или подборка по бумаге;
 * - renderNews(view) — человекочитаемый вывод.
 */
import type { NewsItem, NewsResponse } from '../api/types-info.js';
import { NEWS_FILTER_MAX_PAGES, NEWS_PAGE_LIMIT } from '../config/config.js';
import { resolveInstrument, type InstrumentSearchApi } from './resolve-instrument.js';

export interface NewsApi extends InstrumentSearchApi {
  getNews(params: { cursor?: string; limit: number }): Promise<NewsResponse>;
}

export interface NewsItemView {
  id: string;
  ts: string;
  source: string | null;
  title: string;
  content: string | null;
  tickers: string[]; // бумаги, к которым привязана новость
  priority: boolean;
}

export interface NewsView {
  query: string | null; // тикер, по которому фильтровали (null — общая лента)
  scannedItems: number; // сколько новостей ленты просмотрено (для фильтра)
  items: NewsItemView[];
}

export function toNewsViews(items: NewsItem[]): NewsItemView[] {
  return items.map((item) => ({
    id: item.id,
    ts: item.ts,
    source: item.source ?? null,
    title: item.title ?? '(без заголовка)',
    content: item.content ?? null,
    tickers: (item.instrumentId ?? [])
      .map((ref) => ref.instrument?.ticker)
      .filter((t): t is string => Boolean(t)),
    priority: item.priority ?? false,
  }));
}

export function filterNewsByInstrument(items: NewsItem[], uid: string, ticker: string): NewsItem[] {
  const upperTicker = ticker.toUpperCase();
  return items.filter((item) =>
    (item.instrumentId ?? []).some(
      (ref) =>
        ref.instrument?.instrumentUid === uid ||
        ref.instrument?.ticker?.toUpperCase() === upperTicker,
    ),
  );
}

export async function fetchNews(
  api: NewsApi,
  params: { query?: string; limit: number },
): Promise<NewsView> {
  // Общая лента: одна страница нужного размера.
  if (!params.query) {
    const resp = await api.getNews({ limit: params.limit });
    const items = resp.items ?? [];
    return { query: null, scannedItems: items.length, items: toNewsViews(items) };
  }

  // Подборка по бумаге: листаем ленту (ограниченное число страниц)
  // и фильтруем по привязкам новостей к инструментам.
  const instrument = await resolveInstrument(api, params.query);
  const matched: NewsItem[] = [];
  let cursor: string | undefined;
  let scannedItems = 0;
  for (let page = 0; page < NEWS_FILTER_MAX_PAGES; page += 1) {
    const resp = await api.getNews({ cursor, limit: NEWS_PAGE_LIMIT });
    const items = resp.items ?? [];
    scannedItems += items.length;
    matched.push(...filterNewsByInstrument(items, instrument.uid, instrument.ticker));
    if (matched.length >= params.limit || !resp.hasNext || !resp.nextCursor) {
      break;
    }
    cursor = resp.nextCursor;
  }
  return {
    query: instrument.ticker,
    scannedItems,
    items: toNewsViews(matched.slice(0, params.limit)),
  };
}

export function renderNews(view: NewsView): string {
  const header = view.query
    ? `Новости по ${view.query} (просмотрено ${view.scannedItems} новостей ленты):`
    : 'Новости рынка:';
  if (view.items.length === 0) {
    return `${header}\nСреди последних ${view.scannedItems} новостей ленты упоминаний не найдено.`;
  }
  const lines = [header, ''];
  for (const item of view.items) {
    const tickers = item.tickers.length > 0 ? ` [${item.tickers.join(', ')}]` : '';
    lines.push(`• ${item.ts.slice(0, 16).replace('T', ' ')} (${item.source ?? '—'})${tickers}`);
    lines.push(`  ${item.title}`);
  }
  return lines.join('\n');
}
