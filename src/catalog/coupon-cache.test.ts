/**
 * Тесты кэша купонов: round-trip, свежесть по TTL, отсев битой записи
 * (events не-массив) и слияние при конкурентной записи (не терять чужие uid).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COUPON_CACHE_TTL_MS } from '../config/config.js';
import {
  couponCachePath,
  getFreshCouponEntry,
  loadCouponCache,
  saveCouponCache,
  type CouponCache,
} from './coupon-cache.js';

const now = new Date('2026-07-02T12:00:00Z');

function entry(savedAt: string): CouponCache[string] {
  return { savedAt, events: [{ couponDate: '2026-08-01T00:00:00Z' }] };
}

describe('coupon-cache', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinvest-coupon-test-'));
    file = couponCachePath(dir, 'prod');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('save → load возвращает записи', () => {
    saveCouponCache(file, { 'uid-1': entry(now.toISOString()) });
    expect(loadCouponCache(file)['uid-1']?.events).toHaveLength(1);
  });

  it('getFreshCouponEntry: свежая запись возвращается, протухшая — null', () => {
    const cache: CouponCache = { fresh: entry(now.toISOString()) };
    expect(getFreshCouponEntry(cache, 'fresh', now)).not.toBeNull();
    const stale = new Date(now.getTime() + COUPON_CACHE_TTL_MS + 1000);
    expect(getFreshCouponEntry(cache, 'fresh', stale)).toBeNull();
  });

  it('getFreshCouponEntry: запись с events не-массивом отсекается (не роняет скринер)', () => {
    // Свежая по savedAt, но битая по структуре — регресс K49.
    const cache = { bad: { savedAt: now.toISOString(), events: 'oops' } } as unknown as CouponCache;
    expect(getFreshCouponEntry(cache, 'bad', now)).toBeNull();
  });

  it('saveCouponCache сливает записи и не теряет uid, записанные параллельно', () => {
    // Процесс A сохранил uid-A.
    saveCouponCache(file, { 'uid-A': entry(now.toISOString()) });
    // Процесс B стартовал со старым снимком (пустым) и дописывает uid-B.
    saveCouponCache(file, { 'uid-B': entry(now.toISOString()) });
    const merged = loadCouponCache(file);
    // Обе записи на месте — регресс K10 (last-writer-wins терял uid-A).
    expect(Object.keys(merged).sort()).toEqual(['uid-A', 'uid-B']);
  });

  it('битый файл → пустой кэш', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{битый json');
    expect(loadCouponCache(file)).toEqual({});
  });
});
