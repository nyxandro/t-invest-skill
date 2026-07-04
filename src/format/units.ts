/**
 * Единицы цены инструментов и их форматирование для вывода CLI.
 *
 * Облигации и фьючерсы котируются в ПУНКТАХ (для облигаций — % номинала),
 * а не в валюте расчётов. Чтобы пользователь не принял пункты за рубли, цену
 * помечаем единицей, а для облигаций рядом показываем рублёвый эквивалент.
 *
 * Экспорты:
 * - POINT_PRICED_INSTRUMENT_TYPES — типы, торгуемые в пунктах (bond, futures);
 * - PriceUnit — 'point' | 'currency' (единица цены; попадает и в JSON-вывод);
 * - priceUnitFor(instrumentType) — единица цены по типу инструмента;
 * - priceUnitFromCurrency(currency) — единица по валюте самого поля из ответа
 *   API (для read-back полей: контуры отдают цену в разных единицах);
 * - formatInstrumentPrice(value, opts) — цена с меткой единицы и (для облигаций)
 *   рублёвым эквивалентом: «100.50 пт (≈ 1 005.00 ₽/шт)»;
 * - formatMoneyAmount(value, currency) — сумма с валютой/пунктами: «1 007.76 ₽».
 */
import { currencySymbol, formatAmount } from '../api/money.js';

// Инструменты, чья биржевая цена котируется в пунктах, а не в валюте расчётов:
// облигации — процент номинала, фьючерсы — пункты контракта. Значения
// instrumentType — как их отдаёт InstrumentsService/FindInstrument. Единый
// источник и для priceType заявок (см. commands/trading/price-type.ts).
export const POINT_PRICED_INSTRUMENT_TYPES: readonly string[] = ['bond', 'futures'];

// Метка единицы «пункты» в выводе и токены валюты из ответов API, означающие
// пункты: REST-шлюз присылает у суммы ещё не исполненной заявки currency "pt.".
const POINTS_LABEL = 'пт';
const POINTS_CURRENCY_TOKENS: readonly string[] = ['pt.', 'pt', 'point', 'points'];

// Пунктов в 100 % номинала — делитель перевода котировки облигации в рубли.
const POINTS_PER_NOMINAL = 100;

export type PriceUnit = 'point' | 'currency';

export function priceUnitFor(instrumentType: string): PriceUnit {
  return POINT_PRICED_INSTRUMENT_TYPES.includes(instrumentType) ? 'point' : 'currency';
}

// true, если код валюты из ответа API означает «пункты», а не деньги.
function isPointsCurrency(currency: string | null | undefined): boolean {
  return typeof currency === 'string' && POINTS_CURRENCY_TOKENS.includes(currency.toLowerCase());
}

// Единица цены по валюте САМОГО поля из ответа API — для read-back полей
// (initialSecurityPrice заявки, stopPrice стоп-заявки). Один и тот же инструмент
// боевой контур (OrdersService) отдаёт в пунктах (currency "pt."), а песочница
// (SandboxService) — в рублях (currency "rub"). Поэтому единицу берём из поля, а
// не из типа инструмента. null — валюта не пришла: пусть решает вызывающий (по типу).
export function priceUnitFromCurrency(currency: string | null | undefined): PriceUnit | null {
  if (isPointsCurrency(currency)) {
    return 'point';
  }
  if (typeof currency === 'string' && currency.trim() !== '') {
    return 'currency';
  }
  return null;
}

export function formatInstrumentPrice(
  value: number,
  opts: { unit: PriceUnit; nominalRub?: number | null; currency?: string | null },
): string {
  // Цена в валюте: число + символ валюты, если он известен. Символ не навязываем
  // при отсутствии кода — инструмент может быть номинирован в иной валюте.
  if (opts.unit === 'currency') {
    return opts.currency ? `${formatAmount(value)} ${currencySymbol(opts.currency)}` : formatAmount(value);
  }
  // Цена в пунктах: помечаем «пт». Для облигаций (известен номинал) добавляем
  // рублёвый эквивалент за одну бумагу — чтобы пункты не приняли за рубли.
  const base = `${formatAmount(value)} ${POINTS_LABEL}`;
  if (opts.nominalRub === null || opts.nominalRub === undefined) {
    return base;
  }
  const rubPerUnit = (value / POINTS_PER_NOMINAL) * opts.nominalRub;
  return `${base} (≈ ${formatAmount(rubPerUnit)} ₽/шт)`;
}

export function formatMoneyAmount(value: number, currency: string | null | undefined): string {
  // Сумма ещё не исполненной заявки по облигации приходит в пунктах (currency
  // "pt.") — помечаем «пт»; настоящая валюта → её символ; нет кода → просто число.
  if (isPointsCurrency(currency)) {
    return `${formatAmount(value)} ${POINTS_LABEL}`;
  }
  return currency ? `${formatAmount(value)} ${currencySymbol(currency)}` : formatAmount(value);
}
