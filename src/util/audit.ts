/**
 * Аудит торговых мутаций: дописывает каждую сделку/отмену в локальный журнал
 * (~/.config/tinvest/trades.log), чтобы пользователь всегда видел, что именно
 * делал агент — доверие и разбор полётов.
 *
 * Запись ведётся ПОСЛЕ успешного ответа API и является best-effort: сделка уже
 * исполнена, поэтому сбой журнала (нет прав/диска) НЕ должен ронять команду —
 * ошибку глушим в stderr (журнал — наблюдаемость, а не бизнес-данные).
 *
 * Экспорты:
 * - TradeAuditEntry — поля записи журнала;
 * - formatAuditLine(entry) — детерминированная строка (тестируется без ФС);
 * - appendTradeAudit(entry, filePath?) — дописать строку; НИКОГДА не бросает.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TRADES_LOG_PATH } from '../config/config.js';

export interface TradeAuditEntry {
  at: string; // ISO-время момента записи
  mode: string; // sandbox | full
  action: string; // buy | sell | replace | cancel | stop-set:<kind> | stop-cancel
  ticker: string | null;
  lots?: number | null;
  orderType?: string | null; // market | limit | take-profit | ...
  price?: number | null;
  amount?: number | null;
  commission?: number | null;
  currency?: string | null;
  orderId?: string | null; // серверный номер заявки
  idempotencyKey?: string | null; // ключ идемпотентности (--order-id)
  status?: string | null;
}

// Пропускаем незаполненные поля (null/undefined), чтобы строка не пестрела
// пустыми хвостами: у отмены нет цены/суммы, у заявки — есть.
function field(label: string, value: unknown): string | null {
  return value === undefined || value === null ? null : `${label}=${value}`;
}

export function formatAuditLine(e: TradeAuditEntry): string {
  const head = `${e.action} ${e.ticker ?? '—'}${e.lots != null ? ` x${e.lots}` : ''}`;
  const amount =
    e.amount != null ? `amount=${e.amount}${e.currency ? ` ${e.currency}` : ''}` : null;
  const parts = [
    e.at,
    e.mode,
    head,
    e.orderType ?? null,
    field('price', e.price),
    amount,
    field('comm', e.commission),
    field('order', e.orderId),
    field('key', e.idempotencyKey),
    e.status ?? null,
  ].filter((p): p is string => Boolean(p));
  return parts.join(' | ');
}

export function appendTradeAudit(entry: TradeAuditEntry, filePath: string = TRADES_LOG_PATH): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${formatAuditLine(entry)}\n`, { mode: 0o600 });
  } catch (err) {
    // Сделка уже прошла — падать из-за журнала нельзя. Предупреждаем и продолжаем.
    console.error(
      `Предупреждение: не удалось записать журнал сделок ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
