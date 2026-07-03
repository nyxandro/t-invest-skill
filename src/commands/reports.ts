/**
 * Команда reports: календарь отчётностей эмитента (GetAssetReports) —
 * прошедшие и ожидаемые публикации отчётов.
 *
 * Экспорты:
 * - ReportsApi — контракт клиента;
 * - ReportEventView — представление события отчётности;
 * - buildReportsView(...) — чистая сборка с русскими подписями периодов;
 * - fetchReports(api, query, now) — резолв + загрузка + сборка;
 * - renderReports(view) — человекочитаемый вывод.
 */
import type { AssetReportEvent, GetAssetReportsResponse } from '../api/types-info.js';
import { MS_PER_DAY, REPORTS_WINDOW_DAYS } from '../config/config.js';
import { resolveInstrument, type InstrumentSearchApi } from './resolve-instrument.js';

export interface ReportsApi extends InstrumentSearchApi {
  getAssetReports(instrumentId: string, from: string, to: string): Promise<GetAssetReportsResponse>;
}

export interface ReportEventView {
  reportDate: string; // дата публикации (до дня)
  periodLabel: string; // «1 квартал 2026», «2026 год»
  upcoming: boolean; // публикация ещё впереди
}

export interface ReportsView {
  ticker: string;
  name: string;
  from: string;
  to: string;
  events: ReportEventView[];
}

// Русская подпись отчётного периода.
function periodLabel(event: AssetReportEvent): string {
  const year = event.periodYear ?? '';
  switch (event.periodType) {
    case 'PERIOD_TYPE_QUARTER':
      return `${event.periodNum ?? '?'} квартал ${year}`;
    case 'PERIOD_TYPE_SEMIANNUAL':
      return `${event.periodNum ?? '?'} полугодие ${year}`;
    case 'PERIOD_TYPE_ANNUAL':
      return `${year} год`;
    default:
      return `${event.periodType ?? 'период'} ${year}`;
  }
}

export function buildReportsView(params: {
  ticker: string;
  name: string;
  from: string;
  to: string;
  events: AssetReportEvent[];
  now: Date;
}): ReportsView {
  const events = params.events
    .filter((e): e is AssetReportEvent & { reportDate: string } => Boolean(e.reportDate))
    .sort((a, b) => a.reportDate!.localeCompare(b.reportDate!))
    .map((e) => ({
      reportDate: e.reportDate.slice(0, 10),
      periodLabel: periodLabel(e),
      upcoming: Date.parse(e.reportDate) > params.now.getTime(),
    }));
  return { ticker: params.ticker, name: params.name, from: params.from, to: params.to, events };
}

export async function fetchReports(api: ReportsApi, query: string, now: Date): Promise<ReportsView> {
  const instrument = await resolveInstrument(api, query);
  // Окно: полгода назад и полгода вперёд — прошлые отчёты + ожидаемые.
  const from = new Date(now.getTime() - REPORTS_WINDOW_DAYS * MS_PER_DAY).toISOString();
  const to = new Date(now.getTime() + REPORTS_WINDOW_DAYS * MS_PER_DAY).toISOString();
  const resp = await api.getAssetReports(instrument.uid, from, to);
  return buildReportsView({
    ticker: instrument.ticker,
    name: instrument.name,
    from,
    to,
    events: resp.events ?? [],
    now,
  });
}

export function renderReports(view: ReportsView): string {
  const header = `${view.ticker} — ${view.name}: календарь отчётностей (${view.from.slice(0, 10)} — ${view.to.slice(0, 10)})`;
  if (view.events.length === 0) {
    return `${header}\nСобытий отчётности в этом окне нет.`;
  }
  const lines = [header, ''];
  for (const event of view.events) {
    lines.push(`• ${event.reportDate} — отчёт за ${event.periodLabel}${event.upcoming ? ' (ожидается)' : ''}`);
  }
  return lines.join('\n');
}
