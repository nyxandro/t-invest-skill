/**
 * Форматирование дат и времени для вывода CLI в часовом поясе Москвы.
 *
 * T-Invest API отдаёт все таймстемпы в UTC (ISO с 'Z'), а биржа MOEX и
 * пользователь живут по МСК (UTC+3, без перехода на летнее время). Наивный
 * срез UTC-строки (`iso.slice(0,16)`) показывает время на 3 часа раньше и у
 * ночных/вечерних операций уводит календарную дату на день назад — поэтому
 * любой datetime из API обязан пройти через эти хелперы.
 *
 * Экспорты:
 * - MOSCOW_OFFSET_MS — сдвиг МСК относительно UTC;
 * - formatMoscowDateTime(iso) — «YYYY-MM-DD HH:MM» в МСК;
 * - formatMoscowDate(iso) — «YYYY-MM-DD» в МСК;
 * - formatMoscowTime(iso) — «HH:MM» в МСК (время суток без даты).
 */

// МСК фиксирован на UTC+3 круглый год (Россия не переходит на летнее время
// с 2014 г.), поэтому достаточно константного сдвига, а не базы часовых поясов.
export const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

// Двузначное дополнение нулём для компонентов даты/времени.
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// Сдвигаем UTC-момент на МСК и берём компоненты в UTC — так они читаются
// как «настенные часы» московского времени. Возвращаем исходную строку, если
// таймстемп не распарсился: это презентационный слой, и портить вывод крэшем
// на неожиданном формате хуже, чем показать сырое значение (данные не теряются).
function moscowParts(iso: string): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
} | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return null;
  }
  const shifted = new Date(ms + MOSCOW_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

export function formatMoscowDateTime(iso: string): string {
  const p = moscowParts(iso);
  if (!p) {
    return iso;
  }
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hours)}:${pad2(p.minutes)}`;
}

export function formatMoscowDate(iso: string): string {
  const p = moscowParts(iso);
  if (!p) {
    return iso;
  }
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function formatMoscowTime(iso: string): string {
  const p = moscowParts(iso);
  if (!p) {
    return iso;
  }
  return `${pad2(p.hours)}:${pad2(p.minutes)}`;
}
