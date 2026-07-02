/**
 * Тесты команды cash: маппинг остатков по валютам, отбрасывание нулевых
 * сумм, пустой счёт.
 */
import { describe, expect, it } from 'vitest';
import { buildCashView } from './cash.js';

describe('buildCashView', () => {
  it('маппит доступные и заблокированные суммы по валютам', () => {
    const view = buildCashView('acc-1', {
      money: [
        { currency: 'rub', units: '1500', nano: 500000000 },
        { currency: 'usd', units: '10', nano: 0 },
      ],
      blocked: [{ currency: 'rub', units: '200', nano: 0 }],
      blockedGuarantee: [],
    });
    expect(view.available).toEqual([
      { currency: 'rub', amount: 1500.5 },
      { currency: 'usd', amount: 10 },
    ]);
    expect(view.blocked).toEqual([{ currency: 'rub', amount: 200 }]);
    expect(view.blockedGuarantee).toEqual([]);
  });

  it('нулевые суммы отбрасываются (валюта «была когда-то»)', () => {
    const view = buildCashView('acc-1', {
      money: [
        { currency: 'rub', units: '100', nano: 0 },
        { currency: 'eur', units: '0', nano: 0 },
      ],
    });
    expect(view.available).toEqual([{ currency: 'rub', amount: 100 }]);
  });

  it('protobuf-JSON без полей — пустой счёт без ошибок', () => {
    const view = buildCashView('acc-1', {});
    expect(view.available).toEqual([]);
    expect(view.blocked).toEqual([]);
  });
});
