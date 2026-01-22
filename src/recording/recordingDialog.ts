import type { AssistantSettings, Event } from "../types";
import type { RecordingService, RecordingStats } from "./recordingService";
import { parseAssistantActionFromTitle } from "../presentation/electronWindow/bridge/titleActionTransport";

type ElectronLike = {
  remote?: { BrowserWindow?: any };
  BrowserWindow?: any;
  screen?: { getPrimaryDisplay?: () => { workArea?: { width: number; height: number } } };
};

type RecordingDialogParams = {
  settings: AssistantSettings;
  events: Event[];
  /** Список протоколов для режима "продолжить" (path + label). */
  protocols?: Array<{ path: string; label: string }>;
  defaultEventKey?: string;
  lockDefaultEvent?: boolean;
  defaultCreateNewProtocol: boolean;
  /** @returns путь протокола (md), чтобы запись могла прикреплять файлы в `files:`. */
  onCreateProtocol?: (ev: Event) => string | null | undefined | Promise<string | null | undefined>;
  /** @returns путь протокола (md), чтобы запись могла прикреплять файлы в `files:`. */
  onCreateEmptyProtocol?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Открыть протокол в редакторе (клик по протоколу в диалоге). */
  onOpenProtocol?: (protocolFilePath: string) => void | Promise<void>;
  recordingService: RecordingService;
  onLog?: (m: string) => void;
};

function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class RecordingDialog {
  private win: any | null = null;
  private statsTimer?: number;
  private vizTimer?: number;
  private latestAmp01: number | null = null;
  private vizPushInFlight = false;

  constructor(private params: RecordingDialogParams) {}

  open(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron") as ElectronLike;
    const BrowserWindow = electron?.remote?.BrowserWindow ?? electron?.BrowserWindow;
    if (!BrowserWindow) throw new Error("Electron BrowserWindow недоступен");

    const width = 760;
    const height = 420;

    const win = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.win = win;

    try {
      win.setAlwaysOnTop(true, "screen-saver");
    } catch {
      // ignore
    }
    try {
      win.setOpacity(0.96);
    } catch {
      // ignore
    }

    try {
      const wa = electron?.screen?.getPrimaryDisplay?.()?.workArea;
      if (wa?.width && wa?.height) {
        const x = Math.max(0, Math.round((wa.width - width) / 2));
        const y = Math.max(0, Math.round((wa.height - height) / 3));
        win.setPosition(x, y);
      }
    } catch {
      // ignore
    }

    const nowMs = Date.now();
    const defaultKey = this.params.defaultEventKey ?? "";

    const preferredEv =
      defaultKey && this.params.lockDefaultEvent ? this.params.events.find((ev) => `${ev.calendar.id}:${ev.id}` === defaultKey) : undefined;

    // Occurrence: показываем только будущие (start > now), но включаем выбранное (из напоминания/повестки) даже если оно не в будущем.
    const occurrences = this.params.events
      .slice()
      .filter((ev) => ev.start.getTime() > nowMs || (preferredEv && ev === preferredEv))
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, 200);

    const list = occurrences.map((ev) => {
      const key = `${ev.calendar.id}:${ev.id}`;
      const label = `${ev.start.toLocaleString("ru-RU", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} — ${ev.summary}`;
      const startMs = ev.start.getTime();
      const endMs = (ev.end?.getTime() ?? startMs + 60 * 60_000); // fallback 1h
      return { key, label, startMs, endMs };
    });

    const lockDefaultEvent = this.params.lockDefaultEvent ? "true" : "false";
    const autoEnabled = this.params.settings.recording.autoStartEnabled ? "true" : "false";
    const autoSeconds = Math.max(1, Math.floor(Number(this.params.settings.recording.autoStartSeconds) || 5));
    const meta = list.map((x) => ({ key: x.key, startMs: x.startMs, endMs: x.endMs }));

    const options = [`<option value="">(не выбрано)</option>`]
      .concat(list.map((x) => `<option value="${escHtml(x.key)}"${x.key === defaultKey ? " selected" : ""}>${escHtml(x.label)}</option>`))
      .join("");

    // Event: список встреч (без дат), сортируем по дате ближайшего occurrence (из будущих).
    const nextBySummary = new Map<string, number>();
    for (const ev of occurrences) {
      const summary = String(ev.summary || "").trim();
      if (!summary) continue;
      const t = ev.start.getTime();
      const prev = nextBySummary.get(summary);
      if (prev == null || t < prev) nextBySummary.set(summary, t);
    }
    const meetingOptions = [`<option value="">(не выбрано)</option>`]
      .concat(
        Array.from(nextBySummary.entries())
          .sort((a, b) => a[1] - b[1])
          .map(([name]) => `<option value="${escHtml(name)}">${escHtml(name)}</option>`),
      )
      .join("");

    const lockedLabel = list.find((x) => x.key === defaultKey)?.label ?? "";
    const protocolOptions = [`<option value="">(не выбрано)</option>`]
      .concat(
        (this.params.protocols ?? [])
          .slice(0, 200)
          .map((p) => `<option value="${escHtml(String(p.path))}">${escHtml(String(p.label || p.path))}</option>`),
      )
      .join("");

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif; background: rgba(0,0,0,0); }
    .card {
      margin: 14px;
      padding: 14px 14px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(24,24,24,0.86);
      color: rgba(255,255,255,0.92);
      position: relative;
      overflow: hidden;
    }
    canvas.viz{
      position:absolute; inset: auto auto auto 0;
      width:100%; height:250px;
      bottom: 0px;
      bottom: 0;
      opacity:0.35;
      z-index:0;
      pointer-events:none;
    }
    .content{ position: relative; z-index: 1; }
    .title {
      font-weight: 750;
      margin-bottom: 16px;
      color: rgb(128, 128, 128);
      -webkit-app-region: drag;
      user-select: none;
      cursor: move;
    }
    .row { margin: 10px 0; }
    .locked-row{ display:none; align-items:center; gap:10px; margin: 20px 0; }
    .locked-row.on{ display:flex; }
    .locked-x{
      border: none;
      color: red;
      background: none;
      margin: 0px;
      padding: 0;
      width: auto;
      height: auto;
      outline: none;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    .locked-title{ font-weight: 650; }
    .linkish{ cursor:pointer; text-decoration: underline; text-underline-offset: 2px; }
    .linkish:hover{ opacity: 0.92; }
    label { display: block; opacity: 0.9; margin-bottom: 6px; }
    select, input[type="checkbox"] { font-size: 14px; }
    select {
      width: 100%;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(40,40,40,0.85);
      color: rgba(255,255,255,0.92);
      padding: 10px;
      -webkit-app-region: no-drag;
    }
    input, label { -webkit-app-region: no-drag; }
    .line { display: flex; align-items: center; gap: 10px; }
    .rec-wrap { display: flex; align-items: center; gap: 14px; margin-top: 18px; }
    .rec-btn {
      width: 86px; height: 86px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255, 92, 92, 0.98);
      cursor: pointer;
      -webkit-app-region: no-drag;
      display:flex; align-items:center; justify-content:center;
      position: relative;
    }
    .rec-btn:disabled{
      opacity: 0.85;
      cursor: default;
    }
    .rec-btn.loading::after{
      content: "";
      position: absolute;
      inset: -4px;
      border-radius: 999px;
      border: 3px solid rgba(255,255,255,0.28);
      border-top-color: rgba(255,255,255,0.92);
      animation: assistantSpin 0.9s linear infinite;
      pointer-events: none;
    }
    @keyframes assistantSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .rec-btn .dot{
      width: 36px; height: 36px;
      background: rgba(255,255,255,0.92);
      border-radius: 999px;
      display:block;
    }
    .rec-btn .sq{
      width: 26px; height: 26px;
      background: rgba(255,255,255,0.92);
      border-radius: 6px;
      display:none;
    }
    /* recording -> серый круг + белый квадрат */
    .rec-btn.rec{
      background: rgba(120,120,120,0.92);
      border-color: rgba(255,255,255,0.18);
    }
    .rec-btn.rec .dot{ display:none; }
    .rec-btn.rec .sq{ display:block; }

    .footer{
      display:flex;
      align-items:center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 14px;
    }
    .footer-left{ display:flex; flex-direction: column; gap: 2px; }
    .statusText{ font-variant-numeric: tabular-nums; opacity: 0.95; margin-bottom: 5px; }
    .statusText.rec{ color: rgba(255, 92, 92, 0.98); }
    .filesText{ color: rgb(128, 128, 128); opacity: 0.95; font-variant-numeric: tabular-nums; font-size: 12px; }
    .foundText{ color: rgb(128, 128, 128); opacity: 0.95; font-variant-numeric: tabular-nums; font-size: 12px; }
    .btns { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
    button.secondary {
      cursor: pointer;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(40,40,40,0.85);
      color: rgba(255,255,255,0.92);
      padding: 8px 10px;
      font-weight: 650;
      -webkit-app-region: no-drag;
    }
    button.danger {
      background: rgba(40,40,40,0.10);
      border-color: rgba(255, 92, 92, 0.92);
      color: rgba(255, 92, 92, 0.98);
    }
    .btn-icon{ opacity:0.95; margin-right:6px; }
  </style>
</head>
<body>
  <div class="card">
    <canvas id="viz" class="viz"></canvas>
    <div class="content">
      <div class="title">🎙 Ассистент: Диктофон</div>

      <div id="protocolRow" class="locked-row">
        <div class="locked-title">Протокол: <span id="protocolTitle" class="linkish" title="Открыть протокол"></span></div>
      </div>

      <div id="modeRow" class="row">
        <select id="modeSel">
          <option value="manual_new" selected>Новый протокол без встречи</option>
          <option value="occurrence_new">Новый протокол для указанного события</option>
          <option value="event_new">Новый протокол для указанной встречи</option>
          <option value="continue_existing">Продолжить для выбранного протокола</option>
        </select>
      </div>

      <div id="occurrenceRow" class="row" style="display:none">
        <select id="occurrenceSel">${options}</select>
      </div>

      <div id="eventRow" class="row" style="display:none">
        <select id="eventSel">${meetingOptions}</select>
      </div>

      <div id="protocolSelRow" class="row" style="display:none">
        <select id="protocolSel">${protocolOptions}</select>
      </div>

      <div class="rec-wrap">
        <button id="recBtn" class="rec-btn"><div class="dot"></div><div class="sq"></div></button>
      </div>

      <div class="footer">
        <div class="footer-left">
          <div id="statusText" class="statusText"></div>
          <div id="filesText" class="filesText"></div>
          <div id="foundText" class="foundText"></div>
        </div>
        <div class="btns">
          <button id="pauseBtn" class="secondary" style="display:none"><span class="btn-icon">⏸</span>Пауза</button>
          <button id="closeBtn" class="secondary danger" onclick="document.title='assistant-action:close'"><span class="btn-icon">✕</span>Закрыть</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    const defaultOccurrenceKey = ${JSON.stringify(String(defaultKey || ""))};
    const state = {
      recording: false,
      paused: false,
      switching: false,
      switchingKind: "",
      switchingSinceMs: 0,
      startedAtMs: 0,
      filesTotal: 0,
      filesRecognized: 0,
      autoEnabled: ${autoEnabled},
      autoSeconds: ${autoSeconds},
      autoLeftMs: 0,
      lockDefaultEvent: ${lockDefaultEvent},
      lockedTitle: ${JSON.stringify(String(lockedLabel || ""))},
      protocolFilePath: "",
      mode: "manual_new",
      lastStatus: "idle",
      eventSummary: "",
      // дополнительные счётчики (на будущее: заполняются пайплайном распознавания/извлечения)
      foundProjects: 0,
      foundFacts: 0,
      foundPeople: 0,
      nextChunkInMs: 0,
      // история амплитуды за последние ~10 секунд (новое справа)
      // points: [{t, v}] где t=Date.now(), v=0..1
      ampPoints: [],
      ampMaxLen: 800,
      vizWindowMs: 10_000,
      // входной уровень (приходит из main) и плавная интерполяция в rAF
      ampTarget: 0,
      ampSmooth: 0,
      ampLastFillAtMs: 0,
    };
    const modeSel = document.getElementById('modeSel');
    const occurrenceSel = document.getElementById('occurrenceSel');
    const eventSel = document.getElementById('eventSel');
    const protocolSel = document.getElementById('protocolSel');
    const recBtn = document.getElementById('recBtn');
    const statsEl = document.getElementById('stats');
    const pauseBtn = document.getElementById('pauseBtn');
    const closeBtn = document.getElementById('closeBtn');
    const modeRow = document.getElementById('modeRow');
    const occurrenceRow = document.getElementById('occurrenceRow');
    const eventRow = document.getElementById('eventRow');
    const protocolSelRow = document.getElementById('protocolSelRow');
    const protocolRow = document.getElementById('protocolRow');
    const protocolTitleEl = document.getElementById('protocolTitle');
    const canvas = document.getElementById('viz');
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    const statusTextEl = document.getElementById('statusText');
    const filesTextEl = document.getElementById('filesText');
    const foundTextEl = document.getElementById('foundText');

    function resetToInitial(){
      state.protocolFilePath = "";
      state.mode = "manual_new";
      if(modeSel) modeSel.value = "manual_new";
      if(occurrenceSel) occurrenceSel.value = "";
      if(eventSel) eventSel.value = "";
      if(protocolSel) protocolSel.value = "";
      state.eventSummary = "";
      // Сбрасываем осциллограмму (после стопа/idle она должна быть пустой)
      state.ampPoints = [];
      state.ampTarget = 0;
      state.ampSmooth = 0;
      state.ampLastFillAtMs = Date.now();
    }

    function resizeCanvas(){
      if(!canvas) return;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * (window.devicePixelRatio || 1)));
      canvas.height = Math.max(1, Math.floor(r.height * (window.devicePixelRatio || 1)));
    }
    window.addEventListener('resize', resizeCanvas);
    // Важно: окно BrowserWindow создаётся с show:false, поэтому первый layout иногда даёт нулевые размеры.
    // Делаем несколько попыток ресайза после первой отрисовки.
    resizeCanvas();
    requestAnimationFrame(() => resizeCanvas());
    setTimeout(resizeCanvas, 50);
    setTimeout(resizeCanvas, 250);

    function pad2(n){ return String(n).padStart(2,'0'); }
    function formatCountdownRu(diffMs){
      const d = Math.max(0, Math.floor(diffMs));
      const totalSec = Math.floor(d / 1000);
      const sec = totalSec % 60;
      const totalMin = Math.floor(totalSec / 60);
      if(totalMin < 60){ return pad2(totalMin) + ":" + pad2(sec); }
      const min = totalMin % 60;
      const totalHours = Math.floor(totalMin / 60);
      if(totalHours < 24){ return pad2(totalHours) + ":" + pad2(min) + ":" + pad2(sec); }
      const hours = totalHours % 24;
      const days = Math.floor(totalHours / 24);
      return String(days) + " дней " + pad2(hours) + ":" + pad2(min) + ":" + pad2(sec);
    }
    function formatDurationShort(elapsedMs){
      const d = Math.max(0, Math.floor(elapsedMs || 0));
      const totalSec = Math.floor(d / 1000);
      const sec = totalSec % 60;
      const totalMin = Math.floor(totalSec / 60);
      const min = totalMin % 60;
      const hours = Math.floor(totalMin / 60);
      if(hours > 0) return pad2(hours) + ":" + pad2(min) + ":" + pad2(sec);
      return pad2(totalMin) + ":" + pad2(sec);
    }

    function render(){
      const elapsed = state.recording ? (Date.now() - state.startedAtMs) : 0;

      const protocolOn = Boolean(state.protocolFilePath);
      if(protocolRow) protocolRow.classList.toggle('on', Boolean(protocolOn));
      if(protocolTitleEl){
        const p = String(state.protocolFilePath || "");
        const base = p ? (p.split("/").pop() || p) : "";
        protocolTitleEl.textContent = base;
      }

      // До старта записи показываем режим (и под-выборы), после старта — только выбранный протокол.
      const showModeControls = !protocolOn;
      if(modeRow) modeRow.style.display = showModeControls ? "block" : "none";
      if(occurrenceRow) occurrenceRow.style.display = (showModeControls && state.mode === "occurrence_new") ? "block" : "none";
      if(eventRow) eventRow.style.display = (showModeControls && state.mode === "event_new") ? "block" : "none";
      if(protocolSelRow) protocolSelRow.style.display = (showModeControls && state.mode === "continue_existing") ? "block" : "none";

      // блокировка контролов при записи
      if(state.recording){
        recBtn.classList.add('rec');
        if(modeSel) modeSel.disabled = true;
        if(occurrenceSel) occurrenceSel.disabled = true;
        if(eventSel) eventSel.disabled = true;
        if(protocolSel) protocolSel.disabled = true;
        if(pauseBtn) pauseBtn.style.display = "inline-block";
        if(pauseBtn){
          pauseBtn.innerHTML = state.paused ? '<span class="btn-icon">▶</span>Продолжить' : '<span class="btn-icon">⏸</span>Пауза';
        }
      } else {
        recBtn.classList.remove('rec');
        if(modeSel) modeSel.disabled = false;
        if(occurrenceSel) occurrenceSel.disabled = false;
        if(eventSel) eventSel.disabled = false;
        if(protocolSel) protocolSel.disabled = false;
        if(pauseBtn) pauseBtn.style.display = "none";
      }

      // Третье состояние: переключение (start/stop) — блокируем действия и показываем лоадер.
      if(state.switching){
        recBtn.disabled = true;
        recBtn.classList.add('loading');
        if(pauseBtn) pauseBtn.disabled = true;
        if(closeBtn) closeBtn.disabled = true;
        if(modeSel) modeSel.disabled = true;
        if(occurrenceSel) occurrenceSel.disabled = true;
        if(eventSel) eventSel.disabled = true;
        if(protocolSel) protocolSel.disabled = true;
      } else {
        recBtn.disabled = false;
        recBtn.classList.remove('loading');
        if(pauseBtn) pauseBtn.disabled = false;
        if(closeBtn) closeBtn.disabled = false;
      }

      // текст статуса (слева в footer, в один ряд с кнопками)
      let statusText = "";
      if(state.switching){
        statusText = (state.switchingKind === "stop") ? "Останавливаю…" : "Запускаю…";
      } else if(state.recording){
        statusText = state.paused ? "Пауза" : "Идет запись";
      } else if(state.autoEnabled && state.autoLeftMs > 0){
        statusText = "Авто запись через: " + formatCountdownRu(state.autoLeftMs);
      } else {
        if(state.mode === "occurrence_new" && occurrenceSel && !occurrenceSel.value){
          statusText = "Выбери событие";
        } else if(state.mode === "event_new" && eventSel && !eventSel.value){
          statusText = "Выбери встречу";
        } else if(state.mode === "continue_existing" && protocolSel && !protocolSel.value){
          statusText = "Выбери протокол";
        } else {
          statusText = "Готово к записи";
        }
      }
      if(statusTextEl) {
        statusTextEl.textContent = statusText;
        statusTextEl.classList.toggle('rec', Boolean(state.recording && !state.paused));
      }
      if(filesTextEl){
        const dur = state.recording ? ("Длительность: " + formatDurationShort(elapsed)) : "Длительность: 00:00";
        const next = (state.recording && !state.paused && state.nextChunkInMs > 0) ? (" • До конца блока: " + formatCountdownRu(state.nextChunkInMs)) : "";
        filesTextEl.textContent = dur + " • Файлов: " + state.filesTotal + " • Расшифровано: " + state.filesRecognized + next;
      }
      if(foundTextEl){
        foundTextEl.textContent = "Найдено: Проектов " + state.foundProjects + ", Фактов " + state.foundFacts + ", Людей " + state.foundPeople;
      }
    }

    const meta = ${JSON.stringify(meta)};
    function findMeta(key){
      for(const x of meta){ if(x.key === key) return x; }
      return null;
    }
    function isOngoingSelected(){
      const k = occurrenceSel.value || "";
      const m = findMeta(k);
      if(!m) return false;
      const now = Date.now();
      return m.startMs <= now && m.endMs >= now;
    }
    function armAutoIfNeeded(){
      if(state.recording) return;
      if(!state.autoEnabled) { state.autoLeftMs = 0; return; }
      // автостарт логичен только для "протокол для встречи" и при выбранной встрече
      if(state.mode !== "occurrence_new") { state.autoLeftMs = 0; return; }
      if(!occurrenceSel.value) { state.autoLeftMs = 0; return; }
      if(!isOngoingSelected()) { state.autoLeftMs = 0; return; }
      if(state.autoLeftMs <= 0) state.autoLeftMs = state.autoSeconds * 1000;
    }

    recBtn.addEventListener('click', () => {
      if(state.switching) return;
      if(!state.recording){
        const mode = String(state.mode || "manual_new");
        const occurrenceKey = (mode === "occurrence_new" && occurrenceSel) ? (occurrenceSel.value || "") : "";
        const eventSummary = (mode === "event_new" && eventSel) ? (eventSel.value || "") : "";
        const protocolFilePath = (mode === "continue_existing" && protocolSel) ? (protocolSel.value || "") : "";
        if(mode === "occurrence_new" && !occurrenceKey) { render(); return; }
        if(mode === "event_new" && !eventSummary) { render(); return; }
        if(mode === "continue_existing" && !protocolFilePath) { render(); return; }
        const payload = { mode, occurrenceKey, eventSummary, protocolFilePath };
        document.title = "assistant-action:rec_start:" + encodeURIComponent(JSON.stringify(payload));
        state.recording = true;
        state.paused = false;
        state.switching = true;
        state.switchingKind = "start";
        state.switchingSinceMs = Date.now();
        state.startedAtMs = Date.now();
        render();
        return;
      }
      document.title = "assistant-action:rec_stop";
      // STOP может занимать время (дописывание файла). Не сбрасываем UI сразу — покажем лоадер до idle.
      state.switching = true;
      state.switchingKind = "stop";
      state.switchingSinceMs = Date.now();
      state.paused = false;
      render();
    });

    if(pauseBtn){
      pauseBtn.addEventListener('click', () => {
        if(state.switching) return;
        if(!state.recording) return;
        if(!state.paused){
          document.title = "assistant-action:rec_pause";
          state.paused = true;
          render();
          return;
        }
        document.title = "assistant-action:rec_resume";
        state.paused = false;
        render();
      });
    }

    // Закрытие во время записи должно показывать анимацию "стоп" (finalize может быть не мгновенным).
    if(closeBtn){
      closeBtn.addEventListener('click', () => {
        if(state.switching) return;
        if(state.recording){
          state.switching = true;
          state.switchingKind = "stop";
          state.switchingSinceMs = Date.now();
          state.paused = false;
          render();
        }
        // inline onclick уже отправит assistant-action:close, но оставляем здесь на всякий случай
        // (если в будущем уберём onclick).
        document.title = "assistant-action:close";
      });
    }

    if(protocolTitleEl){
      protocolTitleEl.addEventListener('click', () => {
        if(state.switching) return;
        const p = String(state.protocolFilePath || "").trim();
        if(!p) return;
        document.title = "assistant-action:open_protocol:" + encodeURIComponent(p);
      });
    }

    if(modeSel){
      modeSel.addEventListener('change', () => {
        state.mode = String(modeSel.value || "manual_new");
        if(state.mode !== "event_new") state.eventSummary = "";
        state.autoLeftMs = 0;
        armAutoIfNeeded();
        render();
      });
    }
    if(occurrenceSel) occurrenceSel.addEventListener('change', () => { state.autoLeftMs = 0; armAutoIfNeeded(); render(); });
    if(eventSel) eventSel.addEventListener('change', () => { state.eventSummary = String(eventSel.value || ""); state.autoLeftMs = 0; armAutoIfNeeded(); render(); });
    if(protocolSel) protocolSel.addEventListener('change', () => { state.autoLeftMs = 0; armAutoIfNeeded(); render(); });

    window.__assistantRecordingUpdate = (s) => {
      const nextStatus = String(s?.status ?? "idle");
      // Сбрасываем в начальное состояние только при переходе active -> idle (после stop),
      // иначе пользовательский выбор "режима" будет сбрасываться каждую секунду (stats timer).
      if(nextStatus === "idle" && state.lastStatus !== "idle"){
        // stop завершён
        state.switching = false;
        state.switchingKind = "";
        state.switchingSinceMs = 0;
        resetToInitial();
        state.recording = false;
        state.paused = false;
        state.filesTotal = 0;
        state.filesRecognized = 0;
        state.foundProjects = 0;
        state.foundFacts = 0;
        state.foundPeople = 0;
        state.nextChunkInMs = 0;
        state.lastStatus = "idle";
        render();
        return;
      }
      state.filesTotal = Number(s.filesTotal || 0);
      state.filesRecognized = Number(s.filesRecognized || 0);
      if(s.startedAtMs) state.startedAtMs = Number(s.startedAtMs);
      if(s.protocolFilePath){
        const p = String(s.protocolFilePath || "").trim();
        if(p){
          state.protocolFilePath = p;
        }
      }
      state.foundProjects = Number(s.foundProjects || 0);
      state.foundFacts = Number(s.foundFacts || 0);
      state.foundPeople = Number(s.foundPeople || 0);
      state.nextChunkInMs = Number(s.nextChunkInMs || 0);
      state.recording = (s.status === "recording" || s.status === "paused");
      state.paused = (s.status === "paused");
      // start завершён (или resume)
      if(state.switching && state.switchingKind === "start" && (nextStatus === "recording" || nextStatus === "paused")){
        state.switching = false;
        state.switchingKind = "";
        state.switchingSinceMs = 0;
      }
      state.lastStatus = nextStatus;
      if(!state.recording) armAutoIfNeeded();
      render();
    };

    window.__assistantRecordingVizUpdate = (amp01) => {
      const v = Number(amp01);
      if(!Number.isFinite(v)) return;
      // Важно: не пишем точки прямо здесь. Апдейты из main могут приходить редко (или пачками),
      // что визуально даёт “квадраты”. Вместо этого сохраняем target, а точки наполняем равномерно в rAF.
      state.ampTarget = Math.max(0, Math.min(1, v));
    };

    function fillVizPoints(now){
      const windowMs = Math.max(1000, Number(state.vizWindowMs || 10_000));
      const horizon = windowMs + 2500;
      let lastAt = Number(state.ampLastFillAtMs || 0);
      if(!lastAt) lastAt = now;
      // если мы “проспали” (например окно подвисло) — не догоняем бесконечно, просто перескочим.
      if(now - lastAt > horizon) lastAt = now - horizon;
      // Наполняем примерно 30fps, чтобы не грузить CPU/DOM.
      const stepMs = 33;
      for(let t = lastAt + stepMs; t <= now; t += stepMs){
        // Сглаживание (инерция): чтобы “пачки” апдейтов не выглядели дергано.
        state.ampSmooth = (state.ampSmooth * 0.82) + (state.ampTarget * 0.18);
        state.ampPoints.push({ t, v: state.ampSmooth });
      }
      state.ampLastFillAtMs = now;
      // чистим старое
      while(state.ampPoints.length && (now - state.ampPoints[0].t) > horizon) state.ampPoints.shift();
      const extra = state.ampPoints.length - (state.ampMaxLen || 800);
      if(extra > 0) state.ampPoints.splice(0, extra);
    }

    function draw(){
      if(!ctx || !canvas) return;
      // Если canvas поймал размер 1x1 (часто при show:false) — пробуем пересчитать.
      if(canvas.width <= 2 || canvas.height <= 2) resizeCanvas();
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0,0,w,h);

      const ptsAll = state.ampPoints;
      const now = Date.now();
      fillVizPoints(now);
      if(!ptsAll || ptsAll.length < 2) { requestAnimationFrame(draw); return; }

      // рисуем только справа от кнопки записи (как в макете)
      const btnRect = recBtn.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      // Старт ровно от правого края кнопки (без дополнительного "воздуха"),
      // чтобы диаграмма визуально "выходила" из кнопки.
      const startXcss = Math.max(0, (btnRect.right - canvasRect.left));
      const startX = Math.floor(startXcss * dpr);
      const endX = w;
      const drawW = Math.max(1, endX - startX);

      const mid = Math.floor(h * 0.52);
      const ampScale = h * 0.34;

      ctx.save();
      // Инвертируем ось времени: "звук исходит из кнопки" (новое слева, старое уезжает вправо)
      // Рисуем сплошной заливкой (filled area), без контура.
      const windowMs = Math.max(1000, Number(state.vizWindowMs || 10_000));
      const points = [];
      // Берём только последние N секунд. Новое (age=0) рисуем у кнопки.
      for(let i = ptsAll.length - 1; i >= 0; i--){
        const p0 = ptsAll[i];
        const ageMs = now - Number(p0.t || 0);
        if(ageMs < 0) continue;
        if(ageMs > windowMs) break;
        const t = ageMs / windowMs; // 0..1
        // Гамма-коррекция для заметности тихих уровней (иначе 0.02..0.08 выглядит почти "плоско").
        const v0 = Math.max(0, Math.min(1, Number(p0.v||0)));
        const v = Math.pow(v0, 0.55);
        const x = startX + Math.floor(t * drawW);
        points.push({ x, v });
      }
      if(points.length < 2){ requestAnimationFrame(draw); return; }

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(255,255,255,0.22)";

      ctx.beginPath();
      for(let i=0;i<points.length;i++){
        const p = points[i];
        const y = mid - p.v * ampScale;
        if(i===0) ctx.moveTo(p.x, y); else ctx.lineTo(p.x, y);
      }
      for(let i=points.length-1;i>=0;i--){
        const p = points[i];
        const y = mid + p.v * ampScale;
        ctx.lineTo(p.x, y);
      }
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    setInterval(() => {
      // fail-safe: если переключение зависло — не блокируем UI навсегда
      if(state.switching && state.switchingSinceMs && (Date.now() - state.switchingSinceMs) > 15000){
        state.switching = false;
        state.switchingKind = "";
        state.switchingSinceMs = 0;
      }
      if(!state.recording && state.autoEnabled && state.autoLeftMs > 0){
        state.autoLeftMs = Math.max(0, state.autoLeftMs - 1000);
        if(state.autoLeftMs === 0){
          // стартуем запись автоматически (как клик)
          const mode = String(state.mode || "manual_new");
          const occurrenceKey = (mode === "occurrence_new" && occurrenceSel) ? (occurrenceSel.value || "") : "";
          const eventSummary = (mode === "event_new" && eventSel) ? (eventSel.value || "") : "";
          const protocolFilePath = (mode === "continue_existing" && protocolSel) ? (protocolSel.value || "") : "";
          if(mode === "occurrence_new" && !occurrenceKey) { render(); return; }
          if(mode === "event_new" && !eventSummary) { render(); return; }
          if(mode === "continue_existing" && !protocolFilePath) { render(); return; }
          const payload = { mode, occurrenceKey, eventSummary, protocolFilePath };
          document.title = "assistant-action:rec_start:" + encodeURIComponent(JSON.stringify(payload));
          state.recording = true;
          state.startedAtMs = Date.now();
        }
      }
      render();
    }, 1000);

    // init
    resetToInitial();
    state.lastStatus = "idle";
    // Если диалог открыт из напоминания/повестки (lockDefaultEvent) — предвыбираем occurrence.
    if(state.lockDefaultEvent && defaultOccurrenceKey && occurrenceSel){
      state.mode = "occurrence_new";
      if(modeSel) modeSel.value = "occurrence_new";
      occurrenceSel.value = defaultOccurrenceKey;
    }
    armAutoIfNeeded();
    render();
  </script>
</body>
</html>`;

    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    void win.loadURL(url);

    const stopStatsTimer = () => {
      if (this.statsTimer) window.clearInterval(this.statsTimer);
      this.statsTimer = undefined;
      if (this.vizTimer) window.clearInterval(this.vizTimer);
      this.vizTimer = undefined;
      this.latestAmp01 = null;
      this.vizPushInFlight = false;
    };

    const pushStats = (stats: RecordingStats) => {
      if (!this.win) return;
      try {
        void this.win.webContents.executeJavaScript(`window.__assistantRecordingUpdate && window.__assistantRecordingUpdate(${JSON.stringify(stats)})`);
      } catch {
        // ignore
      }
    };

    const pushViz = (amp01: number) => {
      if (!this.win) return;
      try {
        this.vizPushInFlight = true;
        const p: Promise<unknown> = this.win.webContents.executeJavaScript(
          `window.__assistantRecordingVizUpdate && window.__assistantRecordingVizUpdate(${JSON.stringify(amp01)})`,
        );
        void p.finally(() => {
          this.vizPushInFlight = false;
        });
      } catch {
        this.vizPushInFlight = false;
        // ignore
      }
    };

    this.params.recordingService.setOnStats((s) => pushStats(s));
    let lastVizLogAt = 0;
    this.params.recordingService.setOnViz((amp01) => {
      // Важно: не вызываем executeJavaScript на каждый сэмпл — это легко забивает очередь и визуально даёт 1fps.
      // Вместо этого сохраняем последнее значение, а в окно пушим батчом таймером (см. vizTimer ниже).
      this.latestAmp01 = Number(amp01);
      // Диагностика доставки в окно: раз в ~2 секунды пишем, что окно реально получает onViz callback.
      const now = Date.now();
      if (now - lastVizLogAt > 2000) {
        lastVizLogAt = now;
        try {
          this.params.onLog?.(`Viz: amp01=${Number(amp01).toFixed(3)}`);
        } catch {
          // ignore
        }
      }
    });
    // Батч-пуш визуализации: 30fps, дропаем кадры если webContents занят.
    this.vizTimer = window.setInterval(() => {
      if (!this.win) return;
      if (this.vizPushInFlight) return;
      const v = this.latestAmp01;
      if (v == null || !Number.isFinite(v)) return;
      pushViz(v);
    }, 33);
    this.statsTimer = window.setInterval(() => pushStats(this.params.recordingService.getStats()), 1000);

    const close = () => {
      stopStatsTimer();
      try {
        this.win?.close();
      } catch {
        // ignore
      }
      this.win = null;
    };

    const onAction = async (raw: string) => {
      if (raw === "close") {
        try {
          const st = this.params.recordingService.getStats();
          if (st.status !== "idle") {
            await this.params.recordingService.stop();
          }
        } catch {
          // ignore
        } finally {
          close();
        }
        return;
      }
      if (raw.startsWith("rec_start:")) {
        const encoded = raw.slice("rec_start:".length);
        let payload: { mode?: string; occurrenceKey?: string; eventSummary?: string; protocolFilePath?: string } = {};
        try {
          payload = JSON.parse(decodeURIComponent(encoded));
        } catch {
          payload = {};
        }

        const mode = String(payload.mode ?? "manual_new").trim() || "manual_new";
        const occurrenceKey = String(payload.occurrenceKey ?? "").trim();
        const eventSummary = String(payload.eventSummary ?? "").trim();
        const existingProtocol = String(payload.protocolFilePath ?? "").trim();
        let protocolFilePath: string | undefined = existingProtocol || undefined;
        let resolvedEventKey: string | undefined = occurrenceKey || undefined;

        // Любой путь должен привести к выбранному протоколу:
        // 1) manual_new -> создаём пустой протокол
        // 2) occurrence_new  -> создаём протокол для выбранного события (occurrence)
        // 3) event_new -> создаём протокол для встречи (Event/master): берём ближайшее событие по summary
        // 3) continue_existing -> используем выбранный протокол
        if (!protocolFilePath) {
          if (mode === "occurrence_new" && occurrenceKey) {
            const ev = this.params.events.find((e) => `${e.calendar.id}:${e.id}` === occurrenceKey);
            if (ev) {
              const p = await this.params.onCreateProtocol?.(ev);
              protocolFilePath = typeof p === "string" && p.trim() ? p.trim() : undefined;
            }
          } else if (mode === "event_new" && eventSummary) {
            const ev =
              this.params.events
                .slice()
                .sort((a, b) => a.start.getTime() - b.start.getTime())
                .find((e) => String(e.summary || "").trim() === eventSummary) ?? null;
            if (ev) {
              resolvedEventKey = `${ev.calendar.id}:${ev.id}`;
              const p = await this.params.onCreateProtocol?.(ev);
              protocolFilePath = typeof p === "string" && p.trim() ? p.trim() : undefined;
            }
          } else if (mode === "manual_new") {
            const p = await this.params.onCreateEmptyProtocol?.();
            protocolFilePath = typeof p === "string" && p.trim() ? p.trim() : undefined;
          }
        }

        try {
          await this.params.recordingService.start({
            eventKey: resolvedEventKey,
            protocolFilePath,
          });
          pushStats(this.params.recordingService.getStats());
        } catch (e) {
          const msg = String((e as unknown) ?? "неизвестная ошибка");
          this.params.onLog?.(`Запись: не удалось запустить: ${msg}`);
          // Возвращаем UI в idle (он сам снимет `recording=true` и не будет считаться запущенным).
          pushStats(this.params.recordingService.getStats());
        }
        return;
      }
      if (raw.startsWith("open_protocol:")) {
        const encoded = raw.slice("open_protocol:".length);
        const p = decodeURIComponent(encoded);
        const protocolFilePath = String(p ?? "").trim();
        if (protocolFilePath) {
          await this.params.onOpenProtocol?.(protocolFilePath);
        }
        return;
      }
      if (raw === "rec_stop") {
        await this.params.recordingService.stop();
        pushStats(this.params.recordingService.getStats());
        return;
      }
      if (raw === "rec_pause") {
        await this.params.recordingService.pause();
        pushStats(this.params.recordingService.getStats());
        return;
      }
      if (raw === "rec_resume") {
        this.params.recordingService.resume();
        pushStats(this.params.recordingService.getStats());
        return;
      }
    };

    win.webContents.on("page-title-updated", (e: unknown, title: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any)?.preventDefault?.();
      const parsed = parseAssistantActionFromTitle(String(title ?? ""));
      if (!parsed.ok) return;
      const a = parsed.action;
      if (a.kind === "close") void onAction("close");
      else if (a.kind === "recording.stop") void onAction("rec_stop");
      else if (a.kind === "recording.pause") void onAction("rec_pause");
      else if (a.kind === "recording.resume") void onAction("rec_resume");
      else if (a.kind === "recording.openProtocol") void onAction(`open_protocol:${encodeURIComponent(a.protocolFilePath)}`);
      else if (a.kind === "recording.start") void onAction(`rec_start:${encodeURIComponent(JSON.stringify(a.payload))}`);
      else return;
    });

    win.once("ready-to-show", () => {
      win.show();
    });

    win.on("closed", () => {
      stopStatsTimer();
      try {
        const st = this.params.recordingService.getStats();
        if (st.status !== "idle") void this.params.recordingService.stop();
      } catch {
        // ignore
      }
      this.win = null;
    });
  }
}

