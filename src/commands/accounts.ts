/**
 * Команда accounts: список счетов пользователя.
 *
 * Экспорты:
 * - AccountView — представление счёта с русскими подписями;
 * - buildAccountViews(resp) — маппинг ответа API;
 * - fetchAccounts(api) — загрузка + сборка;
 * - renderAccounts(views) — таблица для вывода.
 */
import type { GetAccountsResponse } from '../api/types.js';
import { renderTable } from '../format/table.js';
import { DASH } from '../format/values.js';
import type { AccountsApi } from './resolve-account.js';

export interface AccountView {
  id: string;
  name: string;
  typeText: string;
  statusText: string;
  accessText: string;
  openedDate: string | null;
}

// Русские подписи enum-значений — презентационный маппинг; неизвестное
// значение показываем как есть, чтобы не терять информацию.
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ACCOUNT_TYPE_TINKOFF: 'Брокерский счёт',
  ACCOUNT_TYPE_TINKOFF_IIS: 'ИИС',
  ACCOUNT_TYPE_INVEST_BOX: 'Инвесткопилка',
  ACCOUNT_TYPE_INVEST_FUND: 'Фонд',
};

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  ACCOUNT_STATUS_OPEN: 'открыт',
  ACCOUNT_STATUS_CLOSED: 'закрыт',
  ACCOUNT_STATUS_NEW: 'открывается',
};

const ACCESS_LEVEL_LABELS: Record<string, string> = {
  ACCOUNT_ACCESS_LEVEL_FULL_ACCESS: 'полный доступ',
  ACCOUNT_ACCESS_LEVEL_READ_ONLY: 'только чтение',
  ACCOUNT_ACCESS_LEVEL_NO_ACCESS: 'нет доступа',
};

export function buildAccountViews(resp: GetAccountsResponse): AccountView[] {
  return resp.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    typeText: ACCOUNT_TYPE_LABELS[a.type] ?? a.type,
    statusText: ACCOUNT_STATUS_LABELS[a.status] ?? a.status,
    accessText: ACCESS_LEVEL_LABELS[a.accessLevel] ?? a.accessLevel,
    openedDate: a.openedDate ? a.openedDate.slice(0, 10) : null,
  }));
}

export async function fetchAccounts(api: AccountsApi): Promise<AccountView[]> {
  return buildAccountViews(await api.getAccounts());
}

export function renderAccounts(views: AccountView[]): string {
  return renderTable(
    ['ID', 'Название', 'Тип', 'Статус', 'Доступ токена', 'Открыт'],
    views.map((v) => [v.id, v.name, v.typeText, v.statusText, v.accessText, v.openedDate ?? DASH]),
  );
}
