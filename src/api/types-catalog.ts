/**
 * Типы справочников инструментов T-Invest API (списочные методы
 * InstrumentsService: Bonds, Shares, Etfs, Indicatives).
 *
 * Экспорты:
 * - BondListItem, BondsResponse — список облигаций (InstrumentsService/Bonds);
 * - ShareListItem, SharesResponse — список акций (InstrumentsService/Shares);
 * - EtfListItem, EtfsResponse — список фондов (InstrumentsService/Etfs);
 * - IndicativeItem, IndicativesResponse — индикативные инструменты: индексы,
 *   товары (InstrumentsService/Indicatives);
 * - CatalogKind — вид справочника для кэша.
 *
 * Как и везде в REST-шлюзе (protobuf JSON): незаполненные поля опускаются,
 * поэтому почти всё optional — отсутствие поля означает «данных нет».
 */
import type { MoneyValue, Quotation } from './types.js';

// Вид справочника — ключ кэша и выбор метода API.
export type CatalogKind = 'bonds' | 'shares' | 'etfs';

// --- InstrumentsService/Bonds ---

// Элемент списка облигаций: статические поля для скрининга без карточек.
export interface BondListItem {
  uid: string;
  figi?: string;
  ticker: string;
  classCode?: string;
  isin?: string;
  name: string;
  currency?: string;
  sector?: string;
  exchange?: string;
  lot?: number;
  couponQuantityPerYear?: number;
  maturityDate?: string;
  callDate?: string; // дата оферты, если предусмотрена
  nominal?: MoneyValue;
  aciValue?: MoneyValue;
  floatingCouponFlag?: boolean;
  perpetualFlag?: boolean;
  amortizationFlag?: boolean;
  subordinatedFlag?: boolean;
  liquidityFlag?: boolean;
  forIisFlag?: boolean;
  forQualInvestorFlag?: boolean;
  apiTradeAvailableFlag?: boolean;
  buyAvailableFlag?: boolean;
  sellAvailableFlag?: boolean;
  riskLevel?: string; // RISK_LEVEL_HIGH | _MODERATE | _LOW
  bondType?: string;
  countryOfRisk?: string;
  countryOfRiskName?: string;
}

export interface BondsResponse {
  instruments: BondListItem[];
}

// --- InstrumentsService/Shares ---

export interface ShareListItem {
  uid: string;
  figi?: string;
  ticker: string;
  classCode?: string;
  isin?: string;
  name: string;
  currency?: string;
  sector?: string;
  exchange?: string;
  lot?: number;
  assetUid?: string; // ключ для GetAssetFundamentals
  countryOfRisk?: string;
  countryOfRiskName?: string;
  divYieldFlag?: boolean; // признак дивидендной бумаги
  forQualInvestorFlag?: boolean;
  apiTradeAvailableFlag?: boolean;
  buyAvailableFlag?: boolean;
  sellAvailableFlag?: boolean;
  shareType?: string; // SHARE_TYPE_COMMON | _PREFERRED | ...
  nominal?: MoneyValue;
}

export interface SharesResponse {
  instruments: ShareListItem[];
}

// --- InstrumentsService/Etfs ---

export interface EtfListItem {
  uid: string;
  figi?: string;
  ticker: string;
  classCode?: string;
  isin?: string;
  name: string;
  currency?: string;
  sector?: string;
  exchange?: string;
  lot?: number;
  assetUid?: string;
  focusType?: string; // equity | fixed_income | mixed_allocation | ...
  countryOfRisk?: string;
  forQualInvestorFlag?: boolean;
  apiTradeAvailableFlag?: boolean;
}

export interface EtfsResponse {
  instruments: EtfListItem[];
}

// --- InstrumentsService/Indicatives ---

// Индикативные инструменты (индексы, товары): котировки доступны через
// MarketDataService, торговля — нет. Нужны для бенчмарков (IMOEX).
export interface IndicativeItem {
  uid: string;
  figi?: string;
  ticker: string;
  classCode?: string;
  name: string;
  currency?: string;
  exchange?: string;
  instrumentKind?: string; // INSTRUMENT_TYPE_INDEX | ...
  buyAvailableFlag?: boolean;
  sellAvailableFlag?: boolean;
}

export interface IndicativesResponse {
  instruments: IndicativeItem[];
}

// Переиспользуем Quotation в типах справочника ниже по мере надобности;
// экспорт здесь не дублируем — импортируйте из ./types.js.
export type { Quotation };
