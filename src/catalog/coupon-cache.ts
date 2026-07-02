/**
 * Дисковый кэш графиков купонов для скринера облигаций.
 *
 * Графики купонов меняются редко (новые ставки флоатеров, оферты), а скринер
 * запрашивает их сотнями — без кэша каждый прогон упирался бы в лимиты API.
 * Один файл на контур: ~/.config/tinvest/cache/coupons-<contour>.json.
 *
 * Экспорты:
 * - CouponCache — карта uid → {savedAt, events};
 * - loadCouponCache(filePath) — чтение (битый файл → пустой кэш + warning);
 * - saveCouponCache(filePath, cache) — атомарная запись;
 * - couponCachePath(cacheDir, contour) — путь к файлу;
 * - getFreshCouponEntry(cache, uid, now) — запись, если она не протухла.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BondCoupon } from '../api/types.js';
import { COUPON_CACHE_TTL_MS } from '../config/config.js';

export interface CouponCacheEntry {
  savedAt: string;
  events: BondCoupon[];
}

export type CouponCache = Record<string, CouponCacheEntry>;

export function couponCachePath(cacheDir: string, contour: string): string {
  return path.join(cacheDir, `coupons-${contour}.json`);
}

export function loadCouponCache(filePath: string): CouponCache {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CouponCache;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    console.error(`Предупреждение: кэш купонов повреждён и будет перезаписан: ${filePath}`);
    return {};
  }
}

// Атомарная запись (tmp + rename) — параллельный CLI не увидит пол-файла.
export function saveCouponCache(filePath: string, cache: CouponCache): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache));
  fs.renameSync(tmpPath, filePath);
}

export function getFreshCouponEntry(
  cache: CouponCache,
  uid: string,
  now: Date,
): CouponCacheEntry | null {
  const entry = cache[uid];
  if (!entry) {
    return null;
  }
  const age = now.getTime() - Date.parse(entry.savedAt);
  return age >= 0 && age <= COUPON_CACHE_TTL_MS ? entry : null;
}
