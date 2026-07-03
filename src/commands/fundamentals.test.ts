/**
 * Тесты команды fundamentals: маппинг метрик (отсутствие поля → null),
 * явные ошибки при недоступности показателей.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import {
  findShareFixture,
  fundamentalsResponseFixture,
} from '../api/mocks/analytics.fixture.js';
import { fetchFundamentals, renderFundamentals } from './fundamentals.js';

function apiWith(overrides: Partial<Parameters<typeof fetchFundamentals>[0]> = {}) {
  return {
    findInstrument: async () => findShareFixture,
    getInstrumentByUid: async () => ({
      instrument: { uid: 'uid-share', name: 'Тест-Ритейл', assetUid: 'asset-uid-share' },
    }),
    getAssetFundamentals: async () => fundamentalsResponseFixture,
    ...overrides,
  };
}

describe('fetchFundamentals', () => {
  it('маппит метрики по группам; незаполненные поля становятся null', async () => {
    const view = await fetchFundamentals(apiWith(), 'TSTR');

    expect(view.valuation.peRatioTtm).toBeCloseTo(4.5, 6);
    expect(view.profitability.roe).toBeCloseTo(22.5, 6);
    expect(view.dividends.dividendYieldDailyTtm).toBeCloseTo(11.2, 6);
    expect(view.debt.totalDebtToEbitdaMrq).toBeCloseTo(1.1, 6);
    // Поля, которых нет в фикстуре (protobuf опускает нули) → null, не 0.
    expect(view.profitability.roic).toBeNull();
    expect(view.debt.netDebtToEbitda).toBeNull();
  });

  it('нулевой коэффициент = «нет данных» → null и прочерк (единая семантика с screen-shares, K42)', async () => {
    // REST-шлюз опускает нулевые double: 0 у коэффициента неотличим от отсутствия.
    // Раньше fundamentals сохранял буквальный 0 («P/E 0.00»), а screen-shares
    // трактовал 0 как отсутствие — теперь трактовка единая.
    const view = await fetchFundamentals(
      apiWith({
        getAssetFundamentals: async () => ({
          fundamentals: [{ assetUid: 'asset-uid-share', currency: 'rub', peRatioTtm: 0 }],
        }),
      }),
      'TSTR',
    );

    expect(view.valuation.peRatioTtm).toBeNull();
    const rendered = renderFundamentals(view);
    expect(rendered).toContain('P/E: —');
    expect(rendered).not.toContain('P/E: 0.00');
  });

  it('без assetUid в карточке — APP_TINVEST_FUNDAMENTALS_UNAVAILABLE', async () => {
    const err = await fetchFundamentals(
      apiWith({
        getInstrumentByUid: async () => ({ instrument: { uid: 'uid-share', name: 'Тест-Ритейл' } }),
      }),
      'TSTR',
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_FUNDAMENTALS_UNAVAILABLE');
  });

  it('пустой ответ API — та же ошибка (для облигаций/фондов данных нет)', async () => {
    const err = await fetchFundamentals(
      apiWith({ getAssetFundamentals: async () => ({}) }),
      'TSTR',
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_FUNDAMENTALS_UNAVAILABLE');
  });
});
