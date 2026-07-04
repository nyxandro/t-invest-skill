/**
 * Команда schedule: расписание торгов бирж/площадок (когда открыты торги).
 *
 * Экспорты:
 * - ScheduleApi — контракт клиента (getTradingSchedules);
 * - ScheduleDayView / ScheduleExchangeView / ScheduleView — представление;
 * - fetchSchedule(api, params) — расписание за период (по площадке или всем);
 * - renderSchedule(view) — таблица по каждой площадке.
 *
 * Времена API — в UTC; в выводе переводим в МСК. Показываем основную и
 * вечернюю сессии (достаточно для ответа «когда открыты торги»).
 */
import { AppError } from '../api/errors.js';
import type { TradingSchedulesResponse } from '../api/types-market.js';
import { MS_PER_DAY } from '../config/config.js';
import { formatMoscowDate, formatMoscowTime } from '../format/datetime.js';
import { renderTable } from '../format/table.js';
import { DASH } from '../format/values.js';

export interface ScheduleApi {
  getTradingSchedules(
    exchange: string | undefined,
    from: string,
    to: string,
  ): Promise<TradingSchedulesResponse>;
}

export interface ScheduleDayView {
  date: string | null; // YYYY-MM-DD (МСК)
  isTradingDay: boolean;
  mainSession: string | null; // «10:00–18:40» (МСК) или null (нет данных/не торгуется)
  eveningSession: string | null;
}

export interface ScheduleExchangeView {
  exchange: string;
  days: ScheduleDayView[];
}

export interface ScheduleView {
  exchanges: ScheduleExchangeView[];
}

// Диапазон сессии в МСК; null, если хоть одна граница не пришла (частая ситуация
// у выходных/неполных дней) — не подставляем ложные границы (no-fallbacks).
function sessionRange(start: string | undefined, end: string | undefined): string | null {
  if (!start || !end) {
    return null;
  }
  return `${formatMoscowTime(start)}–${formatMoscowTime(end)}`;
}

export async function fetchSchedule(
  api: ScheduleApi,
  params: { exchange?: string; days: number; now: Date },
): Promise<ScheduleView> {
  // Период: от текущего момента на `days` дней вперёд.
  const from = params.now.toISOString();
  const to = new Date(params.now.getTime() + params.days * MS_PER_DAY).toISOString();
  const resp = await api.getTradingSchedules(params.exchange, from, to);
  const exchanges = resp.exchanges ?? [];
  // Пустой ответ — явная ошибка (неверное имя площадки или период вне данных),
  // а не «успех без строк»: пользователю нужен понятный сигнал.
  if (exchanges.length === 0) {
    throw new AppError({
      code: 'APP_TINVEST_SCHEDULE_UNAVAILABLE',
      userMessage: params.exchange
        ? `Расписание торгов для площадки «${params.exchange}» не найдено — проверьте название площадки или запросите без него (покажет все).`
        : 'Расписание торгов не найдено за указанный период.',
    });
  }
  return {
    exchanges: exchanges.map((e) => ({
      exchange: e.exchange ?? DASH,
      days: (e.days ?? []).map((d) => {
        const trading = d.isTradingDay ?? false;
        return {
          date: d.date ? formatMoscowDate(d.date) : null,
          isTradingDay: trading,
          // Сессии показываем только у торговых дней.
          mainSession: trading ? sessionRange(d.startTime, d.endTime) : null,
          eveningSession: trading ? sessionRange(d.eveningStartTime, d.eveningEndTime) : null,
        };
      }),
    })),
  };
}

export function renderSchedule(view: ScheduleView): string {
  return view.exchanges
    .map((e) => {
      const table = renderTable(
        ['Дата', 'Торги', 'Основная (МСК)', 'Вечерняя (МСК)'],
        e.days.map((d) => [
          d.date ?? DASH,
          d.isTradingDay ? 'да' : 'нет',
          d.mainSession ?? DASH,
          d.eveningSession ?? DASH,
        ]),
      );
      return `Площадка: ${e.exchange}\n${table}`;
    })
    .join('\n\n');
}
