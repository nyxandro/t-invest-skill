/**
 * Выбор типа цены заявки (priceType) по типу инструмента для T-Invest API.
 *
 * Зачем: биржевая цена облигаций и фьючерсов котируется в ПУНКТАХ (для
 * облигаций — % номинала), а не в валюте расчётов. При выставлении заявки
 * сервер обязан знать, как трактовать переданную цену. Без явного priceType
 * цена в пунктах (напр. 103.20) интерпретируется как валюта (103.20 ₽), что
 * для бумаги с номиналом ~1000 ₽ далеко за биржевым коридором цен → отклонение
 * «The price is outside the limits for this instrument».
 *
 * Экспорты:
 * - priceTypeFor(instrumentType) — PRICE_TYPE_POINT для облигаций/фьючерсов,
 *   иначе PRICE_TYPE_CURRENCY.
 *
 * Набор «пунктовых» типов — единый источник в format/units.ts (там же его
 * использует форматирование вывода), чтобы priceType заявки и метка единицы
 * в выводе не разошлись.
 */
import type { PriceType } from '../../api/types-trading.js';
import { POINT_PRICED_INSTRUMENT_TYPES } from '../../format/units.js';

// Тип цены по типу инструмента. Облигации/фьючерсы → пункты, всё остальное
// (акции, фонды, валюта) → валюта расчётов. Явный тип обязателен для любой
// заявки с ценой: пропуск ломает именно облигации/фьючерсы (см. заголовок).
export function priceTypeFor(instrumentType: string): PriceType {
  return POINT_PRICED_INSTRUMENT_TYPES.includes(instrumentType)
    ? 'PRICE_TYPE_POINT'
    : 'PRICE_TYPE_CURRENCY';
}
