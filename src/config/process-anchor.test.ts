/**
 * Тесты якоря сессии: поиск процесса claude в цепочке предков (строгий матч
 * argv, а не подстроки), fallback на родителя, liveness с защитой от
 * переиспользования PID.
 */
import { describe, expect, it } from 'vitest';
import { detectSessionAnchor, isAnchorAlive, type ProcessProbe } from './process-anchor.js';

// Фейковое дерево процессов: pid → {ppid, startTicks, cmdline}.
interface FakeProc {
  ppid: number;
  startTicks: string;
  cmdline: string; // argv через \0
}

function makeProbe(tree: Record<number, FakeProc>, selfPid: number): ProcessProbe {
  return {
    selfPid,
    readStat(pid: number): string | null {
      const proc = tree[pid];
      if (!proc) {
        return null;
      }
      // Формат /proc/<pid>/stat: pid (comm) state ppid ... starttime на 22-й позиции.
      const tail = ['S', String(proc.ppid), '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', proc.startTicks, '0'];
      return `${pid} (comm with space) ${tail.join(' ')}`;
    },
    readCmdline(pid: number): string | null {
      return tree[pid]?.cmdline ?? null;
    },
    isAlive(pid: number): boolean {
      return pid in tree;
    },
  };
}

// Реалистичная цепочка: tinvest(100) → shell(90, в cmdline упомянут путь
// .claude/shell-snapshots — ловушка для подстрочного матча) → claude(80) → bash(70).
const tree: Record<number, FakeProc> = {
  100: { ppid: 90, startTicks: '1000', cmdline: 'node\0/x/tinvest.cjs' },
  90: { ppid: 80, startTicks: '999', cmdline: '/bin/bash\0-c\0source /home/u/.claude/shell-snapshots/snap.sh' },
  80: { ppid: 70, startTicks: '500', cmdline: 'claude' },
  70: { ppid: 1, startTicks: '10', cmdline: '/bin/bash\0-l' },
};

describe('detectSessionAnchor', () => {
  it('находит ближайшего предка-claude, игнорируя пути .claude в аргументах шелла', () => {
    const anchor = detectSessionAnchor(makeProbe(tree, 100));
    expect(anchor).toEqual({ pid: 80, startTicks: '500' });
  });

  it('без claude в предках — якорь на прямом родителе (ручной запуск)', () => {
    const manual: Record<number, FakeProc> = {
      100: { ppid: 70, startTicks: '1000', cmdline: 'node\0/x/tinvest.cjs' },
      70: { ppid: 1, startTicks: '10', cmdline: '/bin/bash\0-l' },
    };
    const anchor = detectSessionAnchor(makeProbe(manual, 100));
    expect(anchor).toEqual({ pid: 70, startTicks: '10' });
  });

  it('claude.exe (Windows/WSL interop) тоже распознаётся', () => {
    const winTree: Record<number, FakeProc> = {
      100: { ppid: 80, startTicks: '1000', cmdline: 'node\0/x/tinvest.cjs' },
      80: { ppid: 1, startTicks: '500', cmdline: 'C:\\apps\\claude.exe' },
    };
    expect(detectSessionAnchor(makeProbe(winTree, 100)).pid).toBe(80);
  });
});

describe('isAnchorAlive', () => {
  const probe = makeProbe(tree, 100);

  it('жив: pid существует и время старта совпадает', () => {
    expect(isAnchorAlive({ pid: 80, startTicks: '500' }, probe)).toBe(true);
  });

  it('мёртв: pid исчез', () => {
    expect(isAnchorAlive({ pid: 12345, startTicks: '500' }, probe)).toBe(false);
  });

  it('мёртв: pid переиспользован другим процессом (иное время старта)', () => {
    expect(isAnchorAlive({ pid: 80, startTicks: '9999' }, probe)).toBe(false);
  });

  it('без startTicks — по kill(pid, 0)', () => {
    expect(isAnchorAlive({ pid: 80, startTicks: null }, probe)).toBe(true);
    expect(isAnchorAlive({ pid: 12345, startTicks: null }, probe)).toBe(false);
  });
});
