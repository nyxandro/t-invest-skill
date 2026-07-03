/**
 * Идентичность сессии: к чему привязано состояние активного режима.
 *
 * Агент-агностично, без привязки к процессу конкретного агента. Два слоя:
 * 1. TINVEST_SESSION_ID (env) — стабильный идентификатор, который задаёт любая
 *    обёртка (агент-фреймворк, CI, шелл). Обёртка сама владеет жизненным циклом:
 *    сменить/завершить сессию — сменить id или очистить состояние. Переживает
 *    даже per-command шеллы (у каждой команды — свежий процесс, но общий id).
 * 2. Глобальный файл (id не задан) — один активный режим на пользователя.
 *    Zero-config для типичного «один агент — одна сессия».
 *
 * Состояние активного режима — не крипто-замок и не гейт денег (реальные
 * сделки стережёт TradingGate из окружения), а «памятка: какой сейчас режим».
 * Поэтому оно и не требует привязки к живому процессу — устаревшая памятка
 * безопасна (в худшем случае readonly).
 *
 * Экспорты:
 * - SESSION_ID_ENV_VAR — имя env-переменной идентификатора;
 * - TINVEST_STATE_ROOT, SESSIONS_DIR, GLOBAL_STATE_PATH — расположение состояния;
 * - sanitizeSessionId(raw) — безопасное имя файла из произвольного id;
 * - activeModeStatePath(env) — путь к файлу активного режима для текущей идентичности.
 */
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../api/errors.js';

// Имя env-переменной, которой обёртка задаёт идентификатор своей сессии.
export const SESSION_ID_ENV_VAR = 'TINVEST_SESSION_ID';

// Корень состояния CLI (там же лежат .env и cache); файлы не секретны.
export const TINVEST_STATE_ROOT = path.join(os.homedir(), '.config', 'tinvest');

// Состояния сессий с явным id — по файлу на id (параллельные сессии с разными
// id не конфликтуют). Глобальный дефолт — один файл в корне.
export const SESSIONS_DIR = path.join(TINVEST_STATE_ROOT, 'sessions');
export const GLOBAL_STATE_PATH = path.join(TINVEST_STATE_ROOT, 'active-mode.json');

// Максимальная длина имени файла из id — с запасом ниже лимита ФС (255 байт).
const MAX_SESSION_ID_LENGTH = 128;

// Безопасное имя файла из произвольного id: оставляем только буквы/цифры/._-,
// прочее заменяем на «_». Так исключаем и обход каталога (слэши/«..» не
// доживают до имени файла), и невалидные для ФС символы.
export function sanitizeSessionId(raw: string): string {
  const sanitized = raw.trim().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, MAX_SESSION_ID_LENGTH);
  // Пустой или состоящий только из точек id дал бы опасное/непригодное имя
  // файла — это ошибка конфигурации обёртки, сообщаем явно (fail-fast).
  if (sanitized === '' || /^\.+$/.test(sanitized)) {
    throw new AppError({
      code: 'APP_TINVEST_SESSION_ID_INVALID',
      userMessage:
        `Некорректный идентификатор сессии в ${SESSION_ID_ENV_VAR}: после нормализации не осталось ` +
        'допустимых символов. Используйте буквы, цифры, точку, дефис или подчёркивание.',
    });
  }
  return sanitized;
}

// Путь к файлу активного режима для текущей идентичности: по TINVEST_SESSION_ID,
// иначе — глобальный дефолт.
export function activeModeStatePath(env: Record<string, string | undefined>): string {
  const raw = env[SESSION_ID_ENV_VAR]?.trim();
  if (raw) {
    return path.join(SESSIONS_DIR, `${sanitizeSessionId(raw)}.json`);
  }
  return GLOBAL_STATE_PATH;
}
