/**
 * Тесты журнала сделок: детерминированная строка (пропуск пустых полей) и
 * best-effort дозапись в файл (на реальной ФС во временном каталоге).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendTradeAudit, formatAuditLine } from './audit.js';

describe('formatAuditLine', () => {
  it('собирает полную строку сделки', () => {
    const line = formatAuditLine({
      at: '2026-07-03T12:00:00.000Z',
      mode: 'full',
      action: 'sell',
      ticker: 'TPAY',
      lots: 1,
      orderType: 'market',
      price: 101.31,
      amount: 101.31,
      commission: 0,
      currency: 'rub',
      orderId: '81074178508',
      idempotencyKey: 'key-1',
      status: 'исполнена',
    });
    expect(line).toBe(
      '2026-07-03T12:00:00.000Z | full | sell TPAY x1 | market | price=101.31 | amount=101.31 rub | comm=0 | order=81074178508 | key=key-1 | исполнена',
    );
  });

  it('пропускает незаполненные поля (отмена без цены/суммы)', () => {
    const line = formatAuditLine({
      at: '2026-07-03T12:05:00.000Z',
      mode: 'full',
      action: 'cancel',
      ticker: null,
      orderId: 'ord-9',
      status: 'отменена',
    });
    expect(line).toBe('2026-07-03T12:05:00.000Z | full | cancel — | order=ord-9 | отменена');
  });
});

describe('appendTradeAudit', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinvest-audit-test-'));
    file = path.join(dir, 'sub', 'trades.log');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('создаёт каталог и дозаписывает строки', () => {
    appendTradeAudit({ at: 't1', mode: 'full', action: 'buy', ticker: 'SBER', lots: 1 }, file);
    appendTradeAudit({ at: 't2', mode: 'full', action: 'sell', ticker: 'SBER', lots: 1 }, file);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('buy SBER x1');
    expect(lines[1]).toContain('sell SBER x1');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('не бросает при невозможности записи (сделка уже исполнена)', () => {
    // Путь-файл вместо каталога делает запись невозможной — не должно падать.
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'x');
    expect(() =>
      appendTradeAudit({ at: 't', mode: 'full', action: 'buy', ticker: 'X' }, path.join(blocker, 'trades.log')),
    ).not.toThrow();
  });
});
