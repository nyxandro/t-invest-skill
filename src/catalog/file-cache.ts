/**
 * Низкоуровневый дисковый кэш в JSON: атомарная запись и версионированное
 * чтение. Общая основа для кэша справочников и кэша купонов — раньше эта
 * механика (tmp+rename, обработка битого файла, проверка формата) была
 * продублирована в двух модулях с расходящимися сообщениями.
 *
 * Конверт {schemaVersion, body} защищает от чтения данных старого формата
 * после обновления CLI: при несовпадении версии запись считается непригодной
 * и вызывающий перезагружает данные из API (вместо молчаливой выдачи items
 * старой формы в течение всего TTL).
 *
 * Экспорты:
 * - readVersionedCache<T>(filePath, schemaVersion, label) — тело кэша или null
 *   (нет файла / битый / иная версия схемы);
 * - writeVersionedCache(filePath, schemaVersion, body) — атомарная запись.
 */
import fs from 'node:fs';
import path from 'node:path';

interface CacheEnvelope {
  schemaVersion: number;
  body: unknown;
}

export function readVersionedCache<T>(
  filePath: string,
  schemaVersion: number,
  label: string,
): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // Битый файл — не фатально (источник истины API), но предупреждаем.
    console.error(`Предупреждение: кэш ${label} повреждён и будет перезаписан: ${filePath}`);
    return null;
  }
  const envelope = parsed as Partial<CacheEnvelope> | null;
  // Нет конверта или иная версия схемы (в т.ч. файлы старого формата без
  // schemaVersion после обновления CLI) — молча перезагружаем из API.
  if (!envelope || typeof envelope !== 'object' || envelope.schemaVersion !== schemaVersion) {
    return null;
  }
  return envelope.body as T;
}

// Атомарная запись (tmp-<pid> + rename): параллельный CLI-процесс не прочитает
// наполовину записанный JSON, а уникальный по pid tmp исключает коллизию tmp-файлов.
export function writeVersionedCache(filePath: string, schemaVersion: number, body: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify({ schemaVersion, body } satisfies CacheEnvelope));
  fs.renameSync(tmpPath, filePath);
}
