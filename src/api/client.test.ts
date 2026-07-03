/**
 * Тесты REST-клиента T-Invest API: формирование запросов (URL, заголовки,
 * тело) и маппинг ошибок HTTP → AppError со стабильными кодами.
 * Сетевой слой подменяется через инъекцию fetchFn.
 */
import { describe, expect, it, vi } from 'vitest';
import { TInvestClient } from './client.js';
import { AppError } from './errors.js';

// Хелпер: клиент с фейковым fetch, возвращающим заданный ответ.
function makeClient(fetchFn: typeof fetch) {
  return new TInvestClient({ token: 't.test-token', fetchFn });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TInvestClient — формирование запроса', () => {
  it('отправляет POST на полный URL метода с Bearer-авторизацией', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ accounts: [] }));
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const res = await client.getAccounts();

    expect(res).toEqual({ accounts: [] });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe(
      'https://invest-public-api.tinkoff.ru/rest/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer t.test-token');
    expect(headers['Content-Type']).toBe('application/json');
    // GetAccounts запрашивает все счета — фильтрация по статусу на нашей стороне.
    expect(JSON.parse(String(init.body)).status).toBe('ACCOUNT_STATUS_UNSPECIFIED');
  });

  it('getPortfolio передаёт accountId и валюту ответа RUB', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ positions: [] }));
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await client.getPortfolio('2000000001');

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ accountId: '2000000001', currency: 'RUB' });
  });

  it('getLastPrices передаёт массив идентификаторов инструментов', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ lastPrices: [] }));
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await client.getLastPrices(['uid-1', 'uid-2']);

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ instrumentId: ['uid-1', 'uid-2'] });
  });
});

describe('TInvestClient — карточка инструмента', () => {
  it('getInstrumentByUid запрашивает InstrumentsService/GetInstrumentBy по UID', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ instrument: { uid: 'uid-sber', name: 'Сбер Банк', instrumentType: 'share' } }),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const res = await client.getInstrumentByUid('uid-sber');

    expect(res.instrument.name).toBe('Сбер Банк');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('InstrumentsService/GetInstrumentBy');
    expect(JSON.parse(String(init.body))).toEqual({
      idType: 'INSTRUMENT_ID_TYPE_UID',
      classCode: '',
      id: 'uid-sber',
    });
  });
});

describe('TInvestClient — песочница', () => {
  it('openSandboxAccount вызывает SandboxService/OpenSandboxAccount', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ accountId: 'sb-1' }));
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await expect(client.openSandboxAccount()).resolves.toEqual({ accountId: 'sb-1' });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('SandboxService/OpenSandboxAccount');
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it('sandboxPayIn передаёт сумму в формате MoneyValue (целые рубли)', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ balance: { currency: 'rub', units: '1000000', nano: 0 } }),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await client.sandboxPayIn('sb-1', 1000000);

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      accountId: 'sb-1',
      amount: { currency: 'rub', units: '1000000', nano: 0 },
    });
  });
});

describe('TInvestClient — маппинг ошибок', () => {
  it('401 → APP_TINVEST_UNAUTHORIZED с деталями из ответа API', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ code: 40003, message: 'authentication token is missing or invalid' }, 401),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await expect(client.getAccounts()).rejects.toMatchObject({
      code: 'APP_TINVEST_UNAUTHORIZED',
    });
  });

  it('403 → APP_TINVEST_FORBIDDEN', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ message: 'insufficient privileges' }, 403));
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await expect(client.getAccounts()).rejects.toMatchObject({ code: 'APP_TINVEST_FORBIDDEN' });
  });

  it('429 → APP_TINVEST_RATE_LIMIT', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ message: 'rate limit exceeded' }, 429));
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await expect(client.getAccounts()).rejects.toMatchObject({ code: 'APP_TINVEST_RATE_LIMIT' });
  });

  it('5xx → APP_TINVEST_SERVER_ERROR даже при не-JSON теле ответа', async () => {
    const fetchFn = vi.fn(async () => new Response('Bad Gateway', { status: 502 }));
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await expect(client.getAccounts()).rejects.toMatchObject({ code: 'APP_TINVEST_SERVER_ERROR' });
  });

  it('сетевая ошибка (fetch отклонён) → APP_TINVEST_NETWORK', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const err = await client.getAccounts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_NETWORK');
  });

  it('не-JSON тело при успешном 200 → APP_TINVEST_BAD_RESPONSE, не сырой SyntaxError (K11)', async () => {
    // Прокси/captive portal/TLS-перехват может вернуть HTTP 200 с HTML.
    const fetchFn = vi.fn(async () => new Response('<html>portal</html>', { status: 200 }));
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const err = await client.getAccounts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_BAD_RESPONSE');
  });

  it('4xx с сообщением сервера доносит причину отказа в userMessage (K48)', async () => {
    // Отказ брокера (например, недостаточно средств) должен быть виден без DEBUG.
    const fetchFn = vi.fn(async () =>
      jsonResponse({ code: 30042, message: 'недостаточно средств для сделки' }, 400),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const err = await client.call('OrdersService/PostOrder', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_REQUEST_FAILED');
    expect((err as AppError).userMessage).toContain('недостаточно средств');
  });
});
