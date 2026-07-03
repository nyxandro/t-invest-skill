/**
 * ASCII-графики для вывода CLI: брайль-линия (ряд значений во времени) и
 * горизонтальные бары (распределения, сравнения, рейтинги).
 *
 * Рендер полностью детерминированный и не зависит от времени/случайности —
 * это единственный источник графиков, которые агент вставляет в ответ
 * ДОСЛОВНО (модель график руками не рисует). Все графики монохромны: знак и
 * цветовую индикацию (+/−, 💹/🔻) несёт окружающий текст, а не сам график.
 *
 * Экспорты:
 * - BrailleChartOptions — параметры линии (размер области, формат оси Y);
 * - brailleLineChart(values, options?) — линия из точечных символов Брайля с осью Y;
 * - BarChartItem, BarChartOptions — элемент и параметры барового графика;
 * - barChart(items, options?) — горизонтальные бары с подписями и значениями.
 */
import { truncate } from './table.js';

// Базовый код блока символов Брайля (U+2800): прибавляя к нему битовую маску
// из восьми точек, получаем символ 2×4-сетки точек в одной ячейке терминала.
const BRAILLE_BASE = 0x2800;

// Карта точек Брайля [строка 0..3][столбец 0..1] → бит в символе. Нумерация
// точек Брайля нелинейна (левый столбец — точки 1,2,3,7; правый — 4,5,6,8),
// поэтому веса битов заданы явной матрицей, а не формулой.
const DOT_MATRIX: readonly (readonly number[])[] = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];
const DOTS_PER_CELL_X = 2; // точек по горизонтали в одной ячейке Брайля
const DOTS_PER_CELL_Y = 4; // точек по вертикали в одной ячейке Брайля

// Размеры графиков по умолчанию (в ЯЧЕЙКАХ терминала, не в точках/символах).
const DEFAULT_LINE_WIDTH = 52; // ширина линии в ячейках → ×2 точки по горизонтали
const DEFAULT_LINE_HEIGHT = 8; // высота линии в ячейках → ×4 точки по вертикали
const DEFAULT_BAR_WIDTH = 28; // максимальная длина бара в символах «█»
const MAX_BAR_LABEL_WIDTH = 14; // предел ширины колонки подписи бара
const DEFAULT_LINE_FRACTION_DIGITS = 2; // точность подписей оси Y по умолчанию

// Символы каркаса графиков.
const AXIS = '│';
const BAR_FULL = '█';

// Сообщения о невозможности построить график — UI-текст, а не подмена данных:
// по политике no-fallbacks число не выдумываем, честно сообщаем причину.
const MSG_LINE_NO_DATA = 'График недоступен: недостаточно точек данных.';
const MSG_BARS_NO_DATA = 'График недоступен: нет данных.';

export interface BrailleChartOptions {
  width?: number; // ширина области графика в ячейках
  height?: number; // высота области графика в ячейках
  formatValue?: (value: number) => string; // формат подписей оси Y (min/max)
}

// Линия из точечных символов Брайля: разрешение 2×4 точки на ячейку даёт
// плотную кривую в обычном моноширинном тексте. Слева — ось Y с подписями
// минимума и максимума ряда.
export function brailleLineChart(values: number[], options: BrailleChartOptions = {}): string {
  const width = options.width ?? DEFAULT_LINE_WIDTH;
  const height = options.height ?? DEFAULT_LINE_HEIGHT;
  const formatValue = options.formatValue ?? ((value: number) => value.toFixed(DEFAULT_LINE_FRACTION_DIGITS));

  // Берём только конечные числа: точка без цены (null → NaN, ±Infinity) не должна
  // искажать масштаб. Линию строим лишь при двух и более точках.
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length < 2) {
    return MSG_LINE_NO_DATA;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const cols = width * DOTS_PER_CELL_X;
  const rows = height * DOTS_PER_CELL_Y;

  // Ресемплинг ряда в cols точечных столбцов с линейной интерполяцией: ширина
  // графика фиксирована независимо от длины ряда (7 свечей или 700). Плоский ряд
  // (span=0) кладём по центру — так исключаем деление на ноль без выдумывания данных.
  const dotYs: number[] = [];
  for (let x = 0; x < cols; x += 1) {
    const position = (x / (cols - 1)) * (points.length - 1);
    const i0 = Math.floor(position);
    const i1 = Math.min(i0 + 1, points.length - 1);
    const value = points[i0]! + (points[i1]! - points[i0]!) * (position - i0);
    dotYs.push(span === 0 ? (rows - 1) / 2 : ((value - min) / span) * (rows - 1));
  }

  // Растеризация в сетку ячеек. Точка задаётся координатой (dotX слева-направо,
  // dotYFromBottom снизу-вверх) и включает нужный бит своей ячейки. Соседние точки
  // соединяем вертикальной заливкой, чтобы кривая была непрерывной, а не пунктиром.
  const grid: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(0));
  const setDot = (dotX: number, dotYFromBottom: number): void => {
    const rowFromTop = rows - 1 - Math.round(dotYFromBottom);
    const cellY = Math.floor(rowFromTop / DOTS_PER_CELL_Y);
    const cellX = Math.floor(dotX / DOTS_PER_CELL_X);
    if (cellY < 0 || cellY >= height || cellX < 0 || cellX >= width) {
      return;
    }
    const rowArr = grid[cellY]!;
    const bit = DOT_MATRIX[rowFromTop % DOTS_PER_CELL_Y]![dotX % DOTS_PER_CELL_X]!;
    rowArr[cellX] = (rowArr[cellX] ?? 0) | bit;
  };
  for (let x = 0; x < cols; x += 1) {
    if (x === 0) {
      setDot(x, dotYs[0]!);
      continue;
    }
    const lo = Math.min(dotYs[x - 1]!, dotYs[x]!);
    const hi = Math.max(dotYs[x - 1]!, dotYs[x]!);
    for (let y = Math.round(lo); y <= Math.round(hi); y += 1) {
      setDot(x, y);
    }
  }

  // Подписи оси Y: максимум у верхней строки, минимум у нижней; ширина колонки
  // подписей — по самой длинной из двух, чтобы вертикальная ось «│» стояла ровно.
  const topLabel = formatValue(max);
  const bottomLabel = formatValue(min);
  const labelWidth = Math.max(topLabel.length, bottomLabel.length);
  return grid
    .map((row, index) => {
      const label = index === 0 ? topLabel : index === height - 1 ? bottomLabel : '';
      const cells = row.map((mask) => String.fromCharCode(BRAILLE_BASE + mask)).join('');
      return `${label.padStart(labelWidth)} ${AXIS}${cells}`;
    })
    .join('\n');
}

export interface BarChartItem {
  label: string; // подпись слева (тикер, сектор, месяц)
  value: number; // величина; длина бара ∝ |value|, знак несёт note
  note: string; // готовый текст справа (сумма/процент со знаком и эмодзи)
}

export interface BarChartOptions {
  width?: number; // максимальная длина бара в символах
  labelWidth?: number; // фиксированная ширина колонки подписи
}

// Горизонтальные бары: длина ∝ модулю значения, справа — готовая подпись value.
// Общий масштаб набора (по максимальному модулю) сохраняет пропорции между
// строками — видно, что больше и во сколько раз.
export function barChart(items: BarChartItem[], options: BarChartOptions = {}): string {
  if (items.length === 0) {
    return MSG_BARS_NO_DATA;
  }
  const barWidth = options.width ?? DEFAULT_BAR_WIDTH;
  const labelWidth =
    options.labelWidth ??
    Math.min(MAX_BAR_LABEL_WIDTH, Math.max(...items.map((item) => item.label.length)));

  // Масштаб — по максимальному модулю значения: доли (0..100), суммы и P/L со
  // знаком отображаются длиной по модулю в едином масштабе набора.
  const maxAbs = Math.max(...items.map((item) => Math.abs(item.value)), 0);
  return items
    .map((item) => {
      const scaled = maxAbs === 0 ? 0 : Math.round((Math.abs(item.value) / maxAbs) * barWidth);
      // Ненулевое, но крошечное значение получает минимум один символ, иначе
      // реальная позиция «исчезает» из графика и вводит в заблуждение.
      const length = item.value !== 0 && scaled === 0 ? 1 : scaled;
      const bar = BAR_FULL.repeat(length).padEnd(barWidth);
      const label = truncate(item.label, labelWidth).padEnd(labelWidth);
      return `${label} ${bar} ${item.note}`;
    })
    .join('\n');
}
