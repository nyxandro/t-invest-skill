/**
 * Тесты команды news: клиентская фильтрация по бумаге (сервер ленту
 * не фильтрует), маппинг представления, пагинация с ранним выходом.
 */
import { describe, expect, it } from 'vitest';
import type { NewsItem } from '../api/types-info.js';
import { fetchNews, filterNewsByInstrument, toNewsViews, type NewsApi } from './news.js';

const newsItem = (id: string, title: string, tickers: string[] = []): NewsItem => ({
  id,
  title,
  ts: '2026-07-02T10:00:00Z',
  source: 'tass',
  instrumentId: tickers.map((ticker) => ({
    instrument: { instrumentUid: `uid-${ticker}`, ticker, classCode: 'TQBR' },
  })),
});

describe('filterNewsByInstrument', () => {
  it('оставляет только новости с привязкой к бумаге (uid или тикер)', () => {
    const items = [
      newsItem('1', 'Про Газпром', ['GAZP']),
      newsItem('2', 'Не про рынок'),
      newsItem('3', 'Про Сбер и Газпром', ['SBER', 'GAZP']),
    ];
    const filtered = filterNewsByInstrument(items, 'uid-GAZP', 'gazp');
    expect(filtered.map((i) => i.id)).toEqual(['1', '3']);
  });
});

describe('toNewsViews', () => {
  it('маппит поля и собирает тикеры привязок', () => {
    const views = toNewsViews([newsItem('1', 'Заголовок', ['SBER', 'GAZP'])]);
    expect(views[0]).toMatchObject({
      id: '1',
      title: 'Заголовок',
      source: 'tass',
      tickers: ['SBER', 'GAZP'],
      priority: false,
    });
  });
});

describe('fetchNews', () => {
  it('без запроса возвращает одну страницу общей ленты', async () => {
    const api = {
      async getNews({ limit }: { limit: number }) {
        return { items: Array.from({ length: limit }, (_, i) => newsItem(String(i), `n${i}`)) };
      },
      async findInstrument() {
        throw new Error('не должен вызываться');
      },
    } as unknown as NewsApi;
    const view = await fetchNews(api, { limit: 5 });
    expect(view.query).toBeNull();
    expect(view.items).toHaveLength(5);
  });

  it('с тикером листает ленту и фильтрует по привязкам', async () => {
    let calls = 0;
    const api = {
      async findInstrument() {
        return {
          instruments: [
            { uid: 'uid-GAZP', figi: 'f', ticker: 'GAZP', classCode: 'TQBR', instrumentType: 'share', name: 'Газпром' },
          ],
        };
      },
      async getNews({ cursor }: { cursor?: string }) {
        calls += 1;
        if (!cursor) {
          return { hasNext: true, nextCursor: 'c2', items: [newsItem('1', 'мимо'), newsItem('2', 'Газпром', ['GAZP'])] };
        }
        return { hasNext: false, items: [newsItem('3', 'ещё Газпром', ['GAZP'])] };
      },
    } as unknown as NewsApi;
    const view = await fetchNews(api, { query: 'GAZP', limit: 5 });
    expect(view.query).toBe('GAZP');
    expect(view.items.map((i) => i.id)).toEqual(['2', '3']);
    expect(view.scannedItems).toBe(3);
    expect(calls).toBe(2);
  });
});
