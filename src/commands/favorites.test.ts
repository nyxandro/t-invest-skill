/**
 * Тесты команды favorites: сопоставление цен вотчлисту, null-цены
 * для неторгуемых бумаг.
 */
import { describe, expect, it } from 'vitest';
import { buildFavoriteViews } from './favorites.js';

describe('buildFavoriteViews', () => {
  it('сопоставляет цены по uid; без цены — null', () => {
    const views = buildFavoriteViews(
      [
        { uid: 'uid-1', ticker: 'KO', name: 'COCA-COLA', instrumentType: 'share', apiTradeAvailableFlag: true },
        { uid: 'uid-2', ticker: 'TSLA', name: 'Tesla inc.', instrumentType: 'share' },
      ],
      [{ figi: 'f1', instrumentUid: 'uid-1', price: { units: '70', nano: 500000000 } }],
    );
    expect(views[0]).toMatchObject({ ticker: 'KO', lastPrice: 70.5, apiTradeAvailable: true });
    // Для uid-2 цены нет (торги не идут) — null, не ноль.
    expect(views[1]).toMatchObject({ ticker: 'TSLA', lastPrice: null, apiTradeAvailable: null });
  });
});
