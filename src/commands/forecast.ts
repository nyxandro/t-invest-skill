/**
 * Команда forecast: прогнозы аналитиков и консенсус по инструменту.
 *
 * Экспорты:
 * - ForecastApi — контракт клиента для команды;
 * - ForecastTargetView, ForecastView — представление;
 * - fetchForecast(api, query) — консенсус + прогнозы отдельных домов;
 * - renderForecast(view) — вывод для терминала.
 *
 * Прогнозы есть в основном по ликвидным акциям; пустой ответ API —
 * явная ошибка с пояснением, а не пустой «успех».
 */
import { AppError } from '../api/errors.js';
import { quotationToNumberOrNull } from '../api/money.js';
import type { GetForecastResponse } from '../api/types.js';
import { renderTable } from '../format/table.js';
import { DASH, formatOrDash, percentOrDash } from '../format/values.js';
import { resolveInstrument, type InstrumentSearchApi } from './resolve-instrument.js';

export interface ForecastApi extends InstrumentSearchApi {
  getForecastBy(instrumentId: string): Promise<GetForecastResponse>;
}

// Человекочитаемые ярлыки рекомендаций (enum API → русский).
const RECOMMENDATION_LABELS: Record<string, string> = {
  RECOMMENDATION_BUY: 'покупать',
  RECOMMENDATION_HOLD: 'держать',
  RECOMMENDATION_SELL: 'продавать',
};

export interface ForecastTargetView {
  company: string;
  recommendation: string | null; // enum API — для машинной обработки
  recommendationLabel: string | null; // русский ярлык — для человека
  date: string | null;
  targetPrice: number | null;
  upsidePercent: number | null; // потенциал к текущей цене
}

export interface ForecastView {
  ticker: string;
  name: string;
  consensus: {
    recommendation: string | null;
    recommendationLabel: string | null;
    currentPrice: number | null;
    consensusPrice: number | null;
    minTarget: number | null;
    maxTarget: number | null;
    upsidePercent: number | null;
  } | null;
  targets: ForecastTargetView[];
}

function labelFor(recommendation: string | undefined): string | null {
  return recommendation ? (RECOMMENDATION_LABELS[recommendation] ?? recommendation) : null;
}

export async function fetchForecast(api: ForecastApi, query: string): Promise<ForecastView> {
  const resolved = await resolveInstrument(api, query);
  const response = await api.getForecastBy(resolved.uid);

  const targets = response.targets ?? [];
  const consensus = response.consensus;
  if (!consensus && targets.length === 0) {
    throw new AppError({
      code: 'APP_TINVEST_FORECAST_UNAVAILABLE',
      userMessage: `По «${resolved.ticker}» нет прогнозов аналитиков — обычно они публикуются только для ликвидных акций.`,
    });
  }

  return {
    ticker: resolved.ticker,
    name: resolved.name,
    consensus: consensus
      ? {
          recommendation: consensus.recommendation ?? null,
          recommendationLabel: labelFor(consensus.recommendation),
          currentPrice: quotationToNumberOrNull(consensus.currentPrice),
          consensusPrice: quotationToNumberOrNull(consensus.consensus),
          minTarget: quotationToNumberOrNull(consensus.minTarget),
          maxTarget: quotationToNumberOrNull(consensus.maxTarget),
          upsidePercent: quotationToNumberOrNull(consensus.priceChangeRel),
        }
      : null,
    targets: targets.map((t) => ({
      company: t.company,
      recommendation: t.recommendation ?? null,
      recommendationLabel: labelFor(t.recommendation),
      date: t.recommendationDate ?? null,
      targetPrice: quotationToNumberOrNull(t.targetPrice),
      upsidePercent: quotationToNumberOrNull(t.priceChangeRel),
    })),
  };
}

export function renderForecast(view: ForecastView): string {
  // Цены — formatOrDash (2 знака), потенциал — percentOrDash (1 знак).
  const lines = [`${view.name} (${view.ticker})`];
  if (view.consensus) {
    lines.push(
      `Консенсус: ${view.consensus.recommendationLabel ?? DASH} — цель ${formatOrDash(view.consensus.consensusPrice)} ` +
        `(диапазон ${formatOrDash(view.consensus.minTarget)}–${formatOrDash(view.consensus.maxTarget)}), ` +
        `потенциал ${percentOrDash(view.consensus.upsidePercent, 1)} к цене ${formatOrDash(view.consensus.currentPrice)}`,
    );
  }
  if (view.targets.length > 0) {
    lines.push(
      '',
      renderTable(
        ['Аналитик', 'Рекомендация', 'Цель', 'Потенциал', 'Дата'],
        view.targets.map((t) => [
          t.company,
          t.recommendationLabel ?? DASH,
          formatOrDash(t.targetPrice),
          percentOrDash(t.upsidePercent, 1),
          t.date ? t.date.slice(0, 10) : DASH,
        ]),
      ),
    );
  }
  return lines.join('\n');
}
