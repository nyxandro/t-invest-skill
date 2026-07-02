/**
 * Кэшируемый справочник инструментов: списки облигаций/акций/фондов.
 *
 * Списки — мегабайты редко меняющихся данных; тянуть их из API при каждом
 * запуске скринера дорого и медленно. Кэш лежит в ~/.config/tinvest/cache
 * (файл на контур+вид), TTL — сутки; протухший или битый кэш прозрачно
 * перезагружается из API (с предупреждением в stderr при битом файле).
 *
 * Экспорты:
 * - CatalogApi — контракт клиента (списочные методы);
 * - CatalogResult<T> — элементы + метаданные источника (кэш или API);
 * - contourForMode(mode) — ключ контура: sandbox | prod (readonly и full
 *   смотрят в один и тот же боевой справочник);
 * - loadCatalog(api, kind, mode, now, cacheDir?) — универсальная загрузка;
 * - catalogCachePath(cacheDir, contour, kind) — путь к файлу кэша.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  BondListItem,
  BondsResponse,
  CatalogKind,
  EtfListItem,
  EtfsResponse,
  ShareListItem,
  SharesResponse,
} from '../api/types-catalog.js';
import { CATALOG_CACHE_DIR, CATALOG_CACHE_TTL_MS, type TInvestMode } from '../config/config.js';

export interface CatalogApi {
  getBonds(): Promise<BondsResponse>;
  getShares(): Promise<SharesResponse>;
  getEtfs(): Promise<EtfsResponse>;
}

// Элементы справочника по виду — для типобезопасных вызовов loadCatalog.
export interface CatalogItemByKind {
  bonds: BondListItem;
  shares: ShareListItem;
  etfs: EtfListItem;
}

export interface CatalogResult<K extends CatalogKind> {
  items: CatalogItemByKind[K][];
  fromCache: boolean;
  savedAt: string; // когда данные были получены из API (ISO)
}

// Формат файла кэша: метка времени + элементы, ничего лишнего.
interface CatalogCacheFile {
  savedAt: string;
  items: unknown[];
}

export function contourForMode(mode: TInvestMode): 'sandbox' | 'prod' {
  // Справочники различаются только контуром API: readonly/full — один боевой.
  return mode === 'sandbox' ? 'sandbox' : 'prod';
}

export function catalogCachePath(cacheDir: string, contour: string, kind: CatalogKind): string {
  return path.join(cacheDir, `catalog-${contour}-${kind}.json`);
}

// Чтение кэша: null, если файла нет, он битый или протух. Битый файл — не
// фатальная ошибка (это кэш, источник истины — API), но предупреждаем.
function readFreshCache(filePath: string, now: Date): CatalogCacheFile | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    console.error(`Предупреждение: файл кэша справочника повреждён и будет перезаписан: ${filePath}`);
    return null;
  }
  const cache = parsed as Partial<CatalogCacheFile>;
  if (typeof cache.savedAt !== 'string' || !Array.isArray(cache.items)) {
    console.error(`Предупреждение: файл кэша справочника имеет неверный формат и будет перезаписан: ${filePath}`);
    return null;
  }
  const age = now.getTime() - Date.parse(cache.savedAt);
  if (!(age >= 0) || age > CATALOG_CACHE_TTL_MS) {
    return null; // протух (или битая метка времени) — перезагружаем из API
  }
  return cache as CatalogCacheFile;
}

// Атомарная запись кэша: во временный файл + rename, чтобы параллельный
// запуск CLI не прочитал наполовину записанный JSON.
function writeCache(filePath: string, cache: CatalogCacheFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache));
  fs.renameSync(tmpPath, filePath);
}

async function fetchCatalog<K extends CatalogKind>(
  api: CatalogApi,
  kind: K,
): Promise<CatalogItemByKind[K][]> {
  // Выбор метода по виду справочника — единственная точка связи вид → API.
  if (kind === 'bonds') {
    return (await api.getBonds()).instruments as CatalogItemByKind[K][];
  }
  if (kind === 'shares') {
    return (await api.getShares()).instruments as CatalogItemByKind[K][];
  }
  return (await api.getEtfs()).instruments as CatalogItemByKind[K][];
}

export async function loadCatalog<K extends CatalogKind>(
  api: CatalogApi,
  kind: K,
  mode: TInvestMode,
  now: Date,
  cacheDir: string = CATALOG_CACHE_DIR,
): Promise<CatalogResult<K>> {
  const filePath = catalogCachePath(cacheDir, contourForMode(mode), kind);
  const cached = readFreshCache(filePath, now);
  if (cached) {
    return { items: cached.items as CatalogItemByKind[K][], fromCache: true, savedAt: cached.savedAt };
  }
  // Кэша нет или он непригоден: источник истины — API; ошибки API не глотаем.
  const items = await fetchCatalog(api, kind);
  const savedAt = now.toISOString();
  writeCache(filePath, { savedAt, items });
  return { items, fromCache: false, savedAt };
}
