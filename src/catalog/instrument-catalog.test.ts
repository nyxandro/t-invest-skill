/**
 * Тесты кэшируемого справочника инструментов: попадание в кэш, протухание
 * по TTL, восстановление после битого файла, разделение контуров.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BondsResponse, EtfsResponse, SharesResponse } from '../api/types-catalog.js';
import { catalogCachePath, contourForMode, loadCatalog, type CatalogApi } from './instrument-catalog.js';

const bondsFixture: BondsResponse = {
  instruments: [
    { uid: 'bond-1', ticker: 'RU000A0001', name: 'Тестовая облигация', currency: 'rub' },
  ],
};

function makeApi(): CatalogApi & { calls: Record<string, number> } {
  const calls: Record<string, number> = { bonds: 0, shares: 0, etfs: 0 };
  return {
    calls,
    async getBonds(): Promise<BondsResponse> {
      calls.bonds! += 1;
      return bondsFixture;
    },
    async getShares(): Promise<SharesResponse> {
      calls.shares! += 1;
      return { instruments: [{ uid: 'share-1', ticker: 'TEST', name: 'Тестовая акция' }] };
    },
    async getEtfs(): Promise<EtfsResponse> {
      calls.etfs! += 1;
      return { instruments: [] };
    },
  };
}

describe('loadCatalog', () => {
  let cacheDir: string;
  const now = new Date('2026-07-02T12:00:00Z');

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinvest-catalog-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('первый вызов идёт в API и пишет кэш, второй — читает кэш', async () => {
    const api = makeApi();
    const first = await loadCatalog(api, 'bonds', 'readonly', now, cacheDir);
    expect(first.fromCache).toBe(false);
    expect(first.items[0]?.ticker).toBe('RU000A0001');
    expect(api.calls.bonds).toBe(1);

    const second = await loadCatalog(api, 'bonds', 'readonly', now, cacheDir);
    expect(second.fromCache).toBe(true);
    expect(second.items).toEqual(first.items);
    expect(api.calls.bonds).toBe(1); // API повторно не вызывался
  });

  it('протухший кэш перезагружается из API', async () => {
    const api = makeApi();
    await loadCatalog(api, 'bonds', 'readonly', now, cacheDir);
    // Через 25 часов кэш (TTL сутки) обязан протухнуть.
    const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const result = await loadCatalog(api, 'bonds', 'readonly', later, cacheDir);
    expect(result.fromCache).toBe(false);
    expect(api.calls.bonds).toBe(2);
  });

  it('битый файл кэша перезаписывается с предупреждением, не роняя команду', async () => {
    const api = makeApi();
    const filePath = catalogCachePath(cacheDir, 'prod', 'bonds');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{не json');
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await loadCatalog(api, 'bonds', 'readonly', now, cacheDir);
    expect(result.fromCache).toBe(false);
    expect(api.calls.bonds).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('повреждён'));
  });

  it('песочница и боевой контур используют разные файлы кэша', async () => {
    const api = makeApi();
    await loadCatalog(api, 'bonds', 'sandbox', now, cacheDir);
    await loadCatalog(api, 'bonds', 'full', now, cacheDir);
    // Два контура — два файла и два обращения к API.
    expect(api.calls.bonds).toBe(2);
    expect(fs.existsSync(catalogCachePath(cacheDir, 'sandbox', 'bonds'))).toBe(true);
    expect(fs.existsSync(catalogCachePath(cacheDir, 'prod', 'bonds'))).toBe(true);
  });

  it('contourForMode: readonly и full делят боевой контур', () => {
    expect(contourForMode('sandbox')).toBe('sandbox');
    expect(contourForMode('readonly')).toBe('prod');
    expect(contourForMode('full')).toBe('prod');
  });
});
