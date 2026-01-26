export type ReminderWindowHtmlParams = {
  kind: "before" | "start";
  hostWebContentsId?: number;
  cspConnectSrc: string[];

  initialStatusLine: string;
  initialTitleLine: string;
  detailsText: string;

  startIso: string;
  endIso: string;
  summary: string;
  location: string;
  urlLink: string;
  minutesBefore: number;
};

/**
 * Сгенерировать HTML для окна напоминания (data: URL).
 */
export function buildReminderWindowHtml(p: ReminderWindowHtmlParams): string {
  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const minutesBefore = Number.isFinite(Number(p.minutesBefore)) ? Math.max(0, Number(p.minutesBefore)) : 0;
  const hostId = Number.isFinite(Number(p.hostWebContentsId)) ? Math.floor(Number(p.hostWebContentsId)) : 0;
  const cspConnectSrc = Array.isArray(p.cspConnectSrc) && p.cspConnectSrc.length
    ? p.cspConnectSrc.join(" ")
    : "'none'";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src ${cspConnectSrc};" />
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif;
      background: rgba(0,0,0,0);
    }
    .card {
      margin: 14px;
      padding: 14px 14px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(24,24,24,0.86);
      color: rgba(255,255,255,0.92);
    }
    .title {
      font-weight: 750;
      margin-bottom: 32px;
      color: rgb(128, 128, 128);
      -webkit-app-region: drag;
      user-select: none;
      cursor: move;
    }
    .title.start { color: rgba(255, 92, 92, 0.98); }
    .headline { font-weight: 750; margin: 0 0 32px; }
    .headline.start { color: rgba(255, 92, 92, 0.98); }
    .details {
      white-space: pre-wrap;
      font-variant-numeric: tabular-nums;
      opacity: 0.92;
      line-height: 1.35;
      margin: 10px 0 12px;
    }
    .content { margin: 10px 0 10px; }
    .status { font-weight: 650; opacity: 0.92; margin: 6px 0 26px; }
    .status.start { color: rgba(255, 92, 92, 0.98); }
    .meeting-title { font-size: 26px; font-weight: 800; margin: 0; }
    .details { margin: 18px 0 12px; text-align: right; }
    .btns { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
    .btn-danger {
      background: rgba(40,40,40,0.10);
      border-color: rgba(255, 92, 92, 0.92);
      color: rgba(255, 92, 92, 0.98);
    }
    .btn-icon { opacity: 0.95; margin-right: 6px; }
    button {
      cursor: pointer;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(40,40,40,0.85);
      color: rgba(255,255,255,0.92);
      padding: 8px 10px;
      font-weight: 600;
      -webkit-app-region: no-drag;
    }
    button.cta {
      background: rgba(106, 132, 255, 0.9);
      border-color: rgba(106, 132, 255, 0.9);
      color: #0b1020;
    }
  </style>
</head>
<body>
  <div class="card">
    <div id="title" class="title">📅 Ассистент: Напоминание</div>
    <div class="content">
      <div id="status" class="status">${esc(p.initialStatusLine)}</div>
      <div id="meetingTitle" class="meeting-title">${esc(p.initialTitleLine)}</div>
      <div id="details" class="details">${esc(p.detailsText)}</div>
    </div>
    <div class="btns">
      <button onclick="sendAction({ kind: 'reminder.startRecording' })"><span class="btn-icon">🎙</span>Диктофон</button>
      <button onclick="sendAction({ kind: 'reminder.meetingCancelled' })"><span class="btn-icon">⊖</span>Встреча отменена</button>
      <button class="btn-danger" id="closeBtn"><span class="btn-icon">✕</span>Закрыть</button>
    </div>
  </div>
  <script>
    // Транспорт WindowTransport (рендер↔рендер) через preload window.__assistantTransport.
    (function(){
      const pending = new Map();
      const transport = window.__assistantTransport;
      function randId(){
        return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
      }
      window.__assistantIpcOnResponse = function(resp){
        try{
          const r = resp || {};
          const p = pending.get(String(r.id||""));
          if(!p) return;
          pending.delete(String(r.id||""));
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
          const p = new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
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

    try {
      const kind = ${JSON.stringify(p.kind)};
      const startMs = Date.parse(${JSON.stringify(p.startIso)});
      const endIso = ${JSON.stringify(p.endIso)};
      const summary = ${JSON.stringify(p.summary)};
      const location = ${JSON.stringify(p.location)};
      const url = ${JSON.stringify(p.urlLink)};
      const minutesBefore = ${minutesBefore};
      const hostId = ${hostId};

      function pad2(n){ return String(n).padStart(2,'0'); }
      function formatCountdownRu(diffMs){
        const d = Math.max(0, Math.floor(diffMs));
        const totalSec = Math.floor(d / 1000);
        const sec = totalSec % 60;
        const totalMin = Math.floor(totalSec / 60);
        if(totalMin < 60){
          return pad2(totalMin) + ":" + pad2(sec);
        }
        const min = totalMin % 60;
        const totalHours = Math.floor(totalMin / 60);
        if(totalHours < 24){
          return pad2(totalHours) + ":" + pad2(min) + ":" + pad2(sec);
        }
        const hours = totalHours % 24;
        const days = Math.floor(totalHours / 24);
        return String(days) + " дней " + pad2(hours) + ":" + pad2(min) + ":" + pad2(sec);
      }
      function fmtTime(ms){
        const d = new Date(ms);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      function fmtDateTime(iso){
        if(!iso) return '';
        const d = new Date(iso);
        return d.toLocaleString('ru-RU');
      }

      const titleEl = document.getElementById('title');
      const statusEl = document.getElementById('status');
      const meetingTitleEl = document.getElementById('meetingTitle');
      const detailsEl = document.getElementById('details');

      function eventLine(){
        return (summary || "");
      }

      function setDetails(){
        if(!detailsEl) return;
        const parts = [];
        parts.push("Начало: " + fmtDateTime(${JSON.stringify(p.startIso)}));
        if(endIso) parts.push("Конец: " + fmtDateTime(endIso));
        detailsEl.textContent = parts.join("\\n");
      }

      function setStartUi(){
        if(titleEl) titleEl.textContent = "📅 Ассистент: Напоминание";
        if(statusEl) statusEl.classList.add('start');
        if(statusEl) statusEl.textContent = "Уже началась";
        if(meetingTitleEl) meetingTitleEl.textContent = eventLine();
      }

      function setBeforeUi(){
        const now = Date.now();
        const diff = startMs - now;
        if(diff <= 0){
          setStartUi();
          return;
        }
        if(statusEl) statusEl.classList.remove('start');
        if(statusEl) statusEl.textContent = "Через " + formatCountdownRu(diff);
        if(meetingTitleEl) meetingTitleEl.textContent = eventLine();
      }

      setDetails();
      if(kind === 'start') {
        setStartUi();
      } else {
        // "Через X мин" -> живой отсчёт "Через M:SS"
        setBeforeUi();
        setInterval(setBeforeUi, 1000);
      }
      void minutesBefore;
      void location;
      void url;
      void fmtTime;

      // Обработчик кнопки закрытия
      const closeBtn = document.getElementById('closeBtn');
      if(closeBtn){
        closeBtn.addEventListener('click', () => {
          console.log('[Assistant] Reminder: кнопка закрыть нажата');
          console.log('[Assistant] Reminder: hostId:', hostId);
          console.log('[Assistant] Reminder: window.__assistantElectron:', window.__assistantElectron ? 'есть' : 'нет');
          console.log('[Assistant] Reminder: window.__assistantElectron?.sendTo:', window.__assistantElectron?.sendTo ? 'есть' : 'нет');
          
          const closeFallback = setTimeout(() => {
            try {
              window.close();
            } catch (e) {
              console.error('[Assistant] Reminder: не удалось закрыть окно:', e);
            }
          }, 600);
          sendAction({ kind: 'close' })
            .then(() => clearTimeout(closeFallback))
            .catch((err) => {
              clearTimeout(closeFallback);
              console.error('[Assistant] Reminder: ошибка при отправке действия close:', err);
              // Если IPC не работает, пытаемся закрыть окно напрямую через window.close()
              // Это может не сработать в Electron, но попробуем
              try {
                window.close();
              } catch (e) {
                console.error('[Assistant] Reminder: не удалось закрыть окно:', e);
              }
            });
        });
      }
    } catch {
      // Если скрипт упал/заблокирован — остаются тексты с сервера (заголовок/детали).
    }
  </script>
</body>
</html>`;
}
