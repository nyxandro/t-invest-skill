/**
 * Команда cash: свободные деньги на счёте — доступный остаток,
 * блокировки под заявки и гарантийное обеспечение (GetWithdrawLimits).
 *
 * Экспорты:
 * - CashApi — контракт клиента;
 * - CashView — представление остатков по валютам;
 * - buildCashView(accountId, resp) — чистая сборка представления;
 * - fetchCash(api, explicitAccountId?) — выбор счёта + загрузка;
 * - renderCash(view) — человекочитаемый вывод.
 */
import { formatAmount, moneyToNumber } from '../api/money.js';
import type { GetWithdrawLimitsResponse, MoneyValue } from '../api/types.js';
import { resolveAccountId, type AccountsApi } from './resolve-account.js';

export interface CashApi extends AccountsApi {
  getWithdrawLimits(accountId: string): Promise<GetWithdrawLimitsResponse>;
}

export interface CashAmount {
  currency: string;
  amount: number;
}

export interface CashView {
  accountId: string;
  available: CashAmount[]; // свободно (доступно к выводу)
  blocked: CashAmount[]; // заблокировано под выставленные заявки
  blockedGuarantee: CashAmount[]; // гарантийное обеспечение фьючерсов
}

// MoneyValue[] → представление по валютам; нулевые суммы отбрасываем —
// API присылает их как «валюта была на счёте когда-то».
function toAmounts(values: MoneyValue[] | undefined): CashAmount[] {
  return (values ?? [])
    .map((m) => ({ currency: m.currency, amount: moneyToNumber(m) }))
    .filter((a) => a.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

export function buildCashView(accountId: string, resp: GetWithdrawLimitsResponse): CashView {
  return {
    accountId,
    available: toAmounts(resp.money),
    blocked: toAmounts(resp.blocked),
    blockedGuarantee: toAmounts(resp.blockedGuarantee),
  };
}

export async function fetchCash(api: CashApi, explicitAccountId?: string): Promise<CashView> {
  const accountId = await resolveAccountId(api, explicitAccountId);
  const resp = await api.getWithdrawLimits(accountId);
  return buildCashView(accountId, resp);
}

function renderAmounts(title: string, amounts: CashAmount[]): string[] {
  if (amounts.length === 0) {
    return [];
  }
  return [
    title,
    ...amounts.map((a) => `  ${formatAmount(a.amount)} ${a.currency.toUpperCase()}`),
  ];
}

export function renderCash(view: CashView): string {
  const lines = [
    `Счёт: ${view.accountId}`,
    ...renderAmounts('Свободные деньги:', view.available),
    ...renderAmounts('Заблокировано под заявки:', view.blocked),
    ...renderAmounts('Гарантийное обеспечение:', view.blockedGuarantee),
  ];
  if (view.available.length === 0 && view.blocked.length === 0 && view.blockedGuarantee.length === 0) {
    lines.push('Свободных денег на счёте нет.');
  }
  return lines.join('\n');
}
