/**
 * Текстовый рендер таблиц для вывода CLI.
 *
 * Экспорты:
 * - renderTable(headers, rows) — моноширинная таблица: колонки выровнены
 *   по самой широкой ячейке, после заголовка — строка-разделитель;
 * - truncate(text, maxWidth) — обрезка длинных ячеек с многоточием.
 */

export function truncate(text: string, maxWidth: number): string {
  // Длинные названия (особенно юридические имена облигаций) растягивают
  // таблицу на сотни символов — для терминала обрезаем, в --json текст полный.
  return text.length > maxWidth ? `${text.slice(0, maxWidth - 1)}…` : text;
}

export function renderTable(headers: string[], rows: string[][]): string {
  // Ширина каждой колонки — максимум из заголовка и всех ячеек.
  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => (row[col] ?? '').length)),
  );

  const renderRow = (cells: string[]): string =>
    widths.map((width, col) => (cells[col] ?? '').padEnd(width)).join('  ');

  const lines = [renderRow(headers), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (const row of rows) {
    lines.push(renderRow(row));
  }
  return lines.join('\n');
}
