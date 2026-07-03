/**
 * Работа с денежными примитивами T-Invest API.
 *
 * Экспорты:
 * - quotationToNumber(q) — Quotation {units, nano} → число;
 * - quotationToNumberOrNull(q?) / moneyToNumberOrNull(m?) — та же конвертация,
 *   но null для опущенного поля (protobuf-JSON опускает незаполненные message);
 * - numberToQuotation(value) — число → Quotation (для торговых запросов);
 * - moneyToNumber(m) — MoneyValue → число (та же математика);
 * - round(value, digits) — округление до знака (единый хелпер для команд);
 * - formatAmount(value, fractionDigits) — «1 234 567.89» для таблиц CLI;
 * - formatSigned(value) — как formatAmount, но с явным знаком «+»;
 * - currencySymbol(code) — символ валюты для вывода (₽, $, €);
 * - formatMoney(m) — «1 234.56 ₽».
 */
import type { MoneyValue, Quotation } from './types.js';

// nano — миллиардные доли единицы (см. контракт T-Invest API).
const NANO_PER_UNIT = 1_000_000_000;

// Символы основных валют — сугубо презентационный маппинг,
// поэтому для неизвестного кода допустим вывод самого кода.
const CURRENCY_SYMBOLS: Record<string, string> = {
  rub: '₽',
  usd: '$',
  eur: '€',
  cny: '¥',
  gbp: '£',
};

export function quotationToNumber(q: Quotation): number {
  // REST-шлюз сериализует int64 как строку; знак у units и nano совпадает.
  return Number(q.units) + q.nano / NANO_PER_UNIT;
}

// Нормализация опускаемых message-полей: protobuf-JSON опускает незаполненные
// Quotation/MoneyValue (цена без торгов, доходность без данных). Возвращаем
// null, но НАСТОЯЩИЙ ноль {0,0} сохраняем как 0 — в отличие от `q?.price ? … : null`.
export function quotationToNumberOrNull(q: Quotation | undefined): number | null {
  return q === undefined ? null : quotationToNumber(q);
}

export function moneyToNumberOrNull(m: MoneyValue | undefined): number | null {
  return m === undefined ? null : quotationToNumber(m);
}

export function numberToQuotation(value: number): Quotation {
  // Обратная конвертация для торговых запросов: целая часть + миллиардные
  // доли, знаки согласованы (контракт API). Округление до нано убирает
  // артефакты двоичной арифметики (например, 0.1 + 0.2).
  let units = Math.trunc(value);
  let nano = Math.round((value - units) * NANO_PER_UNIT);
  // Перенос разряда: округление дробной части может дать |nano| == 1e9
  // (например, 1.9999999999 → nano 1_000_000_000), что нарушает контракт
  // Quotation |nano| ≤ 999_999_999. Без переноса в units в заявку уйдёт
  // невалидная цена, поэтому нормализуем в обе стороны по знаку.
  if (nano >= NANO_PER_UNIT) {
    units += 1;
    nano -= NANO_PER_UNIT;
  } else if (nano <= -NANO_PER_UNIT) {
    units -= 1;
    nano += NANO_PER_UNIT;
  }
  return { units: String(units), nano };
}

export function moneyToNumber(m: MoneyValue): number {
  return quotationToNumber(m);
}

// Единый хелпер округления для команд (заменяет локальные round2/round4).
// `+ 0` нормализует -0 к 0, чтобы округление нуля не давало «-0» в выводе.
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor + 0;
}

export function formatAmount(value: number, fractionDigits = 2): string {
  // toFixed даёт детерминированное округление, затем группируем разряды пробелами.
  const fixed = value.toFixed(fractionDigits);
  const negative = fixed.startsWith('-');
  const [intPart = '', fracPart] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = negative ? '-' : '';
  return fracPart ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`;
}

export function formatSigned(value: number, fractionDigits = 2): string {
  // Явный «+» помогает мгновенно видеть прибыль/убыток в таблицах.
  return value >= 0 ? `+${formatAmount(value, fractionDigits)}` : formatAmount(value, fractionDigits);
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toLowerCase()] ?? code.toUpperCase();
}

export function formatMoney(m: MoneyValue): string {
  return `${formatAmount(moneyToNumber(m))} ${currencySymbol(m.currency)}`;
}
