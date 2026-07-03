/**
 * Тесты хелперов направления сделки. Ключевое: неизвестное/отсутствующее
 * значение direction из ответа API даёт null (а не выдуманное 'buy').
 */
import { describe, expect, it } from 'vitest';
import {
  DASH,
} from './values.js';
import {
  directionFromApi,
  directionLabel,
  directionPhrase,
  orderDirectionToApi,
  stopDirectionToApi,
} from './direction.js';

describe('*DirectionToApi', () => {
  it('маппит buy/sell в enum заявки', () => {
    expect(orderDirectionToApi('buy')).toBe('ORDER_DIRECTION_BUY');
    expect(orderDirectionToApi('sell')).toBe('ORDER_DIRECTION_SELL');
  });

  it('маппит buy/sell в enum стоп-заявки', () => {
    expect(stopDirectionToApi('buy')).toBe('STOP_ORDER_DIRECTION_BUY');
    expect(stopDirectionToApi('sell')).toBe('STOP_ORDER_DIRECTION_SELL');
  });
});

describe('directionFromApi', () => {
  it('распознаёт enum заявок и стоп-заявок', () => {
    expect(directionFromApi('ORDER_DIRECTION_BUY')).toBe('buy');
    expect(directionFromApi('ORDER_DIRECTION_SELL')).toBe('sell');
    expect(directionFromApi('STOP_ORDER_DIRECTION_BUY')).toBe('buy');
    expect(directionFromApi('STOP_ORDER_DIRECTION_SELL')).toBe('sell');
  });

  it('для отсутствующего/неизвестного значения возвращает null, а не buy', () => {
    // Регресс K19: protobuf опускает незаполненный direction — нельзя
    // рапортовать продажу как покупку.
    expect(directionFromApi(undefined)).toBeNull();
    expect(directionFromApi('')).toBeNull();
    expect(directionFromApi('ORDER_DIRECTION_UNSPECIFIED')).toBeNull();
  });
});

describe('directionLabel / directionPhrase', () => {
  it('русские подписи', () => {
    expect(directionLabel('buy')).toBe('покупка');
    expect(directionLabel('sell')).toBe('продажа');
    expect(directionLabel(null)).toBe(DASH);
  });

  it('фразы для предложений', () => {
    expect(directionPhrase('buy')).toBe('на покупку');
    expect(directionPhrase('sell')).toBe('на продажу');
  });
});
