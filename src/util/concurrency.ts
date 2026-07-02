/**
 * Ограниченный параллелизм для пакетных обращений к API.
 *
 * Экспорты:
 * - ConcurrencyOptions — настройки: concurrency (одновременные задачи),
 *   minIntervalMs (минимальный интервал между стартами — щадящий rate limit),
 *   sleepFn (инъекция для тестов);
 * - mapWithConcurrency(items, options, fn) — маппинг с пулом воркеров:
 *   порядок результатов соответствует порядку входа, первая ошибка
 *   останавливает выдачу новых задач и пробрасывается наверх (fail-fast).
 *
 * Используется командами, которым нужно много однотипных запросов
 * (календарь дохода, скринеры): T-Invest API ограничивает частоту запросов
 * по сервисам, и неконтролируемый Promise.all ловит 429.
 */

export interface ConcurrencyOptions {
  concurrency: number;
  minIntervalMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  options: ConcurrencyOptions,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const { concurrency, minIntervalMs = 0 } = options;
  const sleep = options.sleepFn ?? defaultSleep;
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(`mapWithConcurrency: concurrency должен быть положительным целым, получено ${concurrency}`);
  }
  const results = new Array<R>(items.length);

  // Общий курсор задач и «расписание стартов»: каждый воркер бронирует себе
  // слот времени (nextStartAt += minInterval) — так частота стартов равномерна
  // независимо от длительности отдельных запросов.
  let cursor = 0;
  let nextStartAt = Date.now();
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const index = cursor;
      if (index >= items.length) {
        return;
      }
      cursor += 1;
      if (minIntervalMs > 0) {
        const waitMs = nextStartAt - Date.now();
        nextStartAt = Math.max(nextStartAt, Date.now()) + minIntervalMs;
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }
      try {
        results[index] = await fn(items[index]!, index);
      } catch (err) {
        // Fail-fast: новые задачи не стартуют, ошибка уходит вызывающему коду
        // (политика no-fallbacks — частичный результат не возвращаем).
        failed = true;
        throw err;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
