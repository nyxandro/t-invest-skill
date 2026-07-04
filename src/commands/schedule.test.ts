/**
 * Тесты команды schedule: перевод сессий UTC→МСК, торговый/выходной день,
 * пустой ответ как явная ошибка.
 */
import { describe, expect, it } from 'vitest';
import type { TradingSchedulesResponse } from '../api/types-market.js';
import { fetchSchedule, renderSchedule, type ScheduleApi } from './schedule.js';

function api(resp: TradingSchedulesResponse): ScheduleApi {
  return {
    async getTradingSchedules() {
      return resp;
    },
  };
}

const NOW = new Date('2026-07-04T00:00:00Z');

describe('fetchSchedule', () => {
  it('торговый день: сессии переводятся в МСК; выходной — без сессий', async () => {
    const view = await fetchSchedule(
      api({
        exchanges: [
          {
            exchange: 'MOEX',
            days: [
              {
                date: '2026-07-06T00:00:00Z',
                isTradingDay: true,
                startTime: '2026-07-06T07:00:00Z', // 10:00 МСК
                endTime: '2026-07-06T15:40:00Z', // 18:40 МСК
                eveningStartTime: '2026-07-06T16:05:00Z', // 19:05 МСК
                eveningEndTime: '2026-07-06T20:50:00Z', // 23:50 МСК
              },
              { date: '2026-07-05T00:00:00Z', isTradingDay: false },
            ],
          },
        ],
      }),
      { exchange: 'MOEX', days: 7, now: NOW },
    );
    expect(view.exchanges[0]?.exchange).toBe('MOEX');
    const [d1, d2] = view.exchanges[0]!.days;
    expect(d1).toMatchObject({ isTradingDay: true, mainSession: '10:00–18:40', eveningSession: '19:05–23:50' });
    expect(d2).toMatchObject({ isTradingDay: false, mainSession: null, eveningSession: null });
  });

  it('пустой ответ → APP_TINVEST_SCHEDULE_UNAVAILABLE', async () => {
    await expect(
      fetchSchedule(api({ exchanges: [] }), { days: 7, now: NOW }),
    ).rejects.toMatchObject({ code: 'APP_TINVEST_SCHEDULE_UNAVAILABLE' });
  });
});

describe('renderSchedule', () => {
  it('показывает площадку, «да/нет» и сессию', () => {
    const text = renderSchedule({
      exchanges: [
        {
          exchange: 'MOEX',
          days: [{ date: '2026-07-06', isTradingDay: true, mainSession: '10:00–18:40', eveningSession: null }],
        },
      ],
    });
    expect(text).toContain('Площадка: MOEX');
    expect(text).toContain('10:00–18:40');
    expect(text).toContain('да');
  });
});
