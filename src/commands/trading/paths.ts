/**
 * Диспетчер торговых методов по режиму и предохранители торговых команд.
 *
 * Граница безопасности (в дополнение к замку сессии и уровням токенов):
 * - readonly: чтение заявок разрешено, ЛЮБАЯ мутация запрещена кодом
 *   (APP_TINVEST_TRADING_FORBIDDEN) — ещё до обращения к API;
 * - full: каждая мутация требует явного флага --confirm
 *   (APP_TINVEST_CONFIRM_REQUIRED) И активной full-сессии, зафиксированной с
 *   подтверждением (APP_TINVEST_FULL_SESSION_REQUIRED) — иначе торговля
 *   реальными деньгами обошла бы церемонию осознанного выбора режима;
 * - sandbox: свободная торговля виртуальными деньгами через SandboxService.
 *
 * Экспорты:
 * - TradingPaths — таблица путей методов для режима;
 * - tradingPathsForMode(mode) — выбор контура (sandbox ↔ боевой);
 * - assertMutationAllowed(mode, confirmed, sessionLock) — предохранитель мутаций.
 */
import { AppError } from '../../api/errors.js';
import type { TInvestMode } from '../../config/config.js';
import type { SessionLock } from '../../config/session.js';

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

// sessionLock — активный замок текущей сессии (или null). Для full-мутаций он
// обязателен: церемония --acknowledge-trading при «session start» — это и есть
// осознанное подтверждение доступа к реальным деньгам. Без активной full-сессии
// full-мутация запрещена, даже если передан --confirm (иначе пользователь с
// единственным full-токеном торговал бы реальными деньгами вообще без церемонии).
export function assertMutationAllowed(
  mode: TInvestMode,
  confirmed: boolean,
  sessionLock: SessionLock | null,
): void {
  if (mode === 'readonly') {
    throw new AppError({
      code: 'APP_TINVEST_TRADING_FORBIDDEN',
      userMessage:
        'Торговые операции недоступны в режиме «только чтение». ' +
        'Для тренировки используйте песочницу (sandbox), для реальной торговли — режим full в новой сессии.',
    });
  }
  if (mode === 'full') {
    if (!confirmed) {
      throw new AppError({
        code: 'APP_TINVEST_CONFIRM_REQUIRED',
        userMessage:
          'Режим full — торговля реальными деньгами: повторите команду с флагом --confirm ' +
          'после явного подтверждения пользователя.',
      });
    }
    if (!sessionLock || sessionLock.mode !== 'full') {
      throw new AppError({
        code: 'APP_TINVEST_FULL_SESSION_REQUIRED',
        userMessage:
          'Торговля реальными деньгами требует активной сессии режима full, зафиксированной с ' +
          'подтверждением: сначала выполните «session start --acknowledge-trading», затем повторите заявку.',
      });
    }
  }
}
