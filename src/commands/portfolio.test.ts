/**
 * Тесты построения представления портфеля: конвертация units/nano,
 * расчёт стоимости позиции, P/L (абсолютного и в процентах) и итогов.
 */
import { describe, expect, it } from 'vitest';
import { accountsResponseFixture } from '../api/mocks/accounts.fixture.js';
import { portfolioResponseFixture } from '../api/mocks/portfolio.fixture.js';
import type { PortfolioResponse } from '../api/types.js';
import { BATCH_CONCURRENCY } from '../config/config.js';
import { buildPortfolioView, fetchPortfolio, renderPortfolioChart } from './portfolio.js';

describe('buildPortfolioView', () => {
  const view = buildPortfolioView(portfolioResponseFixture);

  it('конвертирует итоговые суммы портфеля', () => {
    expect(view.accountId).toBe('2000000001');
    expect(view.currency).toBe('rub');
    expect(view.totals.portfolio).toBe(150000);
    expect(view.totals.shares).toBe(30550);
    expect(view.totals.bonds).toBe(49265);
    expect(view.totals.etf).toBe(7420);
    expect(view.expectedYieldPercent).toBe(12.5);
  });

  it('рассчитывает позицию акции: стоимость и P/L', () => {
    const sber = view.positions.find((p) => p.ticker === 'SBER');
    expect(sber).toBeDefined();
    expect(sber?.quantity).toBe(100);
    expect(sber?.averagePrice).toBe(250);
    expect(sber?.currentPrice).toBe(305.5);
    expect(sber?.value).toBe(30550);
    // P/L считаем сами из цен, а не берём из API: (305.5 - 250) * 100.
    expect(sber?.pnl).toBe(5550);
    expect(sber?.pnlPercent).toBeCloseTo(22.2, 1);
  });

  it('для облигации отдаёт НКД за одну бумагу', () => {
    const bond = view.positions.find((p) => p.instrumentType === 'bond');
    expect(bond?.nkdPerUnit).toBeCloseTo(12.34, 2);
  });

  it('без карты названий поле name = null (не выдумывается)', () => {
    expect(view.positions[0]?.name).toBeNull();
  });

  it('опущенный шлюзом expectedYield → expectedYieldPercent = null, а не крэш', () => {
    // Ловушка: expectedYield — message-поле, при нулевой доходности шлюз его
    // опускает. Раньше quotationToNumber(undefined) уронил бы команду.
    const withoutYield: PortfolioResponse = { ...portfolioResponseFixture };
    delete withoutYield.expectedYield;
    const v = buildPortfolioView(withoutYield);
    expect(v.expectedYieldPercent).toBeNull();
  });

  it('позиция без средней цены не получает выдуманный P/L (null, не 0)', () => {
    const resp: PortfolioResponse = {
      ...portfolioResponseFixture,
      positions: [
        {
          figi: 'BBG000000001',
          instrumentUid: 'uid-x',
          instrumentType: 'share',
          ticker: 'XXXX',
          quantity: { units: '1', nano: 0 },
          currentPrice: { currency: 'rub', units: '10', nano: 0 },
        },
      ],
    };
    const v = buildPortfolioView(resp);
    expect(v.positions[0]?.pnl).toBeNull();
    expect(v.positions[0]?.pnlPercent).toBeNull();
    expect(v.positions[0]?.averagePrice).toBeNull();
  });
});

describe('fetchPortfolio — обогащение названиями инструментов', () => {
  // Стаб клиента: карточки инструментов отдаются по UID, для uid-ofz — ошибка API.
  function apiStub() {
    const names: Record<string, string> = {
      'uid-sber': 'Сбер Банк',
      'uid-tmos': 'Крупнейшие компании РФ',
    };
    return {
      getAccounts: async () => accountsResponseFixture,
      getPortfolio: async () => portfolioResponseFixture,
      getInstrumentByUid: async (uid: string) => {
        const name = names[uid];
        if (!name) {
          throw new Error('instrument not found');
        }
        return { instrument: { uid, name, instrumentType: 'share' } };
      },
    };
  }

  it('позиции получают полные названия из карточек инструментов', async () => {
    const view = await fetchPortfolio(apiStub());

    expect(view.positions.find((p) => p.ticker === 'SBER')?.name).toBe('Сбер Банк');
    expect(view.positions.find((p) => p.ticker === 'TMOS')?.name).toBe('Крупнейшие компании РФ');
  });

  it('сбой карточки одного инструмента не роняет портфель: name = null у него, остальные заполнены', async () => {
    const view = await fetchPortfolio(apiStub());

    // uid-ofz бросил ошибку — название null (поле презентационное), команда не упала.
    expect(view.positions.find((p) => p.instrumentType === 'bond')?.name).toBeNull();
    expect(view.positions.find((p) => p.ticker === 'SBER')?.name).toBe('Сбер Банк');
  });
});

describe('fetchPortfolio — троттлинг загрузки названий (K12)', () => {
  // Регрессия K12: раньше названия грузились неограниченным Promise.all —
  // залп унарных GetInstrumentBy на большом портфеле упирался в лимиты (429).
  // Проверяем, что число одновременных запросов не превышает BATCH_CONCURRENCY
  // (при неограниченном Promise.all оно было бы равно числу позиций).
  it('ограничивает число одновременных запросов названий до BATCH_CONCURRENCY', async () => {
    // Заведомо больше окна параллелизма, чтобы отличить троттлинг от залпа.
    const positionCount = BATCH_CONCURRENCY + 2;
    const positions = Array.from({ length: positionCount }, (_, i) => ({
      figi: `figi-${i}`,
      instrumentUid: `uid-${i}`,
      instrumentType: 'share',
      ticker: `T${i}`,
      quantity: { units: '1', nano: 0 },
    }));
    const resp: PortfolioResponse = { ...portfolioResponseFixture, positions };

    // Счётчик одновременно выполняющихся запросов карточек.
    let inFlight = 0;
    let maxInFlight = 0;
    const api = {
      getAccounts: async () => accountsResponseFixture,
      getPortfolio: async () => resp,
      getInstrumentByUid: async (uid: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { instrument: { uid, name: `Имя ${uid}`, instrumentType: 'share' } };
      },
    };

    const view = await fetchPortfolio(api);

    expect(maxInFlight).toBeLessThanOrEqual(BATCH_CONCURRENCY);
    expect(maxInFlight).toBeLessThan(positionCount); // залпа больше нет
    // Все названия резолвятся (поведение сохранено).
    expect(view.positions).toHaveLength(positionCount);
    expect(view.positions.every((p) => p.name !== null)).toBe(true);
  });
});

describe('renderPortfolioChart', () => {
  const view = buildPortfolioView(portfolioResponseFixture);

  it('строит бары позиций по стоимости с символом валюты', () => {
    const out = renderPortfolioChart(view);
    expect(out).toContain('Позиции по стоимости');
    expect(out).toContain('█');
    expect(out).toContain('₽');
    // Известные бумаги фикстуры присутствуют как подписи баров.
    expect(out).toContain('SBER');
    expect(out).toContain('TMOS');
  });

  it('сортирует бары по убыванию стоимости (самая дорогая позиция — сверху)', () => {
    const out = renderPortfolioChart(view);
    const lines = out.split('\n').slice(1); // первая строка — заголовок
    const withValue = view.positions
      .filter((p) => p.value !== null && p.instrumentType !== 'currency')
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    // Порядок подписей в графике совпадает с сортировкой по стоимости.
    expect(lines[0]!.startsWith(withValue[0]!.ticker)).toBe(true);
  });
});
