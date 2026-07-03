/**
 * Диспетчер торговых методов по режиму и предохранители торговых команд.
 *
 * Граница безопасности реальных денег вынесена из сессии в окружение
 * (TradingGate) — «лестница» гейтов для мутаций:
 * - readonly: чтение заявок разрешено, ЛЮБАЯ мутация запрещена кодом
 *   (APP_TINVEST_TRADING_FORBIDDEN) — ещё до обращения к API;
 * - sandbox: свободная торговля виртуальными деньгами через SandboxService;
 * - full без флага T_INVEST_ALLOW_TRADING: чтение можно, сделка запрещена
 *   (APP_TINVEST_TRADING_DISABLED) — само наличие full-токена не открывает
 *   реальные сделки, нужен явный флаг деплоя;
 * - full с ALLOW_TRADING: каждая сделка требует --confirm (подпись человека),
 *   без него — APP_TINVEST_CONFIRM_REQUIRED;
 * - full со STONKS_MODE: сделки без подтверждений (автономно, осознанный
 *   опасный opt-in деплоя).
 *
 * Экспорты:
 * - TradingPaths — таблица путей методов для режима;
 * - tradingPathsForMode(mode) — выбор контура (sandbox ↔ боевой);
 * - assertMutationAllowed(mode, confirmed, gate) — предохранитель мутаций;
 * - assertMarketOrderLiquidity(bestBid, bestAsk, maxSpread) — гард спреда для
 *   рыночных заявок (защита от плохого исполнения на неликвиде).
 */
import { AppError } from '../../api/errors.js';
import { TRADING_ENABLE_ENV_VAR, type TInvestMode, type TradingGate } from '../../config/config.js';

export interface TradingPaths {
  postOrder: string;
  cancelOrder: string;
  getOrders: string;
  getOrderState: string;
  replaceOrder: string;
  getMaxLots: string;
  getOrderPrice: string;
  postStopOrder: string;
  cancelStopOrder: string;
  getStopOrders: string;
}

// Боевой контур: OrdersService/StopOrdersService (работает и для readonly-чтения).
const REAL_PATHS: TradingPaths = {
  postOrder: 'OrdersService/PostOrder',
  cancelOrder: 'OrdersService/CancelOrder',
  getOrders: 'OrdersService/GetOrders',
  getOrderState: 'OrdersService/GetOrderState',
  replaceOrder: 'OrdersService/ReplaceOrder',
  getMaxLots: 'OrdersService/GetMaxLots',
  getOrderPrice: 'OrdersService/GetOrderPrice',
  postStopOrder: 'StopOrdersService/PostStopOrder',
  cancelStopOrder: 'StopOrdersService/CancelStopOrder',
  getStopOrders: 'StopOrdersService/GetStopOrders',
};

// Песочница: та же семантика, свои методы SandboxService.
const SANDBOX_PATHS: TradingPaths = {
  postOrder: 'SandboxService/PostSandboxOrder',
  cancelOrder: 'SandboxService/CancelSandboxOrder',
  getOrders: 'SandboxService/GetSandboxOrders',
  getOrderState: 'SandboxService/GetSandboxOrderState',
  replaceOrder: 'SandboxService/ReplaceSandboxOrder',
  getMaxLots: 'SandboxService/GetSandboxMaxLots',
  getOrderPrice: 'SandboxService/GetSandboxOrderPrice',
  postStopOrder: 'SandboxService/PostSandboxStopOrder',
  cancelStopOrder: 'SandboxService/CancelSandboxStopOrder',
  getStopOrders: 'SandboxService/GetSandboxStopOrders',
};

export function tradingPathsForMode(mode: TInvestMode): TradingPaths {
  return mode === 'sandbox' ? SANDBOX_PATHS : REAL_PATHS;
}

// gate — гейт реальных сделок из окружения (см. resolveTradingGate). Деньги
// стережёт он, а не сессия: без флага деплоя full торгует только «на чтение»,
// с ALLOW_TRADING нужна подпись человека на каждую сделку (--confirm), а
// STONKS_MODE снимает подтверждения (автономно, осознанный опасный opt-in).
export function assertMutationAllowed(
  mode: TInvestMode,
  confirmed: boolean,
  gate: TradingGate,
): void {
  if (mode === 'readonly') {
    throw new AppError({
      code: 'APP_TINVEST_TRADING_FORBIDDEN',
      userMessage:
        'Торговые операции недоступны в режиме «только чтение». ' +
        'Для тренировки используйте песочницу (sandbox), для реальной торговли — режим full.',
    });
  }
  // Песочница — виртуальные деньги: торговля свободна, гейт денег не действует.
  if (mode === 'sandbox') {
    return;
  }
  // full: сначала капабилити-гейт деплоя, затем — подпись человека на сделку.
  if (!gate.allowTrading) {
    throw new AppError({
      code: 'APP_TINVEST_TRADING_DISABLED',
      userMessage:
        'Реальные сделки выключены. Само наличие full-токена не даёт торговать: ' +
        `включите их флагом ${TRADING_ENABLE_ENV_VAR}=true в .env (чтение в режиме full доступно и без него).`,
    });
  }
  // Автономный режим — подтверждение на каждую сделку не требуется.
  if (gate.stonksMode) {
    return;
  }
  if (!confirmed) {
    throw new AppError({
      code: 'APP_TINVEST_CONFIRM_REQUIRED',
      userMessage:
        'Сделка реальными деньгами требует подтверждения: повторите команду с флагом --confirm ' +
        'после явного согласия пользователя на эту заявку.',
    });
  }
}

// Гард ликвидности для РЫНОЧНОЙ заявки: у неё нет защиты ценой, и на неликвиде
// она может исполниться сильно хуже ожидания. Считаем спред по лучшим bid/ask;
// пустой стакан (нет двусторонних котировок) или спред шире порога — блокируем
// и требуем лимитную заявку. Для лимитных заявок не вызывается (там цена задана).
export function assertMarketOrderLiquidity(
  bestBid: number | null,
  bestAsk: number | null,
  maxSpreadPercent: number,
): void {
  if (bestBid === null || bestAsk === null || bestBid <= 0 || bestAsk <= 0) {
    throw new AppError({
      code: 'APP_TINVEST_ILLIQUID_MARKET',
      userMessage:
        'Рыночная заявка отклонена: в стакане нет двусторонних котировок (низкая ликвидность) — ' +
        'исполнение может быть по любой цене. Задайте лимитную цену через --price.',
    });
  }
  const spreadPercent = ((bestAsk - bestBid) / ((bestBid + bestAsk) / 2)) * 100;
  if (spreadPercent > maxSpreadPercent) {
    throw new AppError({
      code: 'APP_TINVEST_WIDE_SPREAD',
      userMessage:
        `Рыночная заявка отклонена: спред в стакане ${spreadPercent.toFixed(2)} % ` +
        `(порог ${maxSpreadPercent} %) — рыночное исполнение невыгодно. Задайте лимитную цену через --price.`,
    });
  }
}
