/**
 * Мок-фикстура ответа OperationsService/GetPortfolio для тестов.
 *
 * Экспорты:
 * - portfolioResponseFixture — портфель из акции (SBER), облигации (ОФЗ)
 *   и фонда (TMOS) с согласованными числами:
 *   SBER: 100 шт, средняя 250.00, текущая 305.50 → P/L = +5550.00 (+22.2%).
 */
import type { PortfolioResponse } from '../types.js';

export const portfolioResponseFixture: PortfolioResponse = {
  accountId: '2000000001',
  totalAmountPortfolio: { currency: 'rub', units: '150000', nano: 0 },
  totalAmountShares: { currency: 'rub', units: '30550', nano: 0 },
  totalAmountBonds: { currency: 'rub', units: '49265', nano: 0 },
  totalAmountEtf: { currency: 'rub', units: '7420', nano: 0 },
  totalAmountCurrencies: { currency: 'rub', units: '62765', nano: 0 },
  // Относительная доходность всего портфеля: +12.5 %
  expectedYield: { units: '12', nano: 500000000 },
  dailyYield: { currency: 'rub', units: '350', nano: 0 },
  positions: [
    // Акция: полная позиция со всеми ценами.
    {
      figi: 'BBG004730N88',
      instrumentUid: 'uid-sber',
      instrumentType: 'share',
      ticker: 'SBER',
      classCode: 'TQBR',
      quantity: { units: '100', nano: 0 },
      averagePositionPrice: { currency: 'rub', units: '250', nano: 0 },
      currentPrice: { currency: 'rub', units: '305', nano: 500000000 },
      expectedYield: { units: '5550', nano: 0 },
      dailyYield: { currency: 'rub', units: '120', nano: 0 },
    },
    // Облигация: есть накопленный купонный доход (НКД).
    {
      figi: 'BBG00XXXXXX1',
      instrumentUid: 'uid-ofz',
      instrumentType: 'bond',
      ticker: 'SU26238RMFS4',
      classCode: 'TQOB',
      quantity: { units: '50', nano: 0 },
      averagePositionPrice: { currency: 'rub', units: '950', nano: 0 },
      currentPrice: { currency: 'rub', units: '985', nano: 300000000 },
      currentNkd: { currency: 'rub', units: '12', nano: 340000000 },
      expectedYield: { units: '1765', nano: 0 },
    },
    // Фонд: дробные цены.
    {
      figi: 'BBG00XXXXXX2',
      instrumentUid: 'uid-tmos',
      instrumentType: 'etf',
      ticker: 'TMOS',
      classCode: 'TQTF',
      quantity: { units: '1000', nano: 0 },
      averagePositionPrice: { currency: 'rub', units: '6', nano: 500000000 },
      currentPrice: { currency: 'rub', units: '7', nano: 420000000 },
      expectedYield: { units: '920', nano: 0 },
    },
  ],
};
