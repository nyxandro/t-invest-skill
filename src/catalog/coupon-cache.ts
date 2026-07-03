/**
 * Дисковый кэш графиков купонов для скринера облигаций.
 *
 * Графики купонов меняются редко (новые ставки флоатеров, оферты), а скринер
 * запрашивает их сотнями — без кэша каждый прогон упирался бы в лимиты API.
 * Один файл на контур: ~/.config/tinvest/cache/coupons-<contour>.json.
 *
 * Экспорты:
 * - CouponCache — карта uid → {savedAt, events};
 * - loadCouponCache(filePath) — чтение (битый/иная версия → пустой кэш);
 * - saveCouponCache(filePath, cache) — атомарная запись со слиянием;
 * - couponCachePath(cacheDir, contour) — путь к файлу;
 * - getFreshCouponEntry(cache, uid, now) — валидная и не протухшая запись.
 */
import path from 'node:path';
import type { BondCoupon } from '../api/types.js';
import { COUPON_CACHE_TTL_MS } from '../config/config.js';
import { readVersionedCache, writeVersionedCache } from './file-cache.js';

export interface CouponCacheEntry {
  savedAt: string;
  events: BondCoupon[];
}

export type CouponCache = Record<string, CouponCacheEntry>;

// Версия схемы записи кэша купонов: поднять при изменении формата CouponCacheEntry.
const COUPON_CACHE_SCHEMA_VERSION = 1;

export function couponCachePath(cacheDir: string, contour: string): string {
  return path.join(cacheDir, `coupons-${contour}.json`);
}

export function loadCouponCache(filePath: string): CouponCache {
  const cache = readVersionedCache<CouponCache>(filePath, COUPON_CACHE_SCHEMA_VERSION, 'купонов');
  return cache && typeof cache === 'object' ? cache : {};
}

// Запись со слиянием: скринер читает кэш ДО многоминутного фетча купонов,
// поэтому прямая перезапись всего файла затирала бы записи параллельного
// процесса. Записи аддитивны по uid — перечитываем актуальный файл и сливаем
// свои поверх, сводя потерю обновлений при конкурентных запусках к минимуму.
export function saveCouponCache(filePath: string, cache: CouponCache): void {
  const current = loadCouponCache(filePath);
  writeVersionedCache(filePath, COUPON_CACHE_SCHEMA_VERSION, { ...current, ...cache });
}

export function getFreshCouponEntry(
  cache: CouponCache,
  uid: string,
  now: Date,
): CouponCacheEntry | null {
  const entry = cache[uid];
  // Валидация структуры записи: запись со свежим savedAt, но events не-массивом
  // (ручная правка файла или дрейф схемы) раньше проходила проверку свежести и
  // позже роняла скринер на events.filter — отсекаем такую запись здесь.
  if (!entry || typeof entry.savedAt !== 'string' || !Array.isArray(entry.events)) {
    return null;
  }
  const age = now.getTime() - Date.parse(entry.savedAt);
  return age >= 0 && age <= COUPON_CACHE_TTL_MS ? entry : null;
}
