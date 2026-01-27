export type RecordingWindowHtmlParams = {
  defaultOccurrenceKey: string;
  optionsHtml: string;
  meetingOptionsHtml: string;
  protocolOptionsHtml: string;
  lockDefaultEvent: boolean;
  autoEnabled: boolean;
  autoSeconds: number;
  lockedLabel: string;
  meta: Array<{ key: string; startMs: number; endMs: number }>;
  debugEnabled: boolean;
  cspConnectSrc: string[];
};

/**
 * Сгенерировать HTML для окна диктофона (data: URL).
 */
export function buildRecordingWindowHtml(p: RecordingWindowHtmlParams): string {
  const options = p.optionsHtml;
  const meetingOptions = p.meetingOptionsHtml;
  const protocolOptions = p.protocolOptionsHtml;
  const defaultOccurrenceKey = String(p.defaultOccurrenceKey || "");
  const lockDefaultEvent = p.lockDefaultEvent ? "true" : "false";
  const autoEnabled = p.autoEnabled ? "true" : "false";
  const autoSeconds = String(Number(p.autoSeconds || 0));
  const lockedLabel = String(p.lockedLabel || "");
  const meta = p.meta ?? [];
  const debugEnabled = p.debugEnabled ? "true" : "false";
  const cspConnectSrc = Array.isArray(p.cspConnectSrc) && p.cspConnectSrc.length
    ? p.cspConnectSrc.join(" ")
    : "'none'";
  // ВАЖНО: HTML/JS ниже перенесён из `src/recording/recordingDialog.ts` 1:1 по смыслу.
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src ${cspConnectSrc};" />
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
          <button id="closeBtn" class="secondary danger"><span class="btn-icon">✕</span>Закрыть</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    // Транспорт WindowTransport (рендер↔рендер) через preload-скрипт window.__assistantTransport.
    const transport = window.__assistantTransport;
    const debugEnabled = ${debugEnabled};
    function sendDiag(kind, payload){
      try{
        if(!debugEnabled) return;
        if(!transport || !transport.send) return;
        transport.send({ type: "recording/diag", payload: { kind: kind, ...payload } });
      }catch{}
    }
    try{
      if(transport && transport.onReady){
        transport.onReady(() => {
          const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
          sendDiag("window-ready", { at: Date.now(), canvas: { w: Math.round(rect.width||0), h: Math.round(rect.height||0) } });
        });
      } else {
        setTimeout(() => {
          const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
          sendDiag("window-ready", { at: Date.now(), canvas: { w: Math.round(rect.width||0), h: Math.round(rect.height||0) } });
        }, 200);
      }
    }catch{}
    setInterval(() => {
      try{
        if(!debugEnabled) return;
        if(!state.recording || state.paused) return;
        const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
        sendDiag("tick", {
          at: Date.now(),
          micPoints: state.micPoints.length,
          monitorPoints: state.monitorPoints.length,
          micTarget: Number(state.micTarget || 0),
          monitorTarget: Number(state.monitorTarget || 0),
          canvas: { w: Math.round(rect.width||0), h: Math.round(rect.height||0) },
        });
      }catch{}
    }, 1000);
    (function(){
      const pending = new Map();
      function randId(){
        return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
      }
      window.__assistantIpcOnResponse = function(resp){
        try{
          const r = resp || {};
          const p = pending.get(String(r.id||""));
          if(!p) return;
          pending.delete(String(r.id||""));
          try{ if(p.t) clearTimeout(p.t); }catch{}
          if(r.ok === true) p.resolve(r);
          else p.reject(r);
        }catch{}
      };
      window.sendAction = function(action){
        try{
          const id = randId();
          const req = { id: id, ts: Date.now(), action: action };
          if(!(transport && transport.send && transport.isReady && transport.isReady())){
            return Promise.reject("транспорт недоступен");
          }
          transport.send({ type: "window/request", payload: req });
          const p = new Promise((resolve,reject)=>{
            const t = setTimeout(() => {
              pending.delete(String(id));
              reject("timeout");
            }, 2500);
            pending.set(id, { resolve, reject, t });
          });
          return p;
        }catch{
          return Promise.resolve();
        }
      };

      // Транспорт: маршрутизация ответов.
      try{
        if(transport && transport.onMessage){
          transport.onMessage(function(msg){
            try{
              if(msg && msg.type === "window/response"){
                window.__assistantIpcOnResponse(msg.payload);
              }
            }catch{}
          });
        }
      }catch{}
    })();
    const defaultOccurrenceKey = ${JSON.stringify(String(defaultOccurrenceKey || ""))};
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
      // точки: [{t, v}] где t=Date.now(), v=0..1
      micPoints: [],
      monitorPoints: [],
      ampMaxLen: 800,
      vizWindowMs: 10_000,
      // входной уровень (приходит из основного процесса) и плавная интерполяция в rAF
      micTarget: 0,
      monitorTarget: 0,
      micSmooth: 0,
      monitorSmooth: 0,
      vizLastFillAtMs: 0,
      vizDebugLastAtMs: 0,
      drawDebugLastAtMs: 0,
      drawTimer: 0,
      pauseStartedAtMs: 0,
    };
    const modeSel = document.getElementById('modeSel');
    const occurrenceSel = document.getElementById('occurrenceSel');
    const eventSel = document.getElementById('eventSel');
    const protocolSel = document.getElementById('protocolSel');
    const recBtn = document.getElementById('recBtn');
    const statsEl = document.getElementById('stats');
    void statsEl;
    const pauseBtn = document.getElementById('pauseBtn');
    const closeBtn = document.getElementById('closeBtn');
    const modeRow = document.getElementById('modeRow');
    const occurrenceRow = document.getElementById('occurrenceRow');
    const eventRow = document.getElementById('eventRow');
    const protocolSelRow = document.getElementById('protocolSelRow');
    const protocolRow = document.getElementById('protocolRow');
    const protocolTitleEl = document.getElementById('protocolTitle');
    const canvas = document.getElementById('viz');
    let ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
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
      // Сбрасываем осциллограмму (после стопа/простоя она должна быть пустой)
      state.micPoints = [];
      state.monitorPoints = [];
      state.micTarget = 0;
      state.monitorTarget = 0;
      state.micSmooth = 0;
      state.monitorSmooth = 0;
      state.vizLastFillAtMs = Date.now();
      state.pauseStartedAtMs = 0;
    }

    function resetVizState(){
      state.micPoints = [];
      state.monitorPoints = [];
      state.micTarget = 0;
      state.monitorTarget = 0;
      state.micSmooth = 0;
      state.monitorSmooth = 0;
      state.vizLastFillAtMs = Date.now();
      state.pauseStartedAtMs = 0;
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

      // Третье состояние: переключение (старт/стоп) — блокируем действия и показываем лоадер.
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

      // текст статуса (слева в футере, в один ряд с кнопками)
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
        const wasRecording = state.recording;
        const mode = String(state.mode || "manual_new");
        const occurrenceKey = (mode === "occurrence_new" && occurrenceSel) ? (occurrenceSel.value || "") : "";
        const eventSummary = (mode === "event_new" && eventSel) ? (eventSel.value || "") : "";
        const protocolFilePath = (mode === "continue_existing" && protocolSel) ? (protocolSel.value || "") : "";
        if(mode === "occurrence_new" && !occurrenceKey) { render(); return; }
        if(mode === "event_new" && !eventSummary) { render(); return; }
        if(mode === "continue_existing" && !protocolFilePath) { render(); return; }
        const payload = { mode, occurrenceKey, eventSummary, protocolFilePath };
        sendAction({ kind: "recording.start", payload: payload }).catch(() => {
          state.switching = false;
          state.switchingKind = "";
          state.switchingSinceMs = 0;
          state.recording = wasRecording;
          state.paused = false;
          render();
        });
        state.recording = true;
        state.paused = false;
        state.switching = true;
        state.switchingKind = "start";
        state.switchingSinceMs = Date.now();
        state.startedAtMs = Date.now();
        render();
        return;
      }
      const wasRecording = state.recording;
      const wasPaused = state.paused;
      sendAction({ kind: "recording.stop" }).catch(() => {
        state.switching = false;
        state.switchingKind = "";
        state.switchingSinceMs = 0;
        state.recording = wasRecording;
        state.paused = wasPaused;
        render();
      });
      // Стоп может занимать время (дописывание файла). Не сбрасываем интерфейс сразу — покажем лоадер до простоя.
      state.switching = true;
      state.switchingKind = "stop";
      state.switchingSinceMs = Date.now();
      state.paused = false;
      resetVizState();
      stopDrawLoop();
      render();
    });

    if(pauseBtn){
      pauseBtn.addEventListener('click', () => {
        if(state.switching) return;
        if(!state.recording) return;
        if(!state.paused){
          sendAction({ kind: "recording.pause" }).catch(() => {
            state.paused = false;
            render();
          });
          state.paused = true;
          render();
          return;
        }
        sendAction({ kind: "recording.resume" }).catch(() => {
          state.paused = true;
          render();
        });
        state.paused = false;
        render();
      });
    }

    // Закрытие во время записи должно показывать анимацию "стоп" (финализация может быть не мгновенной).
    if(closeBtn){
      closeBtn.addEventListener('click', () => {
        // Если идет запись, сначала останавливаем её (визуально показываем "стоп")
        if(state.recording && !state.switching){
          state.switching = true;
          state.switchingKind = "stop";
          state.switchingSinceMs = Date.now();
          state.paused = false;
          render();
        }
        // Отправляем действие закрытия (окно закроется на стороне основного процесса)
        const closeFallback = setTimeout(() => {
          try {
            window.close();
          } catch (e) {
          }
        }, 600);
        sendAction({ kind: "close" })
          .then(() => clearTimeout(closeFallback))
          .catch(() => {
            clearTimeout(closeFallback);
            // Если IPC не работает, пытаемся закрыть окно напрямую через window.close()
            // Это может не сработать в Electron, но попробуем
            try {
              window.close();
            } catch (e) {
            }
          });
      });
    }

    if(protocolTitleEl){
      protocolTitleEl.addEventListener('click', () => {
        if(state.switching) return;
        const p = String(state.protocolFilePath || "").trim();
        if(!p) return;
        sendAction({ kind: "recording.openProtocol", protocolFilePath: p });
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

    function startDrawLoop(){
      if(state.drawTimer) return;
      draw();
      state.drawTimer = window.setInterval(() => {
        draw();
      }, 33);
    }
    function stopDrawLoop(){
      if(!state.drawTimer) return;
      window.clearInterval(state.drawTimer);
      state.drawTimer = 0;
    }

    window.__assistantRecordingUpdate = (s) => {
      const nextStatus = String(s?.status ?? "idle");
      // Сбрасываем в начальное состояние только при переходе active -> idle (после stop),
      // иначе пользовательский выбор "режима" будет сбрасываться каждую секунду (таймер статистики).
      if(nextStatus === "idle" && state.lastStatus !== "idle"){
        // стоп завершён
        state.switching = false;
        state.switchingKind = "";
        state.switchingSinceMs = 0;
        resetToInitial();
        stopDrawLoop();
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
      if(s.status === "recording" && state.lastStatus === "idle"){
        resetVizState();
      }
      if(s.status === "recording"){
        if(state.lastStatus === "paused" && state.pauseStartedAtMs){
          const delta = Date.now() - state.pauseStartedAtMs;
          if(delta > 0){
            for(let i=0;i<state.micPoints.length;i++){
              const p = state.micPoints[i];
              if(p && typeof p.t === "number") p.t += delta;
            }
            for(let i=0;i<state.monitorPoints.length;i++){
              const p = state.monitorPoints[i];
              if(p && typeof p.t === "number") p.t += delta;
            }
            state.vizLastFillAtMs = (state.vizLastFillAtMs || Date.now()) + delta;
          }
          state.pauseStartedAtMs = 0;
        }
        startDrawLoop();
      } else {
        if(state.lastStatus === "recording" && s.status === "paused"){
          state.pauseStartedAtMs = Date.now();
        }
        if(s.status === "paused" && !state.pauseStartedAtMs){
          state.pauseStartedAtMs = Date.now();
        }
        stopDrawLoop();
      }
      // Старт завершён (или продолжение)
      if(state.switching && state.switchingKind === "start" && (nextStatus === "recording" || nextStatus === "paused")){
        state.switching = false;
        state.switchingKind = "";
        state.switchingSinceMs = 0;
      }
      state.lastStatus = nextStatus;
      if(!state.recording) armAutoIfNeeded();
      render();
    };

    window.__assistantRecordingVizUpdate = (dto) => {
      if(state.switchingKind === "stop") return;
      if(!state.recording || state.paused) return;
      const mic = Number(dto && (dto.mic01 != null ? dto.mic01 : dto.amp01));
      const monitor = Number(dto && (dto.monitor01 != null ? dto.monitor01 : 0));
      if(!Number.isFinite(mic) && !Number.isFinite(monitor)) return;
      // Важно: не пишем точки прямо здесь. Апдейты из основного процесса могут приходить редко (или пачками),
      // что визуально даёт “квадраты”. Вместо этого сохраняем цель, а точки наполняем равномерно в rAF.
      if(Number.isFinite(mic)) state.micTarget = Math.max(0, Math.min(1, mic));
      if(Number.isFinite(monitor)) state.monitorTarget = Math.max(0, Math.min(1, monitor));

      // Диагностика доставки: раз в ~1с отправляем сигнал обратно в хост.
      try{
        const now = Date.now();
        if(debugEnabled && transport && transport.send && (now - (state.vizDebugLastAtMs || 0)) > 1000){
          state.vizDebugLastAtMs = now;
          const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
          transport.send({
            type: "recording/viz-debug",
            payload: {
              mic01: Number.isFinite(mic) ? Number(mic) : 0,
              monitor01: Number.isFinite(monitor) ? Number(monitor) : 0,
              canvas: { w: Math.round(rect.width||0), h: Math.round(rect.height||0) },
              at: now
            },
          });
        }
      }catch{}
    };

    // Отправка через транспорт: stats/viz без executeJavaScript.
    try{
      if(transport && transport.onMessage){
        transport.onMessage(function(msg){
          try{
            if(msg && msg.type === "recording/stats"){
              window.__assistantRecordingUpdate && window.__assistantRecordingUpdate(msg.payload);
            }
            if(msg && msg.type === "recording/viz"){
              window.__assistantRecordingVizUpdate && window.__assistantRecordingVizUpdate(msg.payload);
            }
            if(msg && msg.type === "recording/viz-clear"){
              state.micPoints = [];
              state.monitorPoints = [];
              state.micTarget = 0;
              state.monitorTarget = 0;
              state.micSmooth = 0;
              state.monitorSmooth = 0;
              state.vizLastFillAtMs = Date.now();
              state.pauseStartedAtMs = 0;
              stopDrawLoop();
            }
          }catch{}
        });
      }
    }catch{}

    function fillVizPoints(now){
      const windowMs = Math.max(1000, Number(state.vizWindowMs || 10_000));
      const horizon = windowMs + 2500;
      let lastAt = Number(state.vizLastFillAtMs || 0);
      if(!lastAt) lastAt = now;
      // если мы “проспали” (например окно подвисло) — не догоняем бесконечно, просто перескочим.
      if(now - lastAt > horizon) lastAt = now - horizon;
      // Наполняем примерно 30 fps, чтобы не грузить CPU/DOM.
      const stepMs = 33;
      for(let t = lastAt + stepMs; t <= now; t += stepMs){
        // Сглаживание (инерция): чтобы “пачки” апдейтов не выглядели дергано.
        state.micSmooth = (state.micSmooth * 0.82) + (state.micTarget * 0.18);
        state.monitorSmooth = (state.monitorSmooth * 0.82) + (state.monitorTarget * 0.18);
        state.micPoints.push({ t, v: state.micSmooth });
        state.monitorPoints.push({ t, v: state.monitorSmooth });
      }
      state.vizLastFillAtMs = now;
      // чистим старое
      while(state.micPoints.length && (now - state.micPoints[0].t) > horizon) state.micPoints.shift();
      while(state.monitorPoints.length && (now - state.monitorPoints[0].t) > horizon) state.monitorPoints.shift();
      const extraMic = state.micPoints.length - (state.ampMaxLen || 800);
      if(extraMic > 0) state.micPoints.splice(0, extraMic);
      const extraMon = state.monitorPoints.length - (state.ampMaxLen || 800);
      if(extraMon > 0) state.monitorPoints.splice(0, extraMon);
    }

    function draw(){
      if(!state.recording || state.paused) return;
      if(!canvas) return;
      if(!ctx && canvas.getContext){
        try{ ctx = canvas.getContext('2d'); }catch{}
      }
      if(!ctx){
        sendDiag("draw-no-ctx", { at: Date.now() });
        return;
      }
      // Если canvas поймал размер 1x1 (часто при show:false) — пробуем пересчитать.
      if(canvas.width <= 2 || canvas.height <= 2) resizeCanvas();
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0,0,w,h);

      const ptsMicAll = state.micPoints;
      const ptsMonAll = state.monitorPoints;
      const now = Date.now();
      fillVizPoints(now);
      if((!ptsMicAll || ptsMicAll.length < 2) && (!ptsMonAll || ptsMonAll.length < 2)) { return; }

      // рисуем только справа от кнопки записи (как в макете)
      const btnRect = recBtn && recBtn.getBoundingClientRect ? recBtn.getBoundingClientRect() : null;
      const canvasRect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, width: 0, height: 0 };
      // Старт ровно от правого края кнопки (без дополнительного "воздуха"),
      // чтобы диаграмма визуально "выходила" из кнопки.
      let startXcss = btnRect ? Math.max(0, (btnRect.right - canvasRect.left)) : 0;
      let startX = Math.floor(startXcss * dpr);
      const endX = w;
      if (!Number.isFinite(startX) || startX < 0) startX = 0;
      // Если кнопка оказалась почти у правой границы (или вне canvas) — рисуем от 0, иначе график будет невидим.
      if (endX - startX < 8) startX = 0;
      const drawW = Math.max(1, endX - startX);

      const mid = Math.floor(h * 0.52);
      const ampScale = h * 0.45;

      ctx.save();
      // Инвертируем ось времени: "звук исходит из кнопки" (новое слева, старое уезжает вправо)
      // Рисуем сплошной заливкой, без контура.
      const windowMs = Math.max(1000, Number(state.vizWindowMs || 10_000));
      function buildPoints(ptsAll){
        const points = [];
        if(!ptsAll || !ptsAll.length) return points;
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
        return points;
      }
      const pointsMic = buildPoints(ptsMicAll);
      const pointsMon = buildPoints(ptsMonAll);
      const nowDiag = Date.now();
      if(!state.drawDebugLastAtMs || (nowDiag - state.drawDebugLastAtMs) > 1000){
        state.drawDebugLastAtMs = nowDiag;
        sendDiag("draw", {
          micPoints: pointsMic.length,
          monitorPoints: pointsMon.length,
          micTarget: Number(state.micTarget || 0),
          monitorTarget: Number(state.monitorTarget || 0),
          canvas: { w: Math.round(canvasRect.width||0), h: Math.round(canvasRect.height||0) }
        });
      }
      function drawChannel(points, fillStyle, strokeStyle, target){
        if(!points || points.length < 2){
          if(target > 0.005){
            const p = { x: startX + Math.floor(drawW * 0.02), v: Math.pow(Math.max(0, Math.min(1, target)), 0.55) };
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = Math.max(1, Math.floor(1.2 * dpr));
            ctx.beginPath();
            ctx.moveTo(p.x, mid - p.v * ampScale);
            ctx.lineTo(p.x, mid + p.v * ampScale);
            ctx.stroke();
          }
          return;
        }

        ctx.globalAlpha = 0.9;
        ctx.fillStyle = fillStyle;

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

        ctx.globalAlpha = 0.92;
        ctx.lineWidth = Math.max(1, Math.floor(1.1 * dpr));
        ctx.strokeStyle = strokeStyle;
        ctx.beginPath();
        for(let i=0;i<points.length;i++){
          const p = points[i];
          const y = mid - p.v * ampScale;
          if(i===0) ctx.moveTo(p.x, y); else ctx.lineTo(p.x, y);
        }
        ctx.stroke();
      }

      // mic: жёлтый, monitor: синий
      drawChannel(pointsMon, "rgba(80,160,255,0.18)", "rgba(80,160,255,0.40)", Number(state.monitorTarget||0));
      drawChannel(pointsMic, "rgba(255,220,0,0.18)", "rgba(255,220,0,0.45)", Number(state.micTarget||0));

      ctx.restore();

    }

    setInterval(() => {
      // Резерв: если переключение зависло — не блокируем интерфейс навсегда
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
          sendAction({ kind: "recording.start", payload: payload });
          state.recording = true;
          state.startedAtMs = Date.now();
        }
      }
      render();
    }, 1000);

    // инициализация
    resetToInitial();
    state.lastStatus = "idle";
    // Если диалог открыт из напоминания/повестки (lockDefaultEvent) — предвыбираем экземпляр (occurrence).
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
}
