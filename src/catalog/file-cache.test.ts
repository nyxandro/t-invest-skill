/**
 * Тесты версионированного файлового кэша: round-trip, обработка битого файла
 * и инвалидация при смене версии схемы (защита от чтения старого формата).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVersionedCache, writeVersionedCache } from './file-cache.js';

describe('file-cache', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinvest-filecache-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('пишет и читает тело кэша (round-trip)', () => {
    const file = path.join(dir, 'c.json');
    writeVersionedCache(file, 1, { a: 1 });
    expect(readVersionedCache<{ a: number }>(file, 1, 'тест')).toEqual({ a: 1 });
  });

  it('нет файла → null без предупреждения', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(readVersionedCache(path.join(dir, 'нет.json'), 1, 'тест')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('битый JSON → предупреждение и null', () => {
    const file = path.join(dir, 'c.json');
    fs.writeFileSync(file, '{битый');
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(readVersionedCache(file, 1, 'тест')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('повреждён'));
  });

  it('иная версия схемы → null (перезагрузка после обновления CLI)', () => {
    const file = path.join(dir, 'c.json');
    writeVersionedCache(file, 1, { a: 1 });
    // Тот же файл, но читаем как схему версии 2 — старый формат не подходит.
    expect(readVersionedCache(file, 2, 'тест')).toBeNull();
  });

  it('файл старого формата без конверта → null', () => {
    const file = path.join(dir, 'c.json');
    fs.writeFileSync(file, JSON.stringify({ a: 1 })); // нет schemaVersion
    expect(readVersionedCache(file, 1, 'тест')).toBeNull();
  });
});
