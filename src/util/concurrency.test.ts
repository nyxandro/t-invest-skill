/**
 * Тесты mapWithConcurrency: порядок результатов, ограничение одновременности,
 * fail-fast при ошибке задачи.
 */
import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('сохраняет порядок результатов при параллельном выполнении', async () => {
    const items = [50, 10, 30, 5, 20];
    // Задачи с разной длительностью: результат обязан соответствовать входу.
    const results = await mapWithConcurrency(items, { concurrency: 3 }, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms * 2;
    });
    expect(results).toEqual([100, 20, 60, 10, 40]);
  });

  it('не превышает лимит одновременных задач', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], { concurrency: 2 }, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('пробрасывает первую ошибку и не начинает новые задачи после сбоя', async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], { concurrency: 1 }, async (item) => {
        started.push(item);
        if (item === 2) {
          throw new Error('boom');
        }
        return item;
      }),
    ).rejects.toThrow('boom');
    // Fail-fast: после падения на «2» очередь не продолжилась.
    expect(started).toEqual([1, 2]);
  });

  it('валидирует concurrency', async () => {
    await expect(mapWithConcurrency([1], { concurrency: 0 }, async (i) => i)).rejects.toThrow(
      /concurrency/,
    );
  });

  it('соблюдает минимальный интервал между стартами', async () => {
    const startTimes: number[] = [];
    await mapWithConcurrency([1, 2, 3], { concurrency: 3, minIntervalMs: 30 }, async () => {
      startTimes.push(Date.now());
    });
    // Три задачи с шагом 30мс: между первой и последней минимум ~60мс
    // (допуск на грануляцию таймеров).
    expect(startTimes.length).toBe(3);
    expect(Math.max(...startTimes) - Math.min(...startTimes)).toBeGreaterThanOrEqual(50);
  });
});
