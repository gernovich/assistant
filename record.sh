#!/usr/bin/env bash
set -euo pipefail

# Запись "микрофон + то, что слышит пользователь" в ogg/opus через PulseAudio/PipeWire-Pulse.
#
# Требования:
# - ffmpeg
# - pactl (PulseAudio / PipeWire-Pulse)
#
# Параметры (опционально):
# - DIR: каталог для файлов (по умолчанию ./recordings)
# - OUT: полный путь к файлу (если задан — DIR игнорируется)
# - MIC: имя Pulse source (если не задан — берём Default Source из pactl info)
# - MON: имя Pulse monitor source (если не задан — берём Default Sink + .monitor)
# - WEIGHTS: веса микса "MIC MON" (по умолчанию "1 1" -> одинаково громкий)

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Не найдено '$1'. Установи и попробуй снова." >&2
    exit 1
  }
}

need ffmpeg
need pactl

DIR="${DIR:-./recordings}"
WEIGHTS="${WEIGHTS:-1 1}"

if [[ -n "${OUT:-}" ]]; then
  out="$OUT"
else
  mkdir -p "$DIR"
  ts="$(date +%Y-%m-%d_%H-%M-%S)"
  out="$DIR/rec-$ts.ogg"
fi

if [[ -n "${MIC:-}" ]]; then
  mic="$MIC"
else
  mic="$(pactl info 2>/dev/null | sed -n 's/^Default Source: //p' | head -n1 | tr -d '\r')"
fi

if [[ -n "${MON:-}" ]]; then
  mon="$MON"
else
  sink="$(pactl info 2>/dev/null | sed -n 's/^Default Sink: //p' | head -n1 | tr -d '\r')"
  mon="${sink}.monitor"
fi

if [[ -z "${mic:-}" || -z "${mon:-}" || "${mon}" == ".monitor" ]]; then
  echo "Не удалось определить MIC/MON через pactl." >&2
  echo "Подсказка: посмотри 'pactl info' и 'pactl list short sources'." >&2
  exit 1
fi

echo "MIC=$mic"
echo "MON=$mon"
echo "OUT=$out"
echo "WEIGHTS=$WEIGHTS"
echo "Старт записи... (Ctrl+C чтобы остановить)"

exec ffmpeg -hide_banner -loglevel error \
  -f pulse -i "$mic" \
  -f pulse -i "$mon" \
  -filter_complex "[0:a][1:a]amix=inputs=2:weights=${WEIGHTS}:duration=longest:normalize=0" \
  -ar 48000 -ac 2 -c:a libopus -b:a 96k -application audio \
  "$out"

