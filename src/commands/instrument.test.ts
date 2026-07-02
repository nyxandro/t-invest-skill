/**
 * Тесты команды instrument: сборка универсальной карточки, русские подписи
 * статуса торгов, блок гарантийного обеспечения фьючерса.
 */
import { describe, expect, it } from 'vitest';
import { buildInstrumentCard } from './instrument.js';

describe('buildInstrumentCard', () => {
  const details = {
    uid: 'uid-1',
    figi: 'FIGI1',
    isin: 'RU0009029540',
    name: 'Сбер Банк',
    ticker: 'SBER',
    instrumentType: 'share',
    lot: 10,
    currency: 'rub',
    exchange: 'MOEX',
    countryOfRiskName: 'Российская Федерация',
    forQualInvestorFlag: false,
  };

  it('собирает карточку с ценой и русским статусом торгов', () => {
    const view = buildInstrumentCard({
      details,
      lastPrice: { figi: 'FIGI1', instrumentUid: 'uid-1', price: { units: '301', nano: 930000000 } },
      status: {
        tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
        apiTradeAvailableFlag: true,
      },
      futuresMargin: null,
    });
    expect(view.lastPrice).toBe(301.93);
    expect(view.tradingStatusText).toBe('идут торги');
    expect(view.apiTradeAvailable).toBe(true);
    expect(view.countryOfRisk).toBe('Российская Федерация');
    expect(view.futuresMargin).toBeNull();
  });

  it('неизвестный статус торгов остаётся enum-строкой (не выдумываем подпись)', () => {
    const view = buildInstrumentCard({
      details,
      lastPrice: undefined,
      status: { tradingStatus: 'SECURITY_TRADING_STATUS_SOMETHING_NEW' },
      futuresMargin: null,
    });
    expect(view.tradingStatusText).toBe('SECURITY_TRADING_STATUS_SOMETHING_NEW');
    expect(view.lastPrice).toBeNull();
  });

  it('для фьючерса маппится гарантийное обеспечение', () => {
    const view = buildInstrumentCard({
      details: { ...details, instrumentType: 'futures' },
      lastPrice: undefined,
      status: {},
      futuresMargin: {
        initialMarginOnBuy: { currency: 'rub', units: '5000', nano: 0 },
        initialMarginOnSell: { currency: 'rub', units: '5500', nano: 0 },
        minPriceIncrement: { units: '0', nano: 10000000 },
        minPriceIncrementAmount: { units: '1', nano: 0 },
      },
    });
    expect(view.futuresMargin).toEqual({
      initialMarginOnBuy: 5000,
      initialMarginOnSell: 5500,
      minPriceIncrement: 0.01,
      minPriceIncrementAmount: 1,
    });
  });
});
