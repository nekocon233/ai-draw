#!/usr/bin/env bash
# Install the `aidraw` command and link the aidraw skill for Claude Code (~/.claude/skills)
# and for Codex / OpenCode (~/.agents/skills). Usage: install.sh [--dry-run | --uninstall]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL="$ROOT/skills/aidraw"
BIN="${AIDRAW_BIN:-/usr/local/bin/aidraw}"
TARGET_HOME="${AIDRAW_HOME:-$HOME}"
LINKS=("$TARGET_HOME/.agents/skills/aidraw" "$TARGET_HOME/.claude/skills/aidraw")
MARKER="tools/aidraw/aidraw.py"

mode=install
case "${1:-}" in
  "") ;;
  --dry-run) mode=dry ;;
  --uninstall) mode=uninstall ;;
  *) echo "用法: install.sh [--dry-run | --uninstall]" >&2; exit 1 ;;
esac

run() {
  if [ "$mode" = dry ]; then echo "+ $*"; else "$@"; fi
}

if [ "$mode" = uninstall ]; then
  for link in "${LINKS[@]}"; do
    if [ -L "$link" ]; then run rm "$link"; fi
  done
  if [ -f "$BIN" ] && grep -q "$MARKER" "$BIN"; then run rm "$BIN"; fi
  echo "已卸载 aidraw 命令和技能链接"
  exit 0
fi

[ -f "$SKILL/SKILL.md" ] || { echo "找不到 $SKILL/SKILL.md" >&2; exit 1; }
if [ -e "$BIN" ] && ! grep -q "$MARKER" "$BIN"; then
  echo "$BIN 已存在且不是 aidraw 的包装脚本，未覆盖" >&2
  exit 1
fi

if [ "$mode" = dry ]; then
  echo "+ write $BIN -> python3 -B $ROOT/$MARKER"
else
  printf '#!/bin/sh\nexec python3 -B "%s" "$@"\n' "$ROOT/$MARKER" > "$BIN"
  chmod 755 "$BIN"
fi

for link in "${LINKS[@]}"; do
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "跳过 $link：已有同名的真实目录" >&2
    continue
  fi
  run mkdir -p "$(dirname "$link")"
  run ln -sfn "$SKILL" "$link"
done
echo "aidraw 命令：$BIN；技能链接：${LINKS[*]}"
