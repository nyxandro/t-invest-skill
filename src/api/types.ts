/**
 * Типы контрактов T-Invest API (REST-шлюз, camelCase-поля).
 *
 * Экспорты:
 * - Quotation, MoneyValue — денежные примитивы API (units/nano);
 * - Account, GetAccountsResponse — счета (UsersService/GetAccounts);
 * - PortfolioPosition, PortfolioResponse — портфель (OperationsService/GetPortfolio);
 * - InstrumentShort, FindInstrumentResponse — поиск инструментов (InstrumentsService/FindInstrument);
 * - LastPrice, GetLastPricesResponse — котировки (MarketDataService/GetLastPrices);
 * - Operation, GetOperationsResponse — операции (OperationsService/GetOperations);
 * - BondDetails, BondResponse — карточка облигации (InstrumentsService/BondBy);
 * - BondCoupon, GetBondCouponsResponse — график купонов (InstrumentsService/GetBondCoupons);
 * - DividendItem, GetDividendsResponse — дивиденды (InstrumentsService/GetDividends);
 * - AssetFundamentals, GetAssetFundamentalsResponse — фундаментальные показатели
 *   (InstrumentsService/GetAssetFundamentals);
 * - ForecastTarget, ForecastConsensus, GetForecastResponse — прогнозы аналитиков
 *   (InstrumentsService/GetForecastBy).
 *
 * Здесь только поля, которые реально использует CLI: контракт API шире,
 * лишние поля из ответов просто игнорируются при десериализации.
 */

// REST-шлюз сериализует int64 как строку, поэтому units — string.
// Дробная часть nano — миллиардные доли (int32), может быть отрицательной.
export interface Quotation {
  units: string;
  nano: number;
}

// Денежное значение = Quotation + ISO-код валюты в нижнем регистре ("rub").
export interface MoneyValue extends Quotation {
  currency: string;
}

// --- UsersService/GetAccounts ---

export interface Account {
  id: string;
  type: string; // ACCOUNT_TYPE_TINKOFF | ACCOUNT_TYPE_TINKOFF_IIS | ...
  name: string;
  status: string; // ACCOUNT_STATUS_OPEN | ACCOUNT_STATUS_CLOSED | ...
  openedDate?: string;
  closedDate?: string;
  accessLevel: string; // ACCOUNT_ACCESS_LEVEL_FULL_ACCESS | ..._READ_ONLY | ...
}

export interface GetAccountsResponse {
  accounts: Account[];
}

// --- OperationsService/GetPortfolio ---

export interface PortfolioPosition {
  figi: string;
  instrumentUid: string;
  instrumentType: string; // share | bond | etf | currency | futures | ...
  ticker?: string;
  classCode?: string;
  quantity: Quotation;
  averagePositionPrice?: MoneyValue;
  currentPrice?: MoneyValue;
  currentNkd?: MoneyValue; // накопленный купонный доход (для облигаций)
  expectedYield?: Quotation; // абсолютная доходность позиции
  dailyYield?: MoneyValue;
  blocked?: boolean;
}

export interface PortfolioResponse {
  accountId: string;
  totalAmountPortfolio: MoneyValue;
  totalAmountShares: MoneyValue;
  totalAmountBonds: MoneyValue;
  totalAmountEtf: MoneyValue;
  totalAmountCurrencies: MoneyValue;
  totalAmountFutures?: MoneyValue;
  totalAmountOptions?: MoneyValue;
  totalAmountSp?: MoneyValue;
  expectedYield?: Quotation; // относительная доходность портфеля, %; шлюз опускает при нуле
  dailyYield?: MoneyValue;
  dailyYieldRelative?: Quotation;
  positions: PortfolioPosition[];
}

// --- InstrumentsService/FindInstrument ---

export interface InstrumentShort {
  uid: string;
  figi: string;
  ticker: string;
  classCode: string;
  isin?: string;
  instrumentType: string;
  name: string;
  exchange?: string;
  lot?: number;
  currency?: string;
  apiTradeAvailableFlag?: boolean;
  forQualInvestorFlag?: boolean;
}

export interface FindInstrumentResponse {
  instruments: InstrumentShort[];
}

// --- MarketDataService/GetLastPrices ---

// ВАЖНО: REST-шлюз (protobuf JSON) опускает незаполненные поля — если торгов
// по инструменту нет, запись приходит БЕЗ price и time (проверено вживую).
export interface LastPrice {
  figi: string;
  instrumentUid: string;
  price?: Quotation;
  time?: string;
}

export interface GetLastPricesResponse {
  lastPrices: LastPrice[];
}

// --- InstrumentsService/GetInstrumentBy ---

export interface InstrumentDetails {
  uid: string;
  figi?: string;
  isin?: string;
  name: string;
  ticker?: string;
  classCode?: string;
  instrumentType?: string;
  lot?: number;
  currency?: string;
  exchange?: string;
  sector?: string; // сектор эмитента — для allocation
  countryOfRisk?: string; // ISO-код страны риска
  countryOfRiskName?: string;
  tradingStatus?: string;
  forQualInvestorFlag?: boolean;
  apiTradeAvailableFlag?: boolean;
  assetUid?: string; // идентификатор актива — ключ для GetAssetFundamentals
}

export interface GetInstrumentByResponse {
  instrument: InstrumentDetails;
}

// --- SandboxService ---

export interface OpenSandboxAccountResponse {
  accountId: string;
}

export interface SandboxPayInResponse {
  balance: MoneyValue;
}

// --- OperationsService/GetOperationsByCursor ---

// Элемент курсорной выдачи операций. Богаче устаревшего GetOperations:
// есть тикер, комиссия, НКД и описание операции. ВАЖНО (проверено вживую
// 2026-07-02): этот метод присылает НЕзаполненные строковые поля как "",
// а не опускает их — нормализация в view-слое обязательна.
export interface OperationItem {
  cursor?: string;
  id: string;
  parentOperationId?: string;
  name?: string; // название ИНСТРУМЕНТА («Сбер Банк»), не описание операции
  description?: string; // описание операции («Покупка 10 лотов ...»)
  date: string;
  type?: string; // enum OPERATION_TYPE_*
  state?: string; // OPERATION_STATE_EXECUTED | ...
  instrumentUid?: string;
  figi?: string;
  ticker?: string;
  instrumentType?: string;
  payment?: MoneyValue;
  price?: MoneyValue;
  commission?: MoneyValue;
  accruedInt?: MoneyValue; // НКД в сделках с облигациями
  quantity?: string; // int64 → string в REST-шлюзе
  quantityDone?: string;
}

export interface GetOperationsByCursorResponse {
  hasNext?: boolean;
  nextCursor?: string;
  items?: OperationItem[]; // protobuf-JSON опускает пустой массив
}

// --- OperationsService/GetWithdrawLimits ---

// Свободные и заблокированные деньги по счёту (по валютам).
export interface GetWithdrawLimitsResponse {
  money?: MoneyValue[]; // доступно к выводу
  blocked?: MoneyValue[]; // заблокировано под заявки
  blockedGuarantee?: MoneyValue[]; // гарантийное обеспечение фьючерсов
}

// --- InstrumentsService/BondBy ---

// Карточка облигации. ВАЖНО: protobuf-JSON опускает пустые/нулевые поля,
// поэтому почти всё optional — отсутствие поля означает «данных нет» (null
// в представлении команд), а не ноль.
export interface BondDetails {
  uid: string;
  figi: string;
  ticker: string;
  classCode: string;
  isin: string;
  name: string;
  currency: string;
  sector?: string;
  couponQuantityPerYear?: number; // выплат по купонам в год
  maturityDate?: string; // дата погашения (UTC)
  callDate?: string; // дата оферты (call/put), если предусмотрена
  nominal?: MoneyValue; // текущий номинал (при амортизации уменьшается)
  initialNominal?: MoneyValue;
  aciValue?: MoneyValue; // НКД на дату запроса
  floatingCouponFlag?: boolean;
  perpetualFlag?: boolean; // бессрочная
  amortizationFlag?: boolean; // номинал гасится частями
  subordinatedFlag?: boolean; // субординированная
  liquidityFlag?: boolean; // признак достаточной ликвидности
  forIisFlag?: boolean;
  forQualInvestorFlag?: boolean;
  riskLevel?: string; // RISK_LEVEL_HIGH | _MODERATE | _LOW
  bondType?: string; // BOND_TYPE_REPLACED — замещающая
  exchange?: string;
}

export interface BondResponse {
  instrument: BondDetails;
}

// --- InstrumentsService/GetBondCoupons ---

export interface BondCoupon {
  figi?: string;
  couponDate: string; // дата выплаты купона (UTC)
  couponNumber?: string; // int64 → string в REST-шлюзе
  payOneBond?: MoneyValue; // выплата на одну облигацию; у будущих купонов
  // флоатера значение может отсутствовать или быть нулевым — «ещё не определено»
  couponType?: string; // COUPON_TYPE_FIX | _FLOATING | _VARIABLE | ...
  couponStartDate?: string;
  couponEndDate?: string;
  couponPeriod?: number; // купонный период в днях
}

export interface GetBondCouponsResponse {
  events?: BondCoupon[]; // protobuf-JSON опускает пустой массив
}

// --- InstrumentsService/GetDividends ---

export interface DividendItem {
  dividendNet?: MoneyValue; // дивиденд на одну бумагу
  paymentDate?: string; // дата фактической выплаты
  declaredDate?: string; // дата объявления
  lastBuyDate?: string; // последний день покупки под дивиденд
  recordDate?: string; // дата фиксации реестра
  dividendType?: string; // Regular Cash | Cancelled | ...
  regularity?: string; // Annual | Semi-Anl | ...
  closePrice?: MoneyValue; // цена закрытия на экс-дивидендную дату
  yieldValue?: Quotation; // доходность выплаты, % (к цене на дату объявления)
}

export interface GetDividendsResponse {
  dividends?: DividendItem[]; // protobuf-JSON опускает пустой массив
}

// --- InstrumentsService/GetAssetFundamentals ---

// Фундаментальные показатели актива. Все числовые поля — protobuf double:
// нулевые значения REST-шлюз опускает, отсутствие поля = «данных нет».
export interface AssetFundamentals {
  assetUid: string;
  currency?: string;
  marketCapitalization?: number;
  highPriceLast52Weeks?: number;
  lowPriceLast52Weeks?: number;
  beta?: number;
  freeFloat?: number; // доля акций в свободном обращении
  revenueTtm?: number;
  ebitdaTtm?: number;
  netIncomeTtm?: number;
  epsTtm?: number;
  freeCashFlowTtm?: number;
  peRatioTtm?: number; // P/E
  priceToSalesTtm?: number; // P/S
  priceToBookTtm?: number; // P/B
  evToEbitdaMrq?: number; // EV/EBITDA
  netMarginMrq?: number; // маржа чистой прибыли, %
  roe?: number;
  roa?: number;
  roic?: number;
  totalDebtMrq?: number;
  totalDebtToEbitdaMrq?: number; // Долг/EBITDA
  netDebtToEbitda?: number; // Чистый долг/EBITDA
  currentRatioMrq?: number; // текущая ликвидность
  dividendYieldDailyTtm?: number; // дивдоходность за 12 мес, %
  dividendRateTtm?: number; // выплачено дивидендов за 12 мес (на акцию)
  dividendsPerShare?: number;
  forwardAnnualDividendYield?: number; // форвардная дивдоходность, %
  fiveYearsAverageDividendYield?: number;
  fiveYearAnnualDividendGrowthRate?: number;
  dividendPayoutRatioFy?: number; // доля прибыли на дивиденды, %
  oneYearAnnualRevenueGrowthRate?: number;
  threeYearAnnualRevenueGrowthRate?: number;
  fiveYearAnnualRevenueGrowthRate?: number;
  epsChangeFiveYears?: number;
  exDividendDate?: string;
}

export interface GetAssetFundamentalsResponse {
  fundamentals?: AssetFundamentals[]; // protobuf-JSON опускает пустой массив
}

// --- InstrumentsService/GetForecastBy ---

export interface ForecastTarget {
  company: string; // аналитический дом, давший прогноз
  recommendation?: string; // RECOMMENDATION_BUY | _HOLD | _SELL
  recommendationDate?: string;
  currency?: string;
  currentPrice?: Quotation;
  targetPrice?: Quotation;
  priceChangeRel?: Quotation; // потенциал к текущей цене, %
}

export interface ForecastConsensus {
  ticker?: string;
  recommendation?: string;
  currency?: string;
  currentPrice?: Quotation;
  consensus?: Quotation; // консенсус-цена
  minTarget?: Quotation;
  maxTarget?: Quotation;
  priceChangeRel?: Quotation;
}

export interface GetForecastResponse {
  targets?: ForecastTarget[]; // protobuf-JSON опускает пустой массив
  consensus?: ForecastConsensus;
}
