/**
 * Команда favorites: вотчлист пользователя из приложения Т-Инвестиций
 * (GetFavorites, только чтение) с текущими ценами.
 *
 * Экспорты:
 * - FavoritesApi — контракт клиента;
 * - FavoriteView — представление позиции вотчлиста;
 * - buildFavoriteViews(instruments, prices) — чистая сборка;
 * - fetchFavorites(api) — загрузка + цены батчем;
 * - renderFavorites(views) — человекочитаемый вывод.
 */
import { quotationToNumberOrNull } from '../api/money.js';
import type { GetLastPricesResponse, LastPrice } from '../api/types.js';
import type { FavoriteInstrument, GetFavoritesResponse } from '../api/types-info.js';
import { renderTable } from '../format/table.js';
import { DASH, moneyOrDash } from '../format/values.js';

export interface FavoritesApi {
  getFavorites(): Promise<GetFavoritesResponse>;
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
}

export interface FavoriteView {
  uid: string;
  ticker: string | null;
  name: string | null;
  instrumentType: string | null;
  lastPrice: number | null; // null — цены нет (внебиржа, торги не идут)
  apiTradeAvailable: boolean | null;
}

export function buildFavoriteViews(
  instruments: FavoriteInstrument[],
  prices: LastPrice[],
): FavoriteView[] {
  const priceByUid = new Map(prices.map((p) => [p.instrumentUid, p]));
  return instruments.map((instrument): FavoriteView => {
    // Опущенный protobuf-JSON price → null (внебиржа/торги не идут).
    const price = priceByUid.get(instrument.uid)?.price;
    return {
      uid: instrument.uid,
      ticker: instrument.ticker ?? null,
      name: instrument.name ?? null,
      instrumentType: instrument.instrumentType ?? null,
      lastPrice: quotationToNumberOrNull(price),
      apiTradeAvailable: instrument.apiTradeAvailableFlag ?? null,
    };
  });
}

export async function fetchFavorites(api: FavoritesApi): Promise<FavoriteView[]> {
  const resp = await api.getFavorites();
  const instruments = resp.favoriteInstruments ?? [];
  if (instruments.length === 0) {
    return [];
  }
  // Один батч цен на весь вотчлист.
  const prices = await api.getLastPrices(instruments.map((i) => i.uid));
  return buildFavoriteViews(instruments, prices.lastPrices);
}

export function renderFavorites(views: FavoriteView[]): string {
  if (views.length === 0) {
    return 'Список избранного пуст.';
  }
  const table = renderTable(
    ['Тикер', 'Название', 'Тип', 'Цена', 'Через API'],
    views.map((v) => [
      v.ticker ?? DASH,
      v.name ?? DASH,
      v.instrumentType ?? DASH,
      moneyOrDash(v.lastPrice),
      v.apiTradeAvailable === null ? DASH : v.apiTradeAvailable ? 'да' : 'нет',
    ]),
  );
  return `Избранное (${views.length}):\n${table}`;
}
