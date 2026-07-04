/**
 * Тесты проверки обновлений: сравнение semver, тихий пропуск при сбое (не
 * бросает), поведение кэша (свежий → без сети, протухший → сеть + запись).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, isNewer } from './update-check.js';

// Временные файлы кэша — уникальные на тест, чтобы прогоны не мешали друг другу.
const tmpFiles: string[] = [];
function tmpCachePath(): string {
  const p = path.join(os.tmpdir(), `tinvest-update-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* файл мог не создаться — это нормально */
    }
  }
  tmpFiles.length = 0;
});

function jsonResponse(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

const NOW = new Date('2026-07-04T12:00:00Z');

describe('isNewer', () => {
  it('сравнивает semver и не даёт ложных срабатываний', () => {
    expect(isNewer('1.2.0', '1.1.0')).toBe(true);
    expect(isNewer('1.1.1', '1.1.0')).toBe(true);
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('v1.2.0', '1.1.0')).toBe(true); // префикс v допускается
    expect(isNewer('1.1.0', '1.1.0')).toBe(false); // равные
    expect(isNewer('1.0.9', '1.1.0')).toBe(false); // старее
    expect(isNewer('мусор', '1.1.0')).toBe(false); // неформат → без уведомления
  });
});

describe('checkForUpdate', () => {
  it('удалённая версия новее → updateAvailable', async () => {
    const info = await checkForUpdate({ fetchFn: jsonResponse({ version: '9.9.9' }), now: NOW, cachePath: tmpCachePath() });
    expect(info).toMatchObject({ latestVersion: '9.9.9', updateAvailable: true });
    expect(info.currentVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('версия равна текущей → updateAvailable=false', async () => {
    // Узнаём текущую версию из первого вызова, затем «сервер» отдаёт её же.
    const probe = await checkForUpdate({ fetchFn: jsonResponse({ version: '0.0.1' }), now: NOW, cachePath: tmpCachePath() });
    const info = await checkForUpdate({
      fetchFn: jsonResponse({ version: probe.currentVersion }),
      now: NOW,
      cachePath: tmpCachePath(),
    });
    expect(info.updateAvailable).toBe(false);
    expect(info.latestVersion).toBe(probe.currentVersion);
  });

  it('ошибка сети → тихий пропуск (latestVersion null, не бросает)', async () => {
    const fetchFn = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const info = await checkForUpdate({ fetchFn, now: NOW, cachePath: tmpCachePath() });
    expect(info).toMatchObject({ latestVersion: null, updateAvailable: false });
  });

  it('не-2xx → тихий пропуск', async () => {
    const info = await checkForUpdate({ fetchFn: jsonResponse({}, false), now: NOW, cachePath: tmpCachePath() });
    expect(info.latestVersion).toBeNull();
  });

  it('свежий кэш → сеть не дёргается', async () => {
    const cachePath = tmpCachePath();
    fs.writeFileSync(cachePath, JSON.stringify({ checkedAt: '2026-07-04T11:30:00Z', latestVersion: '9.9.9' }));
    const fetchFn = vi.fn(jsonResponse({ version: '1.0.0' }));
    const info = await checkForUpdate({ fetchFn: fetchFn as unknown as typeof fetch, now: NOW, cachePath });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(info).toMatchObject({ latestVersion: '9.9.9', updateAvailable: true });
  });

  it('протухший кэш → идём в сеть и перезаписываем кэш', async () => {
    const cachePath = tmpCachePath();
    fs.writeFileSync(cachePath, JSON.stringify({ checkedAt: '2026-07-01T00:00:00Z', latestVersion: '1.0.0' }));
    const fetchFn = vi.fn(jsonResponse({ version: '9.9.9' }));
    const info = await checkForUpdate({ fetchFn: fetchFn as unknown as typeof fetch, now: NOW, cachePath });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(info.latestVersion).toBe('9.9.9');
    expect(JSON.parse(fs.readFileSync(cachePath, 'utf8')).latestVersion).toBe('9.9.9');
  });
});
