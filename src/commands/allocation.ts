/**
 * Команда allocation: структура портфеля — доли по классам активов,
 * секторам, валютам и странам риска + концентрация отдельных позиций.
 *
 * Экспорты:
 * - AllocationApi — контракт клиента;
 * - AllocationSlice — срез {key, value, weightPercent};
 * - buildAllocationView(positions, details, totalValue) — чистая сборка
 *   представления (тестируется без API);
 * - fetchAllocation(api, explicitAccountId?) — загрузка + сборка;
 * - renderAllocation(view) — человекочитаемый отчёт;
 * - renderAllocationChart(view) — ASCII-бары структуры (секторы + классы активов).
 */
import { moneyToNumber, quotationToNumber, formatAmount, round } from '../api/money.js';
import type { InstrumentDetails, PortfolioPosition, PortfolioResponse } from '../api/types.js';
import { loadCatalog, type CatalogApi } from '../catalog/instrument-catalog.js';
import { CONCENTRATION_WARN_PERCENT, type TInvestMode } from '../config/config.js';
import { barChart, type BarChartItem } from '../format/charts.js';
import { renderTable } from '../format/table.js';
import { resolveAccountId, type AccountsApi } from './resolve-account.js';

// Сектор и страна берутся из списочных справочников (Bonds/Shares/Etfs) —
// точечная карточка GetInstrumentBy сектора НЕ содержит (проверено вживую).
export interface AllocationApi extends AccountsApi, CatalogApi {
  getPortfolio(accountId: string): Promise<PortfolioResponse>;
}

export interface AllocationSlice {
  key: string; // человекочитаемый ключ группы («акции», «Энергетика», «rub»)
  value: number;
  weightPercent: number;
}

export interface ConcentrationEntry {
  ticker: string;
  name: string | null;
  value: number;
  weightPercent: number;
}

export interface AllocationView {
  accountId: string;
  totalValue: number;
  currency: string;
  byType: AllocationSlice[];
  bySector: AllocationSlice[];
  byCurrency: AllocationSlice[];
  byCountry: AllocationSlice[];
  // Позиции с долей выше порога — сигнал о концентрации риска.
  concentration: ConcentrationEntry[];
  concentrationThresholdPercent: number;
  warnings: string[];
}

// Русские подписи классов активов (instrumentType из портфеля).
const TYPE_LABELS: Record<string, string> = {
  share: 'акции',
  bond: 'облигации',
  etf: 'фонды',
  currency: 'валюта и кэш',
  futures: 'фьючерсы',
  option: 'опционы',
  sp: 'структурные ноты',
};

// Группировка стоимостей по ключу → срезы с весами, по убыванию доли.
function toSlices(groups: Map<string, number>, totalValue: number): AllocationSlice[] {
  return [...groups.entries()]
    .map(([key, value]) => ({
      key,
      value: round(value),
      weightPercent: totalValue > 0 ? round((value / totalValue) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

export function buildAllocationView(params: {
  accountId: string;
  positions: PortfolioPosition[];
  detailsByUid: ReadonlyMap<string, InstrumentDetails>;
  totalValue: number;
  currency: string;
}): AllocationView {
  const { accountId, positions, detailsByUid, totalValue, currency } = params;
  const warnings: string[] = [];
  const byType = new Map<string, number>();
  const bySector = new Map<string, number>();
  const byCurrency = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const concentration: ConcentrationEntry[] = [];

  // K5: базовая валюта портфеля — валюта итоговой суммы totalAmountPortfolio
  // (GetPortfolio запрашивается с currency:'RUB', то есть база — рубли).
  // Стоимость позиции считается в валюте ИНСТРУМЕНТА (currentPrice.currency), а
  // знаменатель весов totalValue — в базовой валюте. Смешивать их нельзя: для
  // инвалютных позиций (замещающие облигации в USD, ГДР) вес value(USD)/
  // totalValue(RUB) занижен в ~курс раз, а срезы byType/bySector/byCountry
  // складывают суммы разных валют. Курсов пересчёта в ответе GetPortfolio нет,
  // корректно привести позиции к базовой валюте здесь невозможно. no-fallbacks:
  // не выдаём молча заведомо неверные веса — собираем набор инвалютных валют и
  // ниже добавляем явное предупреждение о мультивалютности портфеля.
  const baseCurrency = currency.toLowerCase();
  const foreignCurrencies = new Set<string>();

  for (const position of positions) {
    if (!position.currentPrice) {
      // Без текущей цены стоимость позиции неизвестна — в структуру не входит.
      warnings.push(`Позиция ${position.ticker ?? position.figi} без текущей цены не учтена в структуре.`);
      continue;
    }
    const value = moneyToNumber(position.currentPrice) * quotationToNumber(position.quantity);
    const details = detailsByUid.get(position.instrumentUid);

    // Фиксируем валюту позиции, отличную от базовой — источник неточных весов.
    const positionCurrency = position.currentPrice.currency.toLowerCase();
    if (positionCurrency !== baseCurrency) {
      foreignCurrencies.add(positionCurrency);
    }

    // Подписи групп — презентация; для отсутствующих данных явные «без …»
    // (это UI-метки, а не подмена данных).
    const typeLabel = TYPE_LABELS[position.instrumentType] ?? position.instrumentType;
    const sectorLabel =
      position.instrumentType === 'currency'
        ? 'валюта и кэш'
        : details?.sector || 'без сектора';
    const countryLabel = details?.countryOfRiskName || details?.countryOfRisk || 'не указана';

    byType.set(typeLabel, (byType.get(typeLabel) ?? 0) + value);
    bySector.set(sectorLabel, (bySector.get(sectorLabel) ?? 0) + value);
    byCurrency.set(position.currentPrice.currency, (byCurrency.get(position.currentPrice.currency) ?? 0) + value);
    byCountry.set(countryLabel, (byCountry.get(countryLabel) ?? 0) + value);

    const weightPercent = totalValue > 0 ? (value / totalValue) * 100 : 0;
    if (weightPercent >= CONCENTRATION_WARN_PERCENT) {
      concentration.push({
        ticker: position.ticker ?? position.figi,
        name: details?.name ?? null,
        value: round(value),
        weightPercent: round(weightPercent),
      });
    }
  }

  // K5: если в портфеле есть инвалютные позиции — веса и концентрация по ним
  // считаются от рублёвого итога без пересчёта по курсу и потому занижены.
  // Предупреждаем явно, а не подменяем данные молчаливым «правдоподобным» весом.
  if (foreignCurrencies.size > 0) {
    const foreignList = [...foreignCurrencies].map((c) => c.toUpperCase()).join(', ');
    warnings.push(
      `Портфель мультивалютный (кроме базовой ${baseCurrency.toUpperCase()} есть позиции в ${foreignList}). ` +
        'Веса и концентрация по нерублёвым позициям неточны и занижены: их стоимость учтена в собственной ' +
        'валюте, а знаменатель — рублёвый итог портфеля; курсов пересчёта в ответе GetPortfolio нет.',
    );
  }

  concentration.sort((a, b) => b.weightPercent - a.weightPercent);
  return {
    accountId,
    totalValue: round(totalValue),
    currency,
    byType: toSlices(byType, totalValue),
    bySector: toSlices(bySector, totalValue),
    byCurrency: toSlices(byCurrency, totalValue),
    byCountry: toSlices(byCountry, totalValue),
    concentration,
    concentrationThresholdPercent: CONCENTRATION_WARN_PERCENT,
    warnings,
  };
}

export async function fetchAllocation(
  api: AllocationApi,
  params: { explicitAccountId?: string; mode: TInvestMode; now: Date },
): Promise<AllocationView> {
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const portfolio = await api.getPortfolio(accountId);

  // Сектор/страна/имя — из кэшируемых справочников: три списка целиком
  // дешевле и быстрее (после прогрева кэша), чем карточка на каждую позицию.
  const positionTypes = new Set(portfolio.positions.map((p) => p.instrumentType));
  const detailsByUid = new Map<string, InstrumentDetails>();
  const kinds = (['bonds', 'shares', 'etfs'] as const).filter((kind) =>
    positionTypes.has(kind === 'bonds' ? 'bond' : kind === 'shares' ? 'share' : 'etf'),
  );
  for (const kind of kinds) {
    const catalog = await loadCatalog(api, kind, params.mode, params.now);
    for (const item of catalog.items) {
      detailsByUid.set(item.uid, {
        uid: item.uid,
        name: item.name,
        sector: item.sector,
        countryOfRisk: item.countryOfRisk,
        countryOfRiskName: 'countryOfRiskName' in item ? item.countryOfRiskName : undefined,
      });
    }
  }

  return buildAllocationView({
    accountId,
    positions: portfolio.positions,
    detailsByUid,
    totalValue: moneyToNumber(portfolio.totalAmountPortfolio),
    currency: portfolio.totalAmountPortfolio.currency,
  });
}

function renderSlices(title: string, slices: AllocationSlice[]): string {
  const table = renderTable(
    ['Группа', 'Стоимость', 'Доля'],
    slices.map((s) => [s.key, formatAmount(s.value), `${formatAmount(s.weightPercent, 1)} %`]),
  );
  return `${title}\n${table}`;
}

export function renderAllocation(view: AllocationView): string {
  const parts = [
    `Счёт: ${view.accountId}`,
    `Стоимость портфеля: ${formatAmount(view.totalValue)} ${view.currency.toUpperCase()}`,
    '',
    renderSlices('По классам активов:', view.byType),
    '',
    renderSlices('По секторам:', view.bySector),
    '',
    renderSlices('По валютам:', view.byCurrency),
    '',
    renderSlices('По странам риска:', view.byCountry),
  ];
  if (view.concentration.length > 0) {
    parts.push('', `Концентрация (позиции ≥ ${view.concentrationThresholdPercent}% портфеля):`);
    for (const entry of view.concentration) {
      parts.push(
        `  ${entry.ticker}${entry.name ? ` (${entry.name})` : ''} — ${formatAmount(entry.weightPercent, 1)} %`,
      );
    }
  }
  for (const warning of view.warnings) {
    parts.push('', `⚠ ${warning}`);
  }
  return parts.join('\n');
}

// Бары структуры портфеля: два среза — по секторам и по классам активов.
// Доли уже посчитаны в представлении, здесь только раскладка в горизонтальные
// бары; тонкие срезы получают минимум один символ и не «исчезают» (см. barChart).
export function renderAllocationChart(view: AllocationView): string {
  const toItem = (slice: AllocationSlice): BarChartItem => ({
    label: slice.key,
    value: slice.weightPercent,
    note: `${formatAmount(slice.weightPercent, 1)} %`,
  });
  return [
    'Структура по секторам (доля от стоимости):',
    barChart(view.bySector.map(toItem)),
    '',
    'По классам активов:',
    barChart(view.byType.map(toItem)),
  ].join('\n');
}
