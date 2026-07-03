/**
 * Конфигурация CLI: режимы работы, константы проекта и разрешение секретов.
 *
 * Экспорты:
 * - TInvestMode — 'sandbox' | 'readonly' | 'full';
 * - T_INVEST_MODES — список режимов, TOKEN_ENV_VARS — имя env-переменной токена
 *   для каждого режима;
 * - T_INVEST_BASE_URL / T_INVEST_SANDBOX_BASE_URL — REST-шлюзы контуров;
 * - REQUEST_TIMEOUT_MS, MS_PER_DAY, MS_PER_YEAR, DEFAULT_OPERATIONS_DAYS,
 *   DEFAULT_SANDBOX_PAYIN_RUB, MAX_SANDBOX_PAYIN_RUB — числовые константы;
 * - GLOBAL_ENV_PATH — путь к глобальному .env;
 * - parseMode(raw) — валидация значения --mode;
 * - baseUrlForMode(mode) — выбор контура API;
 * - tokenAvailability(env) — какие режимы обеспечены токенами;
 * - hasAnyToken(env) — есть ли хоть один заполненный токен;
 * - resolveModeAndToken(env, explicitMode?) — выбор режима и токена, fail-fast;
 * - TRADING_ENABLE_ENV_VAR, STONKS_MODE_ENV_VAR — имена env-флагов торговли;
 * - TradingGate, resolveTradingGate(env) — гейт реальных сделок из окружения.
 *
 * Политика: в .env хранятся секреты (токены) и environment-specific флаги
 * (разрешение реальных сделок для данного окружения). Остальные параметры —
 * именованные константы здесь, а не переменные окружения.
 */
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../api/errors.js';

export type TInvestMode = 'sandbox' | 'readonly' | 'full';

export const T_INVEST_MODES: readonly TInvestMode[] = ['sandbox', 'readonly', 'full'];

// Каждый режим работает под собственным токеном — так случайно не перепутать
// песочницу с боевым счётом, а «только чтение» — с полным доступом.
export const TOKEN_ENV_VARS: Record<TInvestMode, string> = {
  sandbox: 'T_INVEST_TOKEN_SANDBOX',
  readonly: 'T_INVEST_TOKEN_READONLY',
  full: 'T_INVEST_TOKEN_FULL',
};

// Флаги-разрешения реальных сделок (environment-specific capability, живут
// в .env рядом с full-токеном). Гейт денег вынесен из сессии в окружение:
// само наличие full-токена НЕ даёт торговать — нужен явный флаг деплоя.
// - ALLOW_TRADING: разрешить реальные сделки (каждая — с подтверждением --confirm);
// - STONKS_MODE: разрешить сделки БЕЗ подтверждений (полностью автономно, опасно);
//   stonks подразумевает allow-trading.
export const TRADING_ENABLE_ENV_VAR = 'T_INVEST_ALLOW_TRADING';
export const STONKS_MODE_ENV_VAR = 'T_INVEST_STONKS_MODE';

// Значения, которые считаем «включено» для булевых env-флагов. Явный список,
// чтобы опечатка вроде «T_INVEST_ALLOW_TRADING=maybe» трактовалась как «выкл»,
// а не случайно открывала реальные сделки.
const TRUTHY_FLAG_VALUES: readonly string[] = ['true', '1', 'yes', 'on'];

// Используем действующие официальные хосты tinkoff.ru: канонические адреса
// tbank.ru из документации недоступны из этого окружения (TLS-перехват на
// уровне сети — self-signed сертификат в цепочке), проверено 2026-07-02.
export const T_INVEST_BASE_URL = 'https://invest-public-api.tinkoff.ru/rest';
export const T_INVEST_SANDBOX_BASE_URL = 'https://sandbox-invest-public-api.tinkoff.ru/rest';

export const REQUEST_TIMEOUT_MS = 30_000;

// Единицы времени в миллисекундах — единый источник для всех расчётов дат
// и доходностей (не дублировать по командам). MS_PER_YEAR по конвенции ACT/365
// (год = 365 дней) — стандарт котирования доходности на МосБирже; та же
// конвенция обязана использоваться и в YTM облигаций, и в XIRR портфеля,
// иначе доходности из разных команд перестают быть сопоставимыми.
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const MS_PER_YEAR = 365 * MS_PER_DAY;

export const DEFAULT_OPERATIONS_DAYS = 30;

// Курсорная пагинация операций: размер страницы (максимум API — 1000)
// и потолок страниц — защита от бесконечного цикла при сбое курсора.
export const OPERATIONS_PAGE_LIMIT = 1000;
export const MAX_OPERATIONS_PAGES = 100;

// Пополнение песочницы: значение по умолчанию и лимит API (30 млн ₽ на счёт).
export const DEFAULT_SANDBOX_PAYIN_RUB = 1_000_000;
export const MAX_SANDBOX_PAYIN_RUB = 30_000_000;

// Единственный канонический путь к секретам. CLI читает .env ТОЛЬКО отсюда
// (не из cwd) — детерминированно, независимо от того, из какой папки запущен
// скилл; иначе случайный ./.env в рабочей директории мог бы тихо перекрыть
// или скрыть настроенные токены.
export const GLOBAL_ENV_PATH = path.join(os.homedir(), '.config', 'tinvest', '.env');

// Журнал торговых мутаций: каждая сделка/отмена дописывается сюда, чтобы
// пользователь видел, что именно делал агент (доверие + разбор полётов).
export const TRADES_LOG_PATH = path.join(os.homedir(), '.config', 'tinvest', 'trades.log');

// Порог спреда для рыночных заявок (% к середине стакана). Шире порога —
// рыночная заявка блокируется (неликвид: исполнение может быть сильно хуже),
// требуется лимитная. Порог — тюнинг-параметр, поэтому в конфиге, не в .env.
export const MARKET_ORDER_MAX_SPREAD_PERCENT = 1;

// Кэш справочников инструментов (списки Bonds/Shares/Etfs — мегабайты данных,
// меняются редко). Файлы не секретны, но живут рядом с конфигом CLI.
export const CATALOG_CACHE_DIR = path.join(os.homedir(), '.config', 'tinvest', 'cache');
export const CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // сутки — справочники стабильны

// Пакетные обращения к API: щадящие лимиты, чтобы не ловить 429
// (унарные лимиты T-Invest API — порядка 200–300 запросов в минуту на сервис).
export const BATCH_CONCURRENCY = 4;
export const BATCH_MIN_INTERVAL_MS = 250;

// Порог концентрации позиции в портфеле: доля выше — предупреждение о риске.
export const CONCENTRATION_WARN_PERCENT = 20;

// Горизонт календаря пассивного дохода (income) — год вперёд.
export const INCOME_HORIZON_DAYS = 365;

// Порог «экстремального» XIRR: выше по модулю — предупреждение о том,
// что money-weighted ставка не соответствует интуиции «доходность за год».
export const EXTREME_XIRR_WARN_PERCENT = 100;

// Лимиты глубины одного запроса GetCandles по интервалам (дни) и период
// команды history по умолчанию.
export const DEFAULT_HISTORY_DAYS = 365;
export const CANDLES_HOUR_MAX_DAYS = 3;
export const CANDLES_DAY_MAX_DAYS = 366;
export const CANDLES_WEEK_MAX_DAYS = 730;
export const CANDLES_MONTH_MAX_DAYS = 3650;

// Аннуализация волатильности по интервалам свечей.
export const TRADING_DAYS_PER_YEAR = 252;
export const WEEKS_PER_YEAR = 52;
export const MONTHS_PER_YEAR = 12;

// Стакан: глубина по умолчанию (максимум API — 50).
export const ORDERBOOK_DEPTH_DEFAULT = 10;
export const ORDERBOOK_DEPTH_MAX = 50;

// Скринеры: размеры выдачи, потолок кандидатов для расчёта YTM (каждый
// кандидат — запрос графика купонов), TTL кэша купонов и размеры батчей.
export const SCREEN_TOP_DEFAULT = 15;
export const SCREEN_BONDS_MAX_CANDIDATES = 150;
export const COUPON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // неделя
export const LAST_PRICES_CHUNK = 300;
export const FUNDAMENTALS_CHUNK = 100; // лимит GetAssetFundamentals на запрос

// Новости: размер выдачи по умолчанию; для клиентской фильтрации по бумаге —
// размер страницы ленты и потолок просматриваемых страниц.
export const NEWS_DEFAULT_LIMIT = 15;
export const NEWS_PAGE_LIMIT = 100;
export const NEWS_FILTER_MAX_PAGES = 5;

// Сделки инсайдеров и сигналы стратегий: размеры выдачи по умолчанию.
export const INSIDERS_DEFAULT_LIMIT = 20;
export const SIGNALS_DEFAULT_LIMIT = 30;

// Календарь отчётностей: окно назад и вперёд от текущей даты.
export const REPORTS_WINDOW_DAYS = 183;

// Технические индикаторы (tech): стандартные периоды и пороги RSI.
export const TECH_LOOKBACK_DAYS = 180;
export const RSI_LENGTH = 14;
export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;
export const SMA_FAST_LENGTH = 20;
export const SMA_SLOW_LENGTH = 50;
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const MACD_SIGNAL = 9;

export function parseMode(raw: string): TInvestMode {
  if ((T_INVEST_MODES as readonly string[]).includes(raw)) {
    return raw as TInvestMode;
  }
  throw new AppError({
    code: 'APP_CLI_INVALID_ARGUMENT',
    userMessage: `Неизвестный режим «${raw}». Допустимые значения --mode: sandbox, readonly, full.`,
  });
}

export function baseUrlForMode(mode: TInvestMode): string {
  // Песочница — отдельный контур API; readonly/full различаются только токеном.
  return mode === 'sandbox' ? T_INVEST_SANDBOX_BASE_URL : T_INVEST_BASE_URL;
}

export function tokenAvailability(
  env: Record<string, string | undefined>,
): Record<TInvestMode, boolean> {
  // «Живой» список режимов для скилла: перед вопросом пользователю агент
  // видит, какие режимы реально обеспечены токенами.
  return Object.fromEntries(
    T_INVEST_MODES.map((mode) => [mode, Boolean(env[TOKEN_ENV_VARS[mode]]?.trim())]),
  ) as Record<TInvestMode, boolean>;
}

export function hasAnyToken(env: Record<string, string | undefined>): boolean {
  return Object.values(tokenAvailability(env)).some(Boolean);
}

export function resolveModeAndToken(
  env: Record<string, string | undefined>,
  explicitMode?: TInvestMode,
): { mode: TInvestMode; token: string } {
  // Явный --mode: используем ровно его токен, без подстановок из других режимов.
  if (explicitMode) {
    const envVar = TOKEN_ENV_VARS[explicitMode];
    const token = env[envVar]?.trim();
    if (!token) {
      throw new AppError({
        code: 'APP_TINVEST_TOKEN_MISSING',
        userMessage:
          `Для режима «${explicitMode}» не задан токен: заполните ${envVar} в файле .env проекта ` +
          `или в ${GLOBAL_ENV_PATH}. Выпустить токен можно в настройках Т-Инвестиций ` +
          '(раздел «Токены T-Invest API»).',
      });
    }
    return { mode: explicitMode, token };
  }

  // Без --mode: режим определяется однозначно только если заполнен ровно
  // один токен. Несколько токенов — не угадываем, требуем явный выбор.
  const available = T_INVEST_MODES.filter((mode) => Boolean(env[TOKEN_ENV_VARS[mode]]?.trim()));
  const single = available[0];
  if (available.length === 1 && single) {
    return { mode: single, token: env[TOKEN_ENV_VARS[single]]!.trim() };
  }
  if (available.length === 0) {
    throw new AppError({
      code: 'APP_TINVEST_TOKEN_MISSING',
      userMessage:
        'Не задан ни один токен T-Invest API. Заполните хотя бы одну из переменных ' +
        `${Object.values(TOKEN_ENV_VARS).join(' / ')} в файле .env проекта или в ${GLOBAL_ENV_PATH}. ` +
        'Токены выпускаются в настройках Т-Инвестиций (раздел «Токены T-Invest API»).',
    });
  }
  throw new AppError({
    code: 'APP_TINVEST_MODE_AMBIGUOUS',
    userMessage:
      `Настроено несколько токенов (режимы: ${available.join(', ')}). ` +
      'Укажите режим явно: --mode sandbox | readonly | full.',
  });
}

// Гейт реальных сделок, вычисленный из окружения. Разнесён с выбором режима:
// режим (readonly/sandbox/full) отвечает на «куда смотрим», а гейт — на
// «можно ли трогать реальные деньги и нужно ли подтверждение на каждую сделку».
export interface TradingGate {
  // Разрешены ли реальные сделки в full вообще (иначе full — только чтение).
  allowTrading: boolean;
  // Разрешены ли сделки без --confirm (автономный режим). Подразумевает allowTrading.
  stonksMode: boolean;
}

// Мягкий разбор булева env-флага: пустое/отсутствующее → false (безопасный
// дефолт — «выключено»). Это не запрещённый fallback скрытия данных: флаги —
// осознанный opt-in, отсутствие которого штатно означает «капабилити выключена».
function parseBooleanFlag(raw: string | undefined): boolean {
  return TRUTHY_FLAG_VALUES.includes((raw ?? '').trim().toLowerCase());
}

export function resolveTradingGate(env: Record<string, string | undefined>): TradingGate {
  // stonks — более сильный флаг: включает и торговлю, и автономность.
  const stonksMode = parseBooleanFlag(env[STONKS_MODE_ENV_VAR]);
  const allowTrading = stonksMode || parseBooleanFlag(env[TRADING_ENABLE_ENV_VAR]);
  return { allowTrading, stonksMode };
}
