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

- входы #0 `-f pulse -i <mic>` 
- если есть #1 `-f pulse -i <monitor>`
- граф обработки `-filter_complex`
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

Амплитуда считается и отдаётся в `RecordingVizNormalizer`.

## Предлагаемая схема (минимальная задержка)

Цель: визуализацию брать **до нормализации**, чтобы `loudnorm` не добавлял лаг.

Входы:

- in #0: `-f pulse -i <mic>`
- in #1 (опционально): `-f pulse -i <monitor>`

Граф (идея):

- `[0:a]` и `[1:a]` → подготовка формата → `amix` = `mix`
- `mix` → **ветка viz** (без нормализации):
  - либо PCM `pipe:1` для RMS,
  - либо `ebur128` (stderr) как fallback
- `mix` → **ветка записи**:
  - `loudnorm` (если включена) + limiter
  - выход в файл (ogg/opus)

Технически это укладывается в `filter_complex` с `asplit`:

- `mix` → `asplit` на `[viz]` и `[rec]`
- `[viz]` → `aresample=8000` → `pipe:1` **или** `ebur128`
- `[rec]` → `loudnorm` → `[out]` → файл

## Контроль завершения записи (прогресс/размер)

Можно добавить третий “канал” метрик через `-progress pipe:2`:

- ffmpeg пишет `key=value` (например `out_time_ms`, `total_size`) в stderr/pipe,
- это даёт надёжный сигнал, что файл дописывается и когда закончилась запись.

## Чанки и файлы

- Запись режется на чанки по `recording.chunkMinutes`.
- Каждый чанк сначала пишется во временный `tmpPath` (в `/tmp/assistant-rec-*`).
- Имя файла формируется через `recordingFilePrefixFromEventKey`, где prefix = **occurrence_key**.

## Остановка

- Корректный способ: отправить `q` в stdin и **подождать выхода процесса**.
- `SIGINT` используем только как fallback по таймауту.
- `SIGKILL` — только если процесс завис (после ожидания), иначе возможна потеря хвоста.
- Логи отличают “нормальный стоп” от аварийного завершения.

## Тестовый стенд (bash)

Чтобы проверить теорию до внедрения в плагин, используем готовый стенд:

- Скрипт: `scripts/ffmpeg-stand.sh`
- Работает на bash и не требует кода плагина.

Прогресс теста (в консоли):

- уровень (LUFS) из `ebur128` ветки
- индикатор записи (out_time_ms/total_size) из `-progress pipe:2`

Примеры:

```bash
# только mic, без нормализации (минимальная задержка)
./scripts/ffmpeg-stand.sh "default" "" /tmp/stand.ogg

# mic + monitor, с нормализацией
PROCESSING=normalize ./scripts/ffmpeg-stand.sh "default" "default.monitor" /tmp/stand.ogg
```

PHP‑вариант (если bash неудобен):

```bash
php scripts/ffmpeg-stand.php "default" "" /tmp/stand.ogg
PROCESSING=normalize php scripts/ffmpeg-stand.php "default" "default.monitor" /tmp/stand.ogg
```

Сценарий по шагам:

1) Старт записи → проверяем lag виз/таймингов.
2) Нажимаем любую клавишу → отправляем `q` и ждём корректного завершения.
3) Сравниваем длительность файла с `out_time_ms`.
4) Включаем `PROCESSING=normalize` → оцениваем прирост задержки.

## Логи/диагностика

При `debug.enabled=true` пишем:

- выбранные источники mic/monitor
- `pactl info` и `pactl list short sources`
- полный набор аргументов ffmpeg
- stderr‑tail ffmpeg при завершении

## Найденные проблемы

- Записываю звук, в диалоге вижу тайминг 14 секунд, остановил запись слушаю, там первые 4 секунды, дальше обрезанно или не записалось.
- Визуаплизация как будто с задержкой на секунд 10.
- Визуализация с маленькой частотой.

Теория что то задерживает запись на 10 секунд а остановка в текущем времени, получается обрезанная запись. Кажется это тормозит запись в реальном времени получение уровня звука.

