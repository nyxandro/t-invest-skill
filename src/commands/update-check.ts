/**
 * Проверка новой версии скилла в репозитории — необязательное удобство,
 * встроенное в session status. Читает версию из package.json ветки main,
 * сравнивает с текущей (APP_VERSION), кэширует результат на сутки.
 *
 * Экспорты:
 * - UpdateInfo — { currentVersion, latestVersion, updateAvailable };
 * - isNewer(latest, current) — сравнение semver (a > b);
 * - checkForUpdate(deps) — проверка с кэшем; НИКОГДА не бросает: апдейт-чек не
 *   критичен, поэтому сеть/парсинг/ФС оборачиваются в тихий пропуск (это
 *   допустимая деградация «optional/UI»-значения, а не сокрытие нужных данных).
 *
 * Осознанно без выключателя в окружении: единственный внешний адрес — публичный
 * package.json на GitHub (тот же хост, что install.sh), никаких данных счёта
 * наружу не уходит.
 */
import fs from 'node:fs';
import {
  APP_VERSION,
  UPDATE_CHECK_CACHE_PATH,
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_CHECK_TTL_MS,
  UPDATE_CHECK_URL,
} from '../config/config.js';

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null; // null — узнать не удалось (офлайн/ошибка)
  updateAvailable: boolean;
}

export interface UpdateCheckDeps {
  fetchFn?: typeof fetch;
  now?: Date;
  cachePath?: string;
}

interface UpdateCache {
  checkedAt: string; // ISO
  latestVersion: string;
}

// Разбор версии «1.2.0» / «v1.2.0» в массив чисел; null при нестандартном
// формате (тогда сравнение вернёт false — без ложных уведомлений).
function parseVersion(value: string): number[] | null {
  const normalized = value.trim().replace(/^v/i, '');
  if (!/^\d+(\.\d+)*$/.test(normalized)) {
    return null;
  }
  return normalized.split('.').map(Number);
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) {
    return false;
  }
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) {
      return true;
    }
    if (x < y) {
      return false;
    }
  }
  return false; // равны
}

// Чтение кэша: тихо возвращаем null при отсутствии/битом файле — кэш чисто
// вспомогательный, его порча не должна ломать session status.
function readCache(cachePath: string): UpdateCache | null {
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UpdateCache>;
    if (typeof parsed.checkedAt === 'string' && typeof parsed.latestVersion === 'string') {
      return { checkedAt: parsed.checkedAt, latestVersion: parsed.latestVersion };
    }
    return null;
  } catch {
    return null;
  }
}

// Запись кэша best-effort: сбой (нет прав, нет каталога) не критичен.
function writeCache(cachePath: string, cache: UpdateCache): void {
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
  } catch {
    // Игнорируем: в следующий раз просто снова сходим в сеть.
  }
}

// Запрос версии из package.json ветки main. Любая ошибка (нет сети, таймаут,
// не-2xx, не-JSON, нет поля version) → null: апдейт-чек молча пропускается.
async function fetchLatestVersion(fetchFn: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchFn(UPDATE_CHECK_URL, { signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS) });
    if (!response.ok) {
      return null;
    }
    const pkg = (await response.json()) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export async function checkForUpdate(deps: UpdateCheckDeps = {}): Promise<UpdateInfo> {
  const now = deps.now ?? new Date();
  const cachePath = deps.cachePath ?? UPDATE_CHECK_CACHE_PATH;
  const fetchFn = deps.fetchFn ?? fetch;
  const current = APP_VERSION;

  // Свежий кэш (моложе суток) — не ходим в сеть на каждый session status.
  const cache = readCache(cachePath);
  const cacheFresh = cache !== null && now.getTime() - Date.parse(cache.checkedAt) < UPDATE_CHECK_TTL_MS;

  let latestVersion: string | null;
  if (cacheFresh && cache) {
    latestVersion = cache.latestVersion;
  } else {
    latestVersion = await fetchLatestVersion(fetchFn);
    if (latestVersion !== null) {
      writeCache(cachePath, { checkedAt: now.toISOString(), latestVersion });
    } else if (cache) {
      // Сеть недоступна — используем последнюю известную версию из кэша.
      latestVersion = cache.latestVersion;
    }
  }

  return {
    currentVersion: current,
    latestVersion,
    updateAvailable: latestVersion !== null && isNewer(latestVersion, current),
  };
}
