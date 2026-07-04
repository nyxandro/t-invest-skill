/**
 * Контекст цены инструмента для вывода торговых команд: единица цены
 * (пункты/валюта) и — для облигаций — номинал в рублях для рублёвого
 * эквивалента котировки. Общий для order/preview/replace/stop-рендеров.
 *
 * Экспорты:
 * - BondNominalApi — контракт клиента (getBondBy);
 * - PricingContext — { priceUnit, nominalRub };
 * - resolvePricingContext(api, instrumentType, uid) — единица по типу инструмента
 *   плюс номинал облигации; best-effort — сбой карточки даёт nominalRub=null
 *   (вывод деградирует до метки «пт» без ₽-эквивалента, но команда не падает,
 *   т.к. номинал — презентационное обогащение, а не данные заявки);
 * - pricingForFigi(api, figi) — полный контекст (единица + номинал) по FIGI
 *   заявки (для детального вывода order status);
 * - priceUnitsByFigi(api, figis) — карта FIGI→единица цены батчем с троттлингом
 *   (для таблицы order list; номинал в таблице не тянем — только метка «пт»).
 */
import { moneyToNumberOrNull } from '../../api/money.js';
import type { BondResponse } from '../../api/types.js';
import { BATCH_CONCURRENCY, BATCH_MIN_INTERVAL_MS } from '../../config/config.js';
import { priceUnitFor, type PriceUnit } from '../../format/units.js';
import { mapWithConcurrency } from '../../util/concurrency.js';
import { resolveLabelByFigi, type InstrumentSearchApi } from '../resolve-instrument.js';

export interface BondNominalApi {
  getBondBy(uid: string): Promise<BondResponse>;
}

export interface PricingContext {
  priceUnit: PriceUnit;
  nominalRub: number | null;
}

// Контекст цены по умолчанию (единица не определена) — когда инструмент заявки
// не удалось резолвить: не роняем вывод, показываем как валюту без ₽-эквивалента.
const CURRENCY_CONTEXT: PricingContext = { priceUnit: 'currency', nominalRub: null };

export async function resolvePricingContext(
  api: BondNominalApi,
  instrumentType: string,
  uid: string,
): Promise<PricingContext> {
  const priceUnit = priceUnitFor(instrumentType);
  // Номинал нужен только облигациям (для ₽-эквивалента цены в пунктах).
  // У фьючерсов перевод пунктов в рубли иной (шаг цены) и тут не считается → null.
  if (instrumentType !== 'bond') {
    return { priceUnit, nominalRub: null };
  }
  try {
    const { instrument } = await api.getBondBy(uid);
    return { priceUnit, nominalRub: moneyToNumberOrNull(instrument.nominal) };
  } catch (err) {
    // Номинал — презентационное обогащение (₽-эквивалент), не данные заявки:
    // при сбое карточки продолжаем с меткой «пт» без рублёвого эквивалента.
    console.error(
      `Предупреждение: не удалось получить номинал облигации ${uid} для рублёвого эквивалента: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return { priceUnit, nominalRub: null };
  }
}

// Полный контекст цены по FIGI заявки: ответы GetOrders/GetOrderState не несут
// тип инструмента и номинал, поэтому резолвим бумагу по figi. Не нашли →
// валюта без ₽-эквивалента (презентация, деградация допустима).
export async function pricingForFigi(
  api: BondNominalApi & InstrumentSearchApi,
  figi: string,
): Promise<PricingContext> {
  const info = await resolveLabelByFigi(api, figi);
  if (!info) {
    return CURRENCY_CONTEXT;
  }
  return resolvePricingContext(api, info.instrumentType, info.uid);
}

// Карта FIGI→единица цены для таблицы заявок: батч по уникальным figi с тем же
// троттлингом, что и резолв тикеров (щадим лимиты). Номинал в таблице не тянем
// (₽-эквивалент — только в детальном order status), поэтому здесь без getBondBy.
export async function priceUnitsByFigi(
  api: InstrumentSearchApi,
  figis: string[],
): Promise<Map<string, PriceUnit>> {
  const unique = [...new Set(figis.filter((f): f is string => Boolean(f)))];
  const byFigi = new Map<string, PriceUnit>();
  if (unique.length === 0) {
    return byFigi;
  }
  await mapWithConcurrency(
    unique,
    { concurrency: BATCH_CONCURRENCY, minIntervalMs: BATCH_MIN_INTERVAL_MS },
    async (figi): Promise<null> => {
      // Тип инструмента — не обязательные данные заявки, а метка вывода: при
      // сбое одной карточки оставляем строку без метки (валюта), не роняя список.
      try {
        const info = await resolveLabelByFigi(api, figi);
        if (info) {
          byFigi.set(figi, priceUnitFor(info.instrumentType));
        }
      } catch (err) {
        console.error(
          `Предупреждение: не удалось определить единицу цены по FIGI ${figi}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    },
  );
  return byFigi;
}
