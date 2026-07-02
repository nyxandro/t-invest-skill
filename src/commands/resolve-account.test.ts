/**
 * Тесты выбора брокерского счёта: единственный открытый счёт берётся
 * автоматически, неоднозначность и отсутствие счетов — явные ошибки
 * (политика no-fallbacks: не угадываем счёт за пользователя).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import {
  accountsResponseFixture,
  noOpenAccountsFixture,
  twoOpenAccountsFixture,
} from '../api/mocks/accounts.fixture.js';
import type { GetAccountsResponse } from '../api/types.js';
import { resolveAccountId } from './resolve-account.js';

// Стаб API счетов: отдаёт заранее заданную фикстуру.
function apiWith(response: GetAccountsResponse) {
  return { getAccounts: async () => response };
}

describe('resolveAccountId', () => {
  it('возвращает единственный открытый счёт, когда --account не указан', async () => {
    await expect(resolveAccountId(apiWith(accountsResponseFixture))).resolves.toBe('2000000001');
  });

  it('использует явно указанный счёт, если он существует (даже закрытый)', async () => {
    await expect(
      resolveAccountId(apiWith(accountsResponseFixture), '2000000002'),
    ).resolves.toBe('2000000002');
  });

  it('падает APP_TINVEST_ACCOUNT_NOT_FOUND для несуществующего счёта', async () => {
    const err = await resolveAccountId(apiWith(accountsResponseFixture), '999').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_ACCOUNT_NOT_FOUND');
  });

  it('падает APP_TINVEST_ACCOUNT_AMBIGUOUS при нескольких открытых счетах', async () => {
    const err = await resolveAccountId(apiWith(twoOpenAccountsFixture)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_ACCOUNT_AMBIGUOUS');
    // В сообщении должны быть перечислены id счетов, чтобы пользователь мог выбрать.
    expect((err as AppError).userMessage).toContain('2000000001');
    expect((err as AppError).userMessage).toContain('2000000003');
  });

  it('падает APP_TINVEST_NO_ACCOUNTS, если открытых счетов нет', async () => {
    const err = await resolveAccountId(apiWith(noOpenAccountsFixture)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_NO_ACCOUNTS');
  });
});
