#!/usr/bin/env bash
#
# Установщик скилла t-invest — одной командой.
# ДЛЯ Linux / macOS / WSL (нужен bash). Нативный Windows (PowerShell) этим
# скриптом не покрывается — там ставьте вручную или через WSL.
#   curl -fsSL https://raw.githubusercontent.com/nyxandro/t-invest-skill/main/install.sh | bash
#
# Что делает:
#   1. Скачивает t-invest.skill с GitHub.
#   2. Распаковывает в каталоги скиллов ОБОИХ семейств агентов:
#        ~/.agents/skills/t-invest  — общий каталог для агентов;
#        ~/.claude/skills/t-invest  — Claude Code.
#   3. Создаёт ~/.config/tinvest/.env (готовый шаблон БЕЗ токенов), если его ещё
#      нет; существующий .env не трогает (вписанные токены остаются на месте).
#
# Токены вписываешь сам (это секрет): https://www.tbank.ru/invest/settings/
# Инструкция по выпуску токена: https://developer.tbank.ru/invest/intro/intro/token
set -euo pipefail

# --- параметры (repo/ветку можно переопределить через env для тестов) ---
REPO="${TINVEST_REPO:-nyxandro/t-invest-skill}"
REF="${TINVEST_REF:-main}"
SKILL_NAME="t-invest"
SKILL_URL="https://raw.githubusercontent.com/${REPO}/${REF}/${SKILL_NAME}.skill"
# Оба каталога скиллов: общий для прочих агентов + Claude Code.
SKILL_DIRS=("$HOME/.agents/skills" "$HOME/.claude/skills")
CONFIG_DIR="$HOME/.config/tinvest"
ENV_FILE="$CONFIG_DIR/.env"

info() { printf '%s\n' "$*"; }
die()  { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }

# --- зависимости: распаковка и загрузчик ---
command -v unzip >/dev/null 2>&1 || die "нужен unzip — установи его и повтори."
if command -v curl >/dev/null 2>&1; then
  download() { curl -fsSL -o "$1" "$2"; }
elif command -v wget >/dev/null 2>&1; then
  download() { wget -qO "$1" "$2"; }
else
  die "нужен curl или wget."
fi

# --- Node.js >= 20: сами не ставим (нужны права, можно сломать окружение) — только предупреждаем ---
if ! command -v node >/dev/null 2>&1; then
  info "⚠️  Node.js не найден. Скилл поставлю, но CLI не запустится без Node.js ≥ 20 (nodejs.org, LTS)."
elif [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  info "⚠️  Node.js ниже 20 (нужен ≥ 20). Скилл поставлю, но обнови Node, иначе CLI не запустится."
fi

# --- получаем пакет во временный каталог (удаляется на выходе) ---
# TINVEST_SKILL_FILE=<путь> — поставить из локального .skill (офлайн/для теста),
# иначе качаем с GitHub.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if [ -n "${TINVEST_SKILL_FILE:-}" ]; then
  [ -f "$TINVEST_SKILL_FILE" ] || die "локальный пакет не найден: $TINVEST_SKILL_FILE"
  cp "$TINVEST_SKILL_FILE" "$tmp/${SKILL_NAME}.skill"
  info "Использую локальный пакет: $TINVEST_SKILL_FILE"
else
  info "Скачиваю ${SKILL_NAME}.skill (${REF})…"
  download "$tmp/${SKILL_NAME}.skill" "$SKILL_URL" || die "не удалось скачать $SKILL_URL"
fi

# --- распаковка в оба каталога (чистая переустановка: старую версию сносим) ---
for dir in "${SKILL_DIRS[@]}"; do
  mkdir -p "$dir"
  rm -rf "${dir:?}/${SKILL_NAME}"
  unzip -q "$tmp/${SKILL_NAME}.skill" -d "$dir"
  info "✓ установлено: ${dir}/${SKILL_NAME}"
done

# --- конфиг: создаём ~/.config/tinvest/.env из шаблона, существующий не трогаем ---
mkdir -p "$CONFIG_DIR"
if [ -f "$ENV_FILE" ]; then
  info "• ${ENV_FILE} уже есть — не трогаю (токены на месте)."
else
  cat > "$ENV_FILE" <<'EOF'
# Токены T-Invest API. Заполни нужные режимы (лишние оставь пустыми) — это секрет,
# в чат не отправляй. Выпустить: https://www.tbank.ru/invest/settings/
# Инструкция: https://developer.tbank.ru/invest/intro/intro/token
T_INVEST_TOKEN_SANDBOX=      # песочница (виртуальный счёт)
T_INVEST_TOKEN_READONLY=     # боевой счёт, уровень «Только просмотр»
T_INVEST_TOKEN_FULL=         # боевой счёт, уровень «Торговля» (НЕ «Торговля и переводы»)

# Реальные сделки в режиме full по умолчанию ВЫКЛЮЧЕНЫ. Чтобы включить — раскомментируй:
# T_INVEST_ALLOW_TRADING=true   # разрешить сделки (каждая требует подтверждения --confirm)
# T_INVEST_STONKS_MODE=true     # ОПАСНО: сделки БЕЗ подтверждений (полностью автономно)
EOF
  chmod 600 "$ENV_FILE"
  info "✓ создан ${ENV_FILE} — впиши в него токены."
fi

info ""
info "Готово. Дальше:"
info "  1) Впиши токены в ${ENV_FILE} (ссылки — внутри файла)."
info "  2) Перезапусти сессию агента — скилл «${SKILL_NAME}» подхватится сам."
