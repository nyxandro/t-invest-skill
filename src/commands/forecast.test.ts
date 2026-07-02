/**
 * Тесты команды forecast: консенсус и прогнозы домов, русские ярлыки
 * рекомендаций, явная ошибка при отсутствии прогнозов.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import { findShareFixture, forecastResponseFixture } from '../api/mocks/analytics.fixture.js';
import { fetchForecast } from './forecast.js';

function apiWith(overrides: Partial<Parameters<typeof fetchForecast>[0]> = {}) {
  return {
    findInstrument: async () => findShareFixture,
    getForecastBy: async () => forecastResponseFixture,
    ...overrides,
  };
}

describe('fetchForecast', () => {
  it('возвращает консенсус с русским ярлыком и список прогнозов', async () => {
    const view = await fetchForecast(apiWith(), 'TSTR');

    expect(view.consensus).not.toBeNull();
    expect(view.consensus!.recommendationLabel).toBe('покупать');
    expect(view.consensus!.consensusPrice).toBeCloseTo(350, 6);
    expect(view.consensus!.upsidePercent).toBeCloseTo(16.67, 2);
    expect(view.targets).toHaveLength(2);
    expect(view.targets[1]!.recommendationLabel).toBe('держать');
  });

  it('без прогнозов — APP_TINVEST_FORECAST_UNAVAILABLE', async () => {
    const err = await fetchForecast(apiWith({ getForecastBy: async () => ({}) }), 'TSTR').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_FORECAST_UNAVAILABLE');
  });
});
