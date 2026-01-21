#!/usr/bin/env bash
set -euo pipefail

# Проигрывание записи.
# Использование:
#   ./play.sh [путь_к_файлу]
# Если файл не указан — играет последнюю запись из ./recordings

pick_player() {
  if command -v mpv >/dev/null 2>&1; then
    echo "mpv"
  elif command -v ffplay >/dev/null 2>&1; then
    echo "ffplay"
  elif command -v vlc >/dev/null 2>&1; then
    echo "vlc"
  else
    echo ""
  fi
}

file="${1:-}"
if [[ -z "$file" ]]; then
  dir="${DIR:-./recordings}"
  file="$(ls -1t "$dir"/rec-*.ogg 2>/dev/null | head -n1 || true)"
fi

if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Файл для проигрывания не найден." >&2
  echo "Укажи путь: ./play.sh ./recordings/rec-YYYY-MM-DD_HH-MM-SS.ogg" >&2
  exit 1
fi

player="$(pick_player)"
if [[ -z "$player" ]]; then
  echo "Не найден плеер. Установи один из: mpv / ffplay (ffmpeg) / vlc" >&2
  exit 1
fi

echo "PLAY=$player"
echo "FILE=$file"

case "$player" in
  mpv) exec mpv "$file" ;;
  ffplay) exec ffplay -nodisp -autoexit "$file" ;;
  vlc) exec vlc "$file" ;;
  *) echo "Неизвестный плеер: $player" >&2; exit 1 ;;
esac

