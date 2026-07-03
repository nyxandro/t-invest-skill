/**
 * Команда search: поиск инструментов по названию, тикеру или ISIN.
 *
 * Экспорты:
 * - SearchApi — контракт клиента для команды;
 * - SearchResultView — представление результата поиска;
 * - searchInstruments(api, query) — поиск и маппинг (пустой список — валидный
 *   результат, не ошибка);
 * - renderSearchResults(views) — таблица для вывода.
 */
import type { FindInstrumentResponse } from '../api/types.js';
import { renderTable, truncate } from '../format/table.js';
import { DASH } from '../format/values.js';

export interface SearchApi {
  findInstrument(query: string): Promise<FindInstrumentResponse>;
}

export interface SearchResultView {
  ticker: string;
  name: string;
  instrumentType: string;
  classCode: string;
  uid: string;
  figi: string;
  isin: string | null;
  currency: string | null;
  lot: number | null;
}

export async function searchInstruments(api: SearchApi, query: string): Promise<SearchResultView[]> {
  const { instruments } = await api.findInstrument(query);
  return instruments.map((i) => ({
    ticker: i.ticker,
    name: i.name,
    instrumentType: i.instrumentType,
    classCode: i.classCode,
    uid: i.uid,
    figi: i.figi,
    isin: i.isin ?? null,
    currency: i.currency ?? null,
    lot: i.lot ?? null,
  }));
}

// Ширина колонки «Название» в человекочитаемой таблице (в --json имя полное).
const MAX_NAME_WIDTH = 60;

export function renderSearchResults(views: SearchResultView[]): string {
  // Пустой результат — честное сообщение вместо пустой таблицы.
  if (views.length === 0) {
    return 'Ничего не найдено. Уточните запрос: название компании, тикер или ISIN.';
  }
  return renderTable(
    ['Тикер', 'Название', 'Тип', 'Класс', 'Валюта', 'Лот'],
    views.map((v) => [
      v.ticker,
      truncate(v.name, MAX_NAME_WIDTH),
      v.instrumentType,
      v.classCode,
      v.currency ? v.currency.toUpperCase() : DASH,
      v.lot !== null ? String(v.lot) : DASH,
    ]),
  );
}
