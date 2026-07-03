/**
 * Единые хелперы направления сделки (покупка/продажа) для CLI и торговых команд.
 *
 * Раньше маппинги enum API ↔ 'buy'/'sell' и русские подписи дублировались в
 * шести местах, причём один из них выдумывал 'buy' для отсутствующего в ответе
 * поля direction (protobuf-JSON опускает незаполненное) — из-за чего заявка на
 * продажу могла отрапортоваться как «покупка». Здесь один источник, и на
 * неизвестное значение честно возвращается null.
 *
 * Экспорты:
 * - TradeDirection — 'buy' | 'sell';
 * - orderDirectionToApi(dir) / stopDirectionToApi(dir) — 'buy'/'sell' → enum API;
 * - directionFromApi(raw) — enum API (order/stop) → 'buy'/'sell' | null;
 * - directionLabel(dir) — «покупка»/«продажа»/прочерк;
 * - directionPhrase(dir) — «на покупку»/«на продажу» для фраз в предложениях.
 */
import type { OrderDirection, StopOrderDirection } from '../api/types-trading.js';
import { DASH } from './values.js';

export type TradeDirection = 'buy' | 'sell';

export function orderDirectionToApi(dir: TradeDirection): OrderDirection {
  return dir === 'buy' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL';
}

export function stopDirectionToApi(dir: TradeDirection): StopOrderDirection {
  return dir === 'buy' ? 'STOP_ORDER_DIRECTION_BUY' : 'STOP_ORDER_DIRECTION_SELL';
}

// enum API (и order-, и stop-варианты) → 'buy'/'sell'. Для отсутствующего или
// незнакомого значения — null: направление реальной заявки нельзя угадывать.
export function directionFromApi(raw: string | undefined): TradeDirection | null {
  if (raw === 'ORDER_DIRECTION_BUY' || raw === 'STOP_ORDER_DIRECTION_BUY') {
    return 'buy';
  }
  if (raw === 'ORDER_DIRECTION_SELL' || raw === 'STOP_ORDER_DIRECTION_SELL') {
    return 'sell';
  }
  return null;
}

export function directionLabel(dir: TradeDirection | null): string {
  if (dir === 'buy') {
    return 'покупка';
  }
  if (dir === 'sell') {
    return 'продажа';
  }
  return DASH;
}

export function directionPhrase(dir: TradeDirection): string {
  return dir === 'buy' ? 'на покупку' : 'на продажу';
}
