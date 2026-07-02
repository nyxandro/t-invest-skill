/**
 * Выбор брокерского счёта для команд portfolio/operations.
 *
 * Экспорты:
 * - AccountsApi — минимальный контракт клиента (явная зависимость для тестов);
 * - resolveAccountId(api, explicitId?) — правила выбора счёта.
 *
 * Правила (no-fallbacks: счёт за пользователя не угадываем):
 * - явный --account используется, если существует (в т.ч. закрытый — для истории);
 * - без явного счёта: ровно один открытый → берём его;
 * - несколько открытых → ошибка с перечнем, ноль открытых → ошибка.
 */
import { AppError } from '../api/errors.js';
import type { GetAccountsResponse } from '../api/types.js';

export interface AccountsApi {
  getAccounts(): Promise<GetAccountsResponse>;
}

const ACCOUNT_STATUS_OPEN = 'ACCOUNT_STATUS_OPEN';

export async function resolveAccountId(api: AccountsApi, explicitId?: string): Promise<string> {
  const { accounts } = await api.getAccounts();

  // Явно указанный счёт: проверяем существование, статус не ограничиваем —
  // историю операций смотрят и по закрытым счетам.
  if (explicitId) {
    const found = accounts.find((a) => a.id === explicitId);
    if (!found) {
      throw new AppError({
        code: 'APP_TINVEST_ACCOUNT_NOT_FOUND',
        userMessage: `Счёт ${explicitId} не найден среди ваших счетов. Выполните «tinvest accounts», чтобы увидеть список.`,
      });
    }
    return found.id;
  }

  const open = accounts.filter((a) => a.status === ACCOUNT_STATUS_OPEN);
  const single = open[0];
  if (open.length === 1 && single) {
    return single.id;
  }
  if (open.length === 0) {
    throw new AppError({
      code: 'APP_TINVEST_NO_ACCOUNTS',
      userMessage: 'Не найдено ни одного открытого счёта. Проверьте, что токен выпущен для нужного аккаунта Т-Инвестиций.',
    });
  }
  // Несколько открытых счетов — просим явный выбор вместо угадывания.
  const list = open.map((a) => `${a.id} (${a.name})`).join(', ');
  throw new AppError({
    code: 'APP_TINVEST_ACCOUNT_AMBIGUOUS',
    userMessage: `У вас несколько открытых счетов: ${list}. Укажите нужный через --account <id>.`,
  });
}
