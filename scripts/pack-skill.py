#!/usr/bin/env python3
"""Упаковка скилла t-invest в устанавливаемый пакет ``t-invest.skill``.

.skill — это ZIP-архив, который распаковывается в каталог скиллов Claude Code
(``unzip t-invest.skill -d ~/.claude/skills/`` → ``~/.claude/skills/t-invest/``),
поэтому все файлы кладутся под общий верхний каталог ``t-invest/``.

Собирается ТОЛЬКО рантайм скилла — то, что нужно агенту в работе:
инструкция ``SKILL.md``, самодостаточный бандл ``scripts/tinvest.cjs`` и
справочники ``references/``. Разработческие артефакты (evals, тесты) в пакет
не попадают.

Архив пишется детерминированно (фиксированная метка времени, сортировка
записей): при неизменном содержимом байты не меняются — бинарь в git не
«мигает» между релизами без реальных правок.

Запуск: ``npm run pack:skill`` (или ``python3 scripts/pack-skill.py``).
"""

import sys
import zipfile
from pathlib import Path

# Корень репозитория — родитель каталога scripts/, чтобы запуск не зависел от cwd.
REPO_ROOT = Path(__file__).resolve().parent.parent
SKILL_DIR = REPO_ROOT / "skill"
OUTPUT = REPO_ROOT / "t-invest.skill"

# Имя верхнего каталога внутри архива = имя устанавливаемого скилла.
SKILL_NAME = "t-invest"

# Что кладём в пакет (относительно skill/). Явный список, а не рекурсивный обход,
# чтобы случайные файлы (evals, временные) не утекли в релиз.
CONTENTS = [
    "SKILL.md",
    "scripts/tinvest.cjs",
    "references/json-fields.md",
]

# Фиксированная метка времени для воспроизводимости архива (год, мес, день, ...).
FIXED_TIMESTAMP = (2026, 1, 1, 0, 0, 0)


def build() -> None:
    # Fail-fast: без собранного бандла пакет неработоспособен — не молчим.
    missing = [rel for rel in CONTENTS if not (SKILL_DIR / rel).is_file()]
    if missing:
        hint = "сначала `npm run build:skill`" if "scripts/tinvest.cjs" in missing else "проверьте skill/"
        raise SystemExit(
            f"APP_PACK_SKILL_MISSING_FILES: не найдены файлы скилла: {', '.join(missing)}. "
            f"Что делать: {hint}."
        )

    OUTPUT.unlink(missing_ok=True)

    # Детерминированная запись: сортируем пути и штампуем фиксированное время.
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in sorted(CONTENTS):
            arcname = f"{SKILL_NAME}/{rel}"
            info = zipfile.ZipInfo(arcname, date_time=FIXED_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16  # обычный файл, права 644
            zf.writestr(info, (SKILL_DIR / rel).read_bytes())

    size_kb = OUTPUT.stat().st_size / 1024
    print(f"t-invest.skill собран: {len(CONTENTS)} файла, {size_kb:.1f} КБ → {OUTPUT.name}")


if __name__ == "__main__":
    try:
        build()
    except SystemExit:
        raise
    except OSError as exc:
        # Ошибку ввода-вывода доносим с контекстом, не глотаем.
        print(f"APP_PACK_SKILL_IO_ERROR: не удалось собрать пакет: {exc}", file=sys.stderr)
        raise
