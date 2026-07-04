/**
 * REST-клиент T-Invest API (gRPC-gateway: POST + JSON, Bearer-авторизация).
 *
 * Экспорты:
 * - TInvestClientOptions — параметры клиента (token обязателен, fetchFn
 *   инъецируется в тестах);
 * - TInvestClient — методы:
 *   call(methodPath, body) — низкоуровневый вызов произвольного метода;
 *   getAccounts() — счета пользователя;
 *   getPortfolio(accountId) — портфель по счёту;
 *   findInstrument(query) — поиск инструментов;
 *   getInstrumentByUid(uid) — карточка инструмента (полное название);
 *   getLastPrices(instrumentIds) — последние цены;
 *   getOperations(params) — исполненные операции за период;
 *   getBondBy(uid) — карточка облигации (номинал, НКД, оферта, флаги);
 *   getBondCoupons(instrumentId) — полный график купонов;
 *   getDividends(instrumentId, from, to) — дивиденды за период;
 *   getAssetFundamentals(assetUids) — фундаментальные показатели активов;
 *   getForecastBy(instrumentId) — прогнозы и консенсус аналитиков;
 *   openSandboxAccount() / sandboxPayIn(accountId, amountRub) — методы
 *   песочницы (работают на sandbox-контуре).
 *
 * Все ошибки транспорта и HTTP превращаются в AppError со стабильными кодами —
 * выше по стеку ошибки не перехватываются, только на границе CLI.
 */
import { REQUEST_TIMEOUT_MS, T_INVEST_BASE_URL } from '../config/config.js';
import { AppError } from './errors.js';
import type {
  BondsResponse,
  EtfsResponse,
  IndicativesResponse,
  SharesResponse,
} from './types-catalog.js';
import type {
  CandleInterval,
  GetCandlesResponse,
  GetFuturesMarginResponse,
  GetLastTradesResponse,
  GetOrderBookResponse,
  GetTechAnalysisResponse,
  GetTradingStatusResponse,
  TechAnalysisRequest,
  TradingSchedulesResponse,
} from './types-market.js';
import type {
  GetAssetReportsResponse,
  GetFavoritesResponse,
  GetInsiderDealsResponse,
  GetSignalsResponse,
  GetStrategiesResponse,
  NewsResponse,
} from './types-info.js';
import type {
  BondResponse,
  CloseSandboxAccountResponse,
  FindInstrumentResponse,
  GetAccountsResponse,
  GetAssetFundamentalsResponse,
  GetBondCouponsResponse,
  GetDividendsResponse,
  GetForecastResponse,
  GetInstrumentByResponse,
  GetLastPricesResponse,
  GetOperationsByCursorResponse,
  GetSandboxAccountsResponse,
  GetWithdrawLimitsResponse,
  OpenSandboxAccountResponse,
  PortfolioResponse,
  SandboxPayInResponse,
} from './types.js';

// Общий префикс всех методов контракта v1 в REST-шлюзе.
const API_CONTRACT_PREFIX = 'tinkoff.public.invest.api.contract.v1';

export interface TInvestClientOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class TInvestClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: TInvestClientOptions) {
    // token — обязательный секрет; baseUrl/timeout — документированные
    // константы проекта, а не скрытые фолбэки данных.
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? T_INVEST_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async call<T>(methodPath: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}/${API_CONTRACT_PREFIX}.${methodPath}`;

    // Транспортные сбои (нет сети, таймаут) оборачиваем в AppError с контекстом.
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'TimeoutError') {
        throw new AppError({
          code: 'APP_TINVEST_TIMEOUT',
          userMessage: `Сервер Т-Инвестиций не ответил за ${Math.round(this.timeoutMs / 1000)} секунд. Повторите запрос позже.`,
          details: { method: methodPath, timeoutMs: this.timeoutMs },
          cause,
        });
      }
      throw new AppError({
        code: 'APP_TINVEST_NETWORK',
        userMessage: 'Не удалось подключиться к серверу Т-Инвестиций. Проверьте интернет-соединение и повторите запрос.',
        details: { method: methodPath },
        cause,
      });
    }

    if (!response.ok) {
      throw await this.mapHttpError(response, methodPath);
    }
    // Успешный ответ тоже может прийти не-JSON (HTML от прокси/captive portal,
    // сбой шлюза при TLS-перехвате — см. config.ts): парсинг обязан быть
    // защищён, иначе сырой SyntaxError уйдёт мимо границы ошибок как APP_UNEXPECTED.
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new AppError({
        code: 'APP_TINVEST_BAD_RESPONSE',
        userMessage:
          'Сервер Т-Инвестиций вернул ответ в неожиданном формате (не JSON). ' +
          'Возможен перехват трафика прокси или временный сбой шлюза — повторите запрос позже.',
        details: { method: methodPath, status: response.status },
        cause,
      });
    }
  }

  getAccounts(): Promise<GetAccountsResponse> {
    // Запрашиваем все статусы: фильтрация «только открытые» — забота команд.
    return this.call('UsersService/GetAccounts', { status: 'ACCOUNT_STATUS_UNSPECIFIED' });
  }

  getPortfolio(accountId: string): Promise<PortfolioResponse> {
    return this.call('OperationsService/GetPortfolio', { accountId, currency: 'RUB' });
  }

  findInstrument(query: string): Promise<FindInstrumentResponse> {
    return this.call('InstrumentsService/FindInstrument', { query });
  }

  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse> {
    return this.call('MarketDataService/GetLastPrices', { instrumentId: instrumentIds });
  }

  getInstrumentByUid(uid: string): Promise<GetInstrumentByResponse> {
    // Карточка инструмента по UID: даёт полное название для позиций портфеля
    // (сам GetPortfolio названий не присылает). classCode нужен только при
    // поиске по тикеру, для UID передаётся пустым.
    return this.call('InstrumentsService/GetInstrumentBy', {
      idType: 'INSTRUMENT_ID_TYPE_UID',
      classCode: '',
      id: uid,
    });
  }

  getOperationsByCursor(params: {
    accountId: string;
    from: string;
    to: string;
    cursor?: string;
    limit: number;
  }): Promise<GetOperationsByCursorResponse> {
    // Курсорная выдача операций (устаревший GetOperations в API помечен
    // deprecated). Берём только исполненные — отменённые не влияют на счёт.
    return this.call('OperationsService/GetOperationsByCursor', {
      ...params,
      state: 'OPERATION_STATE_EXECUTED',
    });
  }

  getWithdrawLimits(accountId: string): Promise<GetWithdrawLimitsResponse> {
    // Свободный остаток и блокировки по счёту — «сколько денег не в бумагах».
    return this.call('OperationsService/GetWithdrawLimits', { accountId });
  }

  getBondBy(uid: string): Promise<BondResponse> {
    // Карточка облигации по UID: номинал, НКД, даты погашения/оферты, флаги
    // (флоатер, амортизация, суборд) — базис для расчёта доходностей.
    return this.call('InstrumentsService/BondBy', {
      idType: 'INSTRUMENT_ID_TYPE_UID',
      classCode: '',
      id: uid,
    });
  }

  getBondCoupons(instrumentId: string, from: string, to: string): Promise<GetBondCouponsResponse> {
    // Период обязателен: без from/to API молча отдаёт купоны только на год
    // вперёд (проверено вживую 2026-07-02 — расчёт YTM занижался), поэтому
    // вызывающий код обязан задать окно от прошлого купона до погашения.
    return this.call('InstrumentsService/GetBondCoupons', { instrumentId, from, to });
  }

  getDividends(instrumentId: string, from: string, to: string): Promise<GetDividendsResponse> {
    // Период обязателен по смыслу команды: история для TTM-доходности
    // и объявленные будущие выплаты (фильтрация API — по recordDate).
    return this.call('InstrumentsService/GetDividends', { instrumentId, from, to });
  }

  getAssetFundamentals(assetUids: string[]): Promise<GetAssetFundamentalsResponse> {
    // Ключ метода — asset_uid (не instrument_uid!): берётся из карточки
    // инструмента (GetInstrumentBy → assetUid). До 100 активов за запрос.
    return this.call('InstrumentsService/GetAssetFundamentals', { assets: assetUids });
  }

  getForecastBy(instrumentId: string): Promise<GetForecastResponse> {
    return this.call('InstrumentsService/GetForecastBy', { instrumentId });
  }

  getCandles(params: {
    instrumentId: string;
    from: string;
    to: string;
    interval: CandleInterval;
  }): Promise<GetCandlesResponse> {
    return this.call('MarketDataService/GetCandles', params);
  }

  getTradingStatus(instrumentId: string): Promise<GetTradingStatusResponse> {
    return this.call('MarketDataService/GetTradingStatus', { instrumentId });
  }

  getOrderBook(instrumentId: string, depth: number): Promise<GetOrderBookResponse> {
    return this.call('MarketDataService/GetOrderBook', { instrumentId, depth });
  }

  getTechAnalysis(request: TechAnalysisRequest): Promise<GetTechAnalysisResponse> {
    // Индикаторы считает сам T-Invest API — CLI не дублирует матиндикаторы.
    return this.call('MarketDataService/GetTechAnalysis', request);
  }

  getTradingSchedules(
    exchange: string | undefined,
    from: string,
    to: string,
  ): Promise<TradingSchedulesResponse> {
    // Расписание торгов: без exchange API вернёт все площадки. from/to — период.
    return this.call('InstrumentsService/TradingSchedules', {
      ...(exchange ? { exchange } : {}),
      from,
      to,
    });
  }

  getLastTrades(instrumentId: string, from: string, to: string): Promise<GetLastTradesResponse> {
    // Лента обезличенных сделок за период (from/to обязательны по контракту).
    return this.call('MarketDataService/GetLastTrades', { instrumentId, from, to });
  }

  getFuturesMargin(instrumentId: string): Promise<GetFuturesMarginResponse> {
    // Гарантийное обеспечение фьючерса — сколько реально блокируется на счёте.
    return this.call('InstrumentsService/GetFuturesMargin', { instrumentId });
  }

  getBonds(): Promise<BondsResponse> {
    // Полный список облигаций базового каталога (доступны через API);
    // мегабайты данных — вызывающий код кэширует (src/catalog).
    return this.call('InstrumentsService/Bonds', { instrumentStatus: 'INSTRUMENT_STATUS_BASE' });
  }

  getShares(): Promise<SharesResponse> {
    return this.call('InstrumentsService/Shares', { instrumentStatus: 'INSTRUMENT_STATUS_BASE' });
  }

  getEtfs(): Promise<EtfsResponse> {
    return this.call('InstrumentsService/Etfs', { instrumentStatus: 'INSTRUMENT_STATUS_BASE' });
  }

  getIndicatives(): Promise<IndicativesResponse> {
    // Индикативные инструменты (индексы, товары) — для бенчмарков (IMOEX).
    return this.call('InstrumentsService/Indicatives', {});
  }

  getNews(params: { cursor?: string; limit: number }): Promise<NewsResponse> {
    // Сервер отдаёт общую ленту (фильтр по инструменту НЕ работает,
    // проверено вживую) — фильтрация по бумаге выполняется на клиенте.
    return this.call('InstrumentsService/News', params);
  }

  getInsiderDeals(instrumentId: string, limit: number): Promise<GetInsiderDealsResponse> {
    return this.call('InstrumentsService/GetInsiderDeals', { instrumentId, limit });
  }

  getAssetReports(instrumentId: string, from: string, to: string): Promise<GetAssetReportsResponse> {
    return this.call('InstrumentsService/GetAssetReports', { instrumentId, from, to });
  }

  getStrategies(): Promise<GetStrategiesResponse> {
    return this.call('SignalService/GetStrategies', {});
  }

  getSignals(params: {
    strategyId?: string;
    instrumentUid?: string;
    active: 'SIGNAL_STATE_ACTIVE' | 'SIGNAL_STATE_ALL';
    limit: number;
  }): Promise<GetSignalsResponse> {
    const { limit, ...rest } = params;
    return this.call('SignalService/GetSignals', { ...rest, paging: { limit } });
  }

  getFavorites(): Promise<GetFavoritesResponse> {
    // Вотчлист пользователя из приложения Т-Инвестиций (только чтение).
    return this.call('InstrumentsService/GetFavorites', {});
  }

  openSandboxAccount(): Promise<OpenSandboxAccountResponse> {
    // Работает только на контуре песочницы (см. baseUrlForMode в конфиге).
    return this.call('SandboxService/OpenSandboxAccount', {});
  }

  getSandboxAccounts(): Promise<GetSandboxAccountsResponse> {
    // Список счетов песочницы (контракт совпадает с UsersService/GetAccounts).
    return this.call('SandboxService/GetSandboxAccounts', {});
  }

  closeSandboxAccount(accountId: string): Promise<CloseSandboxAccountResponse> {
    // Закрытие виртуального счёта песочницы: удаляет счёт и его позиции.
    return this.call('SandboxService/CloseSandboxAccount', { accountId });
  }

  sandboxPayIn(accountId: string, amountRub: number): Promise<SandboxPayInResponse> {
    // Песочница принимает пополнение только в рублях; сумма — целые рубли
    // (валидация на границе CLI), поэтому nano всегда 0.
    return this.call('SandboxService/SandboxPayIn', {
      accountId,
      amount: { currency: 'rub', units: String(amountRub), nano: 0 },
    });
  }

  private async mapHttpError(response: Response, methodPath: string): Promise<AppError> {
    // Пытаемся достать структурированную ошибку API ({code, message});
    // тело может быть и не-JSON (например, HTML от шлюза) — это ожидаемый
    // вариант, а не проглатывание ошибки.
    let apiMessage: string | undefined;
    let apiCode: unknown;
    try {
      const parsed = (await response.json()) as { message?: string; code?: unknown };
      apiMessage = parsed.message;
      apiCode = parsed.code;
    } catch {
      apiMessage = undefined;
    }
    const details = { status: response.status, method: methodPath, apiCode, apiMessage };

    // Причина отказа от сервера — единственная действенная деталь при
    // отклонении заявки (недостаточно средств / неверный шаг цены / лотность).
    // Без неё агент повторяет мутацию вслепую, поэтому доносим её в сообщение
    // (в дополнение к details, которые видны лишь при TINVEST_DEBUG).
    const reason = apiMessage ? ` Причина от сервера: ${apiMessage}.` : '';

    if (response.status === 401) {
      return new AppError({
        code: 'APP_TINVEST_UNAUTHORIZED',
        userMessage: 'Сервер Т-Инвестиций не принял токен. Проверьте значение T_INVEST_TOKEN или выпустите новый токен в настройках Т-Инвестиций.',
        details,
      });
    }
    if (response.status === 403) {
      return new AppError({
        code: 'APP_TINVEST_FORBIDDEN',
        userMessage: 'У токена недостаточно прав для этой операции. Проверьте уровень доступа токена в настройках Т-Инвестиций.',
        details,
      });
    }
    if (response.status === 404) {
      return new AppError({
        code: 'APP_TINVEST_NOT_FOUND',
        userMessage: `Запрошенные данные не найдены на сервере Т-Инвестиций. Проверьте параметры команды.${reason}`,
        details,
      });
    }
    if (response.status === 429) {
      return new AppError({
        code: 'APP_TINVEST_RATE_LIMIT',
        userMessage: 'Превышен лимит запросов к T-Invest API. Подождите минуту и повторите.',
        details,
      });
    }
    if (response.status >= 500) {
      return new AppError({
        code: 'APP_TINVEST_SERVER_ERROR',
        userMessage: 'Сервер Т-Инвестиций временно недоступен. Повторите запрос позже.',
        details,
      });
    }
    return new AppError({
      code: 'APP_TINVEST_REQUEST_FAILED',
      userMessage: `Запрос к Т-Инвестициям завершился ошибкой. Проверьте параметры команды и повторите.${reason}`,
      details,
    });
  }
}
