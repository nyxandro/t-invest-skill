/**
 * Мок-фикстуры ответов UsersService/GetAccounts для тестов.
 *
 * Экспорты:
 * - accountsResponseFixture — один открытый брокерский счёт + закрытый ИИС;
 * - twoOpenAccountsFixture — два открытых счёта (кейс неоднозначности);
 * - noOpenAccountsFixture — только закрытые счета.
 */
import type { GetAccountsResponse } from '../types.js';

// Типовой кейс: один действующий счёт и закрытый ИИС в истории.
export const accountsResponseFixture: GetAccountsResponse = {
  accounts: [
    {
      id: '2000000001',
      type: 'ACCOUNT_TYPE_TINKOFF',
      name: 'Основной счёт',
      status: 'ACCOUNT_STATUS_OPEN',
      openedDate: '2021-05-10T00:00:00Z',
      accessLevel: 'ACCOUNT_ACCESS_LEVEL_READ_ONLY',
    },
    {
      id: '2000000002',
      type: 'ACCOUNT_TYPE_TINKOFF_IIS',
      name: 'ИИС',
      status: 'ACCOUNT_STATUS_CLOSED',
      openedDate: '2019-01-01T00:00:00Z',
      closedDate: '2023-01-01T00:00:00Z',
      accessLevel: 'ACCOUNT_ACCESS_LEVEL_READ_ONLY',
    },
  ],
};

// Кейс неоднозначности: без явного --account выбрать нельзя.
export const twoOpenAccountsFixture: GetAccountsResponse = {
  accounts: [
    {
      id: '2000000001',
      type: 'ACCOUNT_TYPE_TINKOFF',
      name: 'Основной счёт',
      status: 'ACCOUNT_STATUS_OPEN',
      accessLevel: 'ACCOUNT_ACCESS_LEVEL_READ_ONLY',
    },
    {
      id: '2000000003',
      type: 'ACCOUNT_TYPE_TINKOFF_IIS',
      name: 'ИИС',
      status: 'ACCOUNT_STATUS_OPEN',
      accessLevel: 'ACCOUNT_ACCESS_LEVEL_READ_ONLY',
    },
  ],
};

// Кейс «нет доступных счетов»: все счета закрыты.
export const noOpenAccountsFixture: GetAccountsResponse = {
  accounts: [
    {
      id: '2000000002',
      type: 'ACCOUNT_TYPE_TINKOFF_IIS',
      name: 'ИИС',
      status: 'ACCOUNT_STATUS_CLOSED',
      accessLevel: 'ACCOUNT_ACCESS_LEVEL_READ_ONLY',
    },
  ],
};
