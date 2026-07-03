/**
 * Единое представление «значение или прочерк» для табличного вывода CLI.
 *
 * Раньше символ прочерка и формат процентов объявлялись локально в двух десятках
 * команд, из-за чего формат уже разошёлся (toFixed(2) против toFixed(1), «%»
 * с пробелом и без). Здесь — один источник, чтобы «нет данных» и знак процента
 * выглядели одинаково во всех командах.
 *
 * Экспорты:
 * - DASH — символ «нет данных» («—»);
 * - formatOrDash(value, digits) — число с фикс. точностью или прочерк;
 * - percentOrDash(value, digits) — «12.34%» или прочерк;
 * - moneyOrDash(value, digits) — сумма с группировкой разрядов или прочерк.
 */
import { formatAmount } from '../api/money.js';

// Единый символ «нет данных» для всех таблиц CLI.
export const DASH = '—';

// Точность по умолчанию для числовых ячеек и процентов.
const DEFAULT_DIGITS = 2;

export function formatOrDash(value: number | null | undefined, digits = DEFAULT_DIGITS): string {
  // Прочерк только при реальном отсутствии значения; настоящий 0 форматируется.
  return value === null || value === undefined ? DASH : value.toFixed(digits);
}

export function percentOrDash(value: number | null | undefined, digits = DEFAULT_DIGITS): string {
  return value === null || value === undefined ? DASH : `${value.toFixed(digits)}%`;
}

export function moneyOrDash(value: number | null | undefined, digits = DEFAULT_DIGITS): string {
  return value === null || value === undefined ? DASH : formatAmount(value, digits);
}
