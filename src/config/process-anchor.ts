/**
 * Якорь сессии: привязка замка режима к ПРОЦЕССУ запущенной сессии Claude Code.
 *
 * Идея: CLI запускается из-под процесса `claude` (цепочка предков:
 * tinvest → shell → claude → терминал). Замок, привязанный к PID и времени
 * старта этого процесса, автоматически умирает вместе с сессией: закрыл
 * сессию → процесс исчез → замок недействителен → новая сессия заново
 * спрашивает режим. Никаких TTL и ручного session end.
 *
 * Экспорты:
 * - ProcessAnchor — {pid, startTicks} (startTicks из /proc защищает от
 *   переиспользования PID после смерти процесса);
 * - ProcessProbe, systemProbe — доступ к /proc и liveness (инъекция в тестах);
 * - detectSessionAnchor(probe?) — поиск ближайшего предка-процесса claude,
 *   fallback — прямой родитель (интерактивный шелл при ручном запуске);
 * - isAnchorAlive(anchor, probe?) — жив ли процесс якоря (с проверкой
 *   времени старта, где оно известно).
 */
import fs from 'node:fs';

export interface ProcessAnchor {
  pid: number;
  startTicks: string | null; // поле 22 из /proc/<pid>/stat; null — нет /proc
}

export interface ProcessProbe {
  selfPid: number;
  readStat(pid: number): string | null;
  readCmdline(pid: number): string | null;
  isAlive(pid: number): boolean;
}

export const systemProbe: ProcessProbe = {
  selfPid: process.pid,
  readStat(pid: number): string | null {
    try {
      return fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
      return null; // нет /proc (не Linux) или процесс уже умер
    }
  },
  readCmdline(pid: number): string | null {
    try {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    } catch {
      return null;
    }
  },
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM — процесс есть, но чужой; для liveness это «жив».
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
};

// Разбор /proc/<pid>/stat: имя процесса в скобках может содержать пробелы,
// поэтому режем по ПОСЛЕДНЕЙ закрывающей скобке. После неё: state(1) ppid(2)
// ... starttime(20-я позиция в остатке).
function parseStat(stat: string): { ppid: number; startTicks: string } | null {
  const closing = stat.lastIndexOf(')');
  if (closing < 0) {
    return null;
  }
  const rest = stat.slice(closing + 2).split(' ');
  const ppid = Number(rest[1]);
  const startTicks = rest[19];
  if (!Number.isInteger(ppid) || !startTicks) {
    return null;
  }
  return { ppid, startTicks };
}

// Процесс сессии Claude Code: basename argv[0] или argv[1] равен «claude».
// Строгий матч обязателен: у transient-шеллов инструментов в cmdline
// встречается путь «.claude/shell-snapshots/...» — подстрочный поиск дал бы
// ложный якорь, умирающий после каждой команды.
function isClaudeProcess(cmdline: string | null): boolean {
  if (!cmdline) {
    return false;
  }
  const argv = cmdline.split('\0').filter(Boolean);
  return argv.slice(0, 2).some((arg) => {
    const base = arg.split('/').pop() ?? '';
    return base === 'claude' || base === 'claude.exe';
  });
}

const MAX_ANCESTOR_HOPS = 32;

export function detectSessionAnchor(probe: ProcessProbe = systemProbe): ProcessAnchor {
  // Идём вверх по цепочке предков, запоминая первого (ближайшего) claude.
  // /proc/<pid>/stat каждого процесса читаем РОВНО ОДИН раз: stat родителя,
  // прочитанный ради его startTicks, переносим в следующую итерацию.
  let pid = probe.selfPid;
  let stat = probe.readStat(pid);
  let parentAnchor: ProcessAnchor | null = null; // прямой родитель — fallback
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop += 1) {
    if (!stat) {
      break; // нет /proc — выходим на fallback ниже
    }
    const parsed = parseStat(stat);
    if (!parsed || parsed.ppid <= 1) {
      break;
    }
    // stat родителя читаем единожды: и для startTicks якоря, и как вход
    // следующей итерации цикла.
    const parentStat = probe.readStat(parsed.ppid);
    const parentParsed = parentStat ? parseStat(parentStat) : null;
    const ancestor: ProcessAnchor = {
      pid: parsed.ppid,
      startTicks: parentParsed?.startTicks ?? null,
    };
    parentAnchor ??= ancestor;
    if (isClaudeProcess(probe.readCmdline(parsed.ppid))) {
      return ancestor;
    }
    pid = parsed.ppid;
    stat = parentStat;
  }
  // Claude-предок не найден (ручной запуск из терминала, не-Linux):
  // якорь — прямой родитель; замок умрёт вместе с его шеллом.
  return parentAnchor ?? { pid: process.ppid, startTicks: null };
}

export function isAnchorAlive(anchor: ProcessAnchor, probe: ProcessProbe = systemProbe): boolean {
  // Со временем старта: PID жив И это тот же самый процесс (не reuse).
  if (anchor.startTicks !== null) {
    const stat = probe.readStat(anchor.pid);
    const parsed = stat ? parseStat(stat) : null;
    return parsed !== null && parsed.startTicks === anchor.startTicks;
  }
  return probe.isAlive(anchor.pid);
}
