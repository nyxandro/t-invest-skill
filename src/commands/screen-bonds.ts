/**
 * Команда screen bonds: скринер облигаций по всему справочнику —
 * статические фильтры, затем расчёт YTM по ограниченному пулу кандидатов
 * (график купонов на кандидата — один запрос API, с недельным кэшем).
 *
 * Экспорты:
 * - ScreenBondsApi — контракт клиента;
 * - ScreenBondsFilter — параметры фильтра;
 * - staticFilterBonds(items, filter, now) — чистый статический фильтр;
 * - rankAndCapCandidates(items, cap) — приоритезация пула для расчёта;
 * - screenBonds(api, params) — полный конвейер скрининга;
 * - renderScreenBonds(view) — таблица результатов.
 */
import { moneyToNumber, quotationToNumber, formatAmount } from '../api/money.js';
import type { GetBondCouponsResponse, GetLastPricesResponse } from '../api/types.js';
import type { BondListItem } from '../api/types-catalog.js';
import { loadCatalog, contourForMode, type CatalogApi } from '../catalog/instrument-catalog.js';
import {
  couponCachePath,
  getFreshCouponEntry,
  loadCouponCache,
  saveCouponCache,
} from '../catalog/coupon-cache.js';
import {
  BATCH_CONCURRENCY,
  BATCH_MIN_INTERVAL_MS,
  CATALOG_CACHE_DIR,
  LAST_PRICES_CHUNK,
  SCREEN_BONDS_MAX_CANDIDATES,
  SCREEN_TOP_DEFAULT,
  type TInvestMode,
} from '../config/config.js';
import { renderTable } from '../format/table.js';
import { mapWithConcurrency } from '../util/concurrency.js';
import { computeEffectiveYtmPercent, computeMacaulayDurationYears, type BondCashFlow } from './bond-math.js';

export interface ScreenBondsApi extends CatalogApi {
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
  getBondCoupons(instrumentId: string, from: string, to: string): Promise<GetBondCouponsResponse>;
}

export interface ScreenBondsFilter {
  currency: string;
  yearsMin: number | null;
  yearsMax: number | null;
  ytmMin: number | null;
  riskMax: 'low' | 'moderate' | 'high' | null;
  includeOffer: boolean; // включать выпуски с офертой (расчёт к оферте)
  includeQual: boolean; // включать бумаги «только для квалов»
  top: number;
  maxCandidates: number;
}

export interface ScreenBondRow {
  ticker: string;
  isin: string | null;
  name: string;
  sector: string | null;
  pricePercent: number;
  ytmPercent: number; // к погашению, либо к оферте (см. toOffer)
  toOffer: boolean; // true — доходность и срок считались к оферте
  horizonDate: string; // дата погашения или оферты
  yearsToHorizon: number;
  durationYears: number | null;
  couponsPerYear: number | null;
  riskLevel: string | null;
}

export interface ScreenBondsView {
  totalInCatalog: number;
  matchedStatic: number; // прошло статические фильтры
  computed: number; // по скольким рассчитан YTM
  droppedByCap: number; // отброшено потолком кандидатов
  rows: ScreenBondRow[];
  warnings: string[];
}

const MS_PER_YEAR = 365 * 24 * 3600 * 1000;
const MS_PER_DAY = 24 * 3600 * 1000;

// Порядок уровней риска для фильтра --risk-max.
const RISK_ORDER: Record<string, number> = {
  RISK_LEVEL_LOW: 1,
  RISK_LEVEL_MODERATE: 2,
  RISK_LEVEL_HIGH: 3,
};
const RISK_MAX_VALUE: Record<'low' | 'moderate' | 'high', number> = {
  low: 1,
  moderate: 2,
  high: 3,
};

function yearsBetween(from: Date, toIso: string): number {
  return (new Date(toIso).getTime() - from.getTime()) / MS_PER_YEAR;
}

// Горизонт выпуска: оферта (если есть и в будущем) раньше погашения.
function horizonOf(item: BondListItem, now: Date): { date: string; toOffer: boolean } | null {
  const offer = item.callDate && Date.parse(item.callDate) > now.getTime() ? item.callDate : null;
  if (offer) {
    return { date: offer, toOffer: true };
  }
  return item.maturityDate ? { date: item.maturityDate, toOffer: false } : null;
}

export function staticFilterBonds(
  items: BondListItem[],
  filter: ScreenBondsFilter,
  now: Date,
): BondListItem[] {
  return items.filter((item) => {
    // Валюта и торгуемость через API — обязательные условия.
    if (item.currency !== filter.currency || item.apiTradeAvailableFlag === false) {
      return false;
    }
    if (item.buyAvailableFlag === false) {
      return false;
    }
    // Типы выпусков, для которых YTM некорректна, отфильтровываются сразу.
    if (item.floatingCouponFlag || item.amortizationFlag || item.perpetualFlag || item.subordinatedFlag) {
      return false;
    }
    if (item.forQualInvestorFlag && !filter.includeQual) {
      return false;
    }
    const horizon = horizonOf(item, now);
    if (!horizon) {
      return false; // ни погашения, ни оферты — нечего считать
    }
    if (horizon.toOffer && !filter.includeOffer) {
      return false;
    }
    const years = yearsBetween(now, horizon.date);
    if (years <= 0) {
      return false;
    }
    if (filter.yearsMin !== null && years < filter.yearsMin) {
      return false;
    }
    if (filter.yearsMax !== null && years > filter.yearsMax) {
      return false;
    }
    // Фильтр риска консервативен: нет уровня — не пропускаем при заданном max.
    if (filter.riskMax !== null) {
      const level = item.riskLevel ? RISK_ORDER[item.riskLevel] : undefined;
      if (level === undefined || level > RISK_MAX_VALUE[filter.riskMax]) {
        return false;
      }
    }
    return true;
  });
}

// Приоритет расчёта: сначала ликвидные, затем ближние погашения — так
// потолок кандидатов срезает наименее ликвидный хвост, а не случайные бумаги.
export function rankAndCapCandidates(items: BondListItem[], cap: number): BondListItem[] {
  return [...items]
    .sort((a, b) => {
      const liquidity = Number(Boolean(b.liquidityFlag)) - Number(Boolean(a.liquidityFlag));
      if (liquidity !== 0) {
        return liquidity;
      }
      return (a.maturityDate ?? '9999').localeCompare(b.maturityDate ?? '9999');
    })
    .slice(0, cap);
}

// Сумма купона; null — выплата не определена (protobuf опускает нули).
function couponAmount(coupon: { payOneBond?: { currency: string; units: string; nano: number } }): number | null {
  if (!coupon.payOneBond) {
    return null;
  }
  const value = moneyToNumber(coupon.payOneBond);
  return value > 0 ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function screenBonds(
  api: ScreenBondsApi,
  params: { filter: ScreenBondsFilter; mode: TInvestMode; now: Date; cacheDir?: string },
): Promise<ScreenBondsView> {
  const { filter, mode, now } = params;
  const cacheDir = params.cacheDir ?? CATALOG_CACHE_DIR;
  const warnings: string[] = [];

  const catalog = await loadCatalog(api, 'bonds', mode, now, cacheDir);
  const matched = staticFilterBonds(catalog.items, filter, now);
  const candidates = rankAndCapCandidates(matched, filter.maxCandidates);
  const droppedByCap = matched.length - candidates.length;
  if (droppedByCap > 0) {
    warnings.push(
      `Под фильтр попало ${matched.length} выпусков; YTM рассчитан по ${candidates.length} ` +
        `наиболее ликвидным (потолок --max-candidates). Отброшено: ${droppedByCap}.`,
    );
  }

  // Котировки батчами: protobuf может опустить price — такие выпуски без торгов.
  const priceByUid = new Map<string, number>();
  for (let i = 0; i < candidates.length; i += LAST_PRICES_CHUNK) {
    const chunk = candidates.slice(i, i + LAST_PRICES_CHUNK);
    const { lastPrices } = await api.getLastPrices(chunk.map((c) => c.uid));
    for (const price of lastPrices) {
      if (price.price && price.instrumentUid) {
        priceByUid.set(price.instrumentUid, quotationToNumber(price.price));
      }
    }
  }

  // Графики купонов: кэш на неделю, недостающие — из API с троттлингом.
  const couponCacheFile = couponCachePath(cacheDir, contourForMode(mode));
  const couponCache = loadCouponCache(couponCacheFile);
  const toFetch = candidates.filter(
    (c) => priceByUid.has(c.uid) && !getFreshCouponEntry(couponCache, c.uid, now),
  );
  if (toFetch.length > 0) {
    console.error(`Скринер: запрашиваю графики купонов по ${toFetch.length} выпускам...`);
    const fetched = await mapWithConcurrency(
      toFetch,
      { concurrency: BATCH_CONCURRENCY, minIntervalMs: BATCH_MIN_INTERVAL_MS },
      async (item) => {
        const from = new Date(now.getTime() - MS_PER_DAY).toISOString();
        const to = new Date(Date.parse(item.maturityDate ?? item.callDate!) + MS_PER_DAY).toISOString();
        const resp = await api.getBondCoupons(item.uid, from, to);
        return [item.uid, resp.events ?? []] as const;
      },
    );
    for (const [uid, events] of fetched) {
      couponCache[uid] = { savedAt: now.toISOString(), events };
    }
    saveCouponCache(couponCacheFile, couponCache);
  }

  // Расчёт YTM: потоки будущих купонов + номинал на горизонте (погашение/оферта).
  const rows: ScreenBondRow[] = [];
  let computed = 0;
  for (const item of candidates) {
    const pricePercent = priceByUid.get(item.uid);
    const nominal = item.nominal ? moneyToNumber(item.nominal) : null;
    const horizon = horizonOf(item, now);
    const events = couponCache[item.uid]?.events;
    if (pricePercent === undefined || nominal === null || !horizon || !events) {
      continue;
    }
    const horizonTime = Date.parse(horizon.date);
    const future = events
      .filter((c) => {
        const t = Date.parse(c.couponDate);
        return t > now.getTime() && t <= horizonTime + MS_PER_DAY;
      })
      .sort((a, b) => a.couponDate.localeCompare(b.couponDate));
    // Все будущие купоны до горизонта должны быть объявлены — иначе пропуск.
    if (future.length === 0 || !future.every((c) => couponAmount(c) !== null)) {
      continue;
    }
    // НКД из справочника (кэш до суток) — погрешность скрининга приемлема,
    // точный расчёт даёт карточка bond по конкретному выпуску.
    const aci = item.aciValue ? moneyToNumber(item.aciValue) : 0;
    const dirtyPrice = (pricePercent / 100) * nominal + aci;
    const flows: BondCashFlow[] = future.map((c) => ({
      date: new Date(c.couponDate),
      amount: couponAmount(c)!,
    }));
    flows.push({ date: new Date(horizon.date), amount: nominal });
    const ytm = computeEffectiveYtmPercent(flows, dirtyPrice, now);
    computed += 1;
    if (ytm === null || (filter.ytmMin !== null && ytm < filter.ytmMin)) {
      continue;
    }
    rows.push({
      ticker: item.ticker,
      isin: item.isin ?? null,
      name: item.name,
      sector: item.sector ?? null,
      pricePercent: round2(pricePercent),
      ytmPercent: round2(ytm),
      toOffer: horizon.toOffer,
      horizonDate: horizon.date.slice(0, 10),
      yearsToHorizon: round2(yearsBetween(now, horizon.date)),
      durationYears: (() => {
        const duration = computeMacaulayDurationYears(flows, ytm, now);
        return duration !== null ? round2(duration) : null;
      })(),
      couponsPerYear: item.couponQuantityPerYear ?? null,
      riskLevel: item.riskLevel ?? null,
    });
  }

  rows.sort((a, b) => b.ytmPercent - a.ytmPercent);
  return {
    totalInCatalog: catalog.items.length,
    matchedStatic: matched.length,
    computed,
    droppedByCap,
    rows: rows.slice(0, filter.top),
    warnings,
  };
}

export function defaultScreenBondsFilter(): ScreenBondsFilter {
  return {
    currency: 'rub',
    yearsMin: null,
    yearsMax: null,
    ytmMin: null,
    riskMax: null,
    includeOffer: false,
    includeQual: false,
    top: SCREEN_TOP_DEFAULT,
    maxCandidates: SCREEN_BONDS_MAX_CANDIDATES,
  };
}

export function renderScreenBonds(view: ScreenBondsView): string {
  const dash = '—';
  const lines = [
    `Каталог: ${view.totalInCatalog} выпусков | под фильтр: ${view.matchedStatic} | рассчитано: ${view.computed}`,
    '',
  ];
  if (view.rows.length === 0) {
    lines.push('Подходящих выпусков не найдено — ослабьте фильтры.');
  } else {
    lines.push(
      renderTable(
        ['Тикер', 'Название', 'Цена %', 'YTM %', 'Горизонт', 'Лет', 'Дюрация', 'Риск'],
        view.rows.map((r) => [
          r.ticker,
          r.name.length > 30 ? `${r.name.slice(0, 29)}…` : r.name,
          formatAmount(r.pricePercent),
          formatAmount(r.ytmPercent),
          `${r.horizonDate}${r.toOffer ? ' (оферта)' : ''}`,
          formatAmount(r.yearsToHorizon, 1),
          r.durationYears !== null ? formatAmount(r.durationYears, 1) : dash,
          r.riskLevel?.replace('RISK_LEVEL_', '').toLowerCase() ?? dash,
        ]),
      ),
    );
  }
  for (const warning of view.warnings) {
    lines.push('', `⚠ ${warning}`);
  }
  return lines.join('\n');
}
