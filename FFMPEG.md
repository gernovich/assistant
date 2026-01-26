# FFMPEG — запись звука (Linux Native)

Плагин использует ffmpeg как **Linux‑native бэкенд** записи, когда в настройках выбран
`recording.audioBackend = "linux_native"`. Это обход Chromium/WebAudio и стабильная запись
через PulseAudio/PipeWire‑Pulse.

## Зависимости

- `ffmpeg` — обязателен (иначе запись не стартует, показываем Notice).
- `pactl` — нужен для автодетекта источников (микрофон/monitor).

## Источники звука

Поддерживаются два входа:

- **mic** — основной микрофон (обязателен).
- **monitor** — системный звук (опционально).

Алгоритм выбора:

1. Берём `pactl info`, парсим Default Source (микрофон).
2. Формируем кандидаты для mic.
3. Для monitor используем алиасы (`@DEFAULT_MONITOR@`, `default.monitor`) и логируем список источников.

Если monitor не найден — пишем только микрофон.

## Запуск ffmpeg

Аргументы формируются политикой `linuxNativeFfmpegArgsPolicy`:

- входы `-f pulse -i <mic>` и (если есть) `-f pulse -i <monitor>`
- `-filter_complex` — граф обработки (см. ниже)
- выход #0 — файл `ogg/opus`:
  - `-c:a libopus -b:a 96k -ar 48000 -ac 2`
- выход #1 — **PCM для визуализации**, только если нужна визуализация:
  - `-f s16le -ar 8000 -ac 1 pipe:1`

## Обработка (filtergraph)

Формируется политикой `linuxNativeFilterGraphPolicy` и зависит от настройки
`recording.linuxNativeAudioProcessing`:

- `none` — без обработки, только микс.
- `normalize` — `loudnorm` + limiter.
- `voice` — EQ+denoise **только для mic**, затем нормализация.

Важно: шумодав после микса может портить системный звук, поэтому `voice` трогает только mic.

## Визуализация

Есть два канала:

1. **Основной**: PCM (stdout) → RMS → amp.
2. **Резерв**: `ebur128` в stderr → моментальный LUFS → amp.

Амплитуда сглаживается и отдаётся в `RecordingVizNormalizer`.

## Чанки и файлы

- Запись режется на чанки по `recording.chunkMinutes`.
- Каждый чанк сначала пишется во временный `tmpPath` (в `/tmp/assistant-rec-*`).
- Имя файла формируется через `recordingFilePrefixFromEventKey`, где prefix = **occurrence_key**.

## Остановка

- На стопе ffmpeg завершается, текущий tmp‑файл сохраняется в vault.
- Логи отличают “нормальный стоп” от аварийного завершения.

## Логи/диагностика

При `debug.enabled=true` пишем:

- выбранные источники mic/monitor
- `pactl info` и `pactl list short sources`
- полный набор аргументов ffmpeg
- stderr‑tail ffmpeg при завершении

## Типичные проблемы

- `ffmpeg не найден` → установить пакет.
- `pactl не найден` → monitor‑звук может не определиться.
- Тишина в визуализации → проверяем источники и stderr‑лог ffmpeg.