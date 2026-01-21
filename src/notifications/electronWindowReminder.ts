import type { Event } from "../types";

type ElectronLike = {
  remote?: { BrowserWindow?: any };
  BrowserWindow?: any;
  screen?: { getPrimaryDisplay?: () => { workArea?: { width: number; height: number } } };
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Форматировать оставшееся время в виде:
 * - < 60 минут: "MM:SS"
 * - >= 60 минут и < 24 часа: "HH:MM:SS"
 * - >= 24 часа: "D дней HH:MM:SS"
 */
function formatCountdownRu(diffMs: number): string {
  const d = Math.max(0, Math.floor(diffMs));
  const totalSec = Math.floor(d / 1000);

  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);

  // < 60 минут -> MM:SS (minutes are 0..59)
  if (totalMin < 60) {
    return `${pad2(totalMin)}:${pad2(sec)}`;
  }

  const min = totalMin % 60;
  const totalHours = Math.floor(totalMin / 60);

  // < 24 часа -> HH:MM:SS
  if (totalHours < 24) {
    return `${pad2(totalHours)}:${pad2(min)}:${pad2(sec)}`;
  }

  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  return `${days} дней ${pad2(hours)}:${pad2(min)}:${pad2(sec)}`;
}

export function showElectronReminderWindow(params: {
  ev: Event;
  kind: "before" | "start";
  minutesBefore: number;
  actions?: {
    createProtocol?: (ev: Event) => unknown | Promise<unknown>;
    startRecording?: (ev: Event) => void | Promise<void>;
    meetingCancelled?: (ev: Event) => void | Promise<void>;
  };
}): void {
  const { ev, kind, minutesBefore, actions } = params;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let electron: ElectronLike | undefined;
  try {
    electron = require("electron") as ElectronLike;
  } catch {
    // В тестовой среде модуля `electron` нет. Разрешаем тестовый мок через globalThis.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    electron = (globalThis as any).__assistantElectronMock as ElectronLike | undefined;
  }
  const BrowserWindow = electron?.remote?.BrowserWindow ?? electron?.BrowserWindow;
  if (!BrowserWindow) {
    throw new Error("Electron BrowserWindow недоступен в этом окружении");
  }

  const timeoutMs = 25_000;

  // Не выносим это в настройки (просили фиксировать как часть UX).
  const opacity = 0.96;
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

  try {
    win.setAlwaysOnTop(true, "screen-saver");
  } catch {
    // ignore
  }

  try {
    win.setOpacity(opacity);
  } catch {
    // ignore
  }

  // Центрируем по workArea (если доступно)
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

  const esc = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const startIso = ev.start.toISOString();
  const endIso = ev.end ? ev.end.toISOString() : "";
  const summary = String(ev.summary ?? "");
  const location = String(ev.location ?? "");
  const urlLink = String(ev.url ?? "");

  const startMs = ev.start.getTime();
  const nowMs = Date.now();
  const initialDiffMs = startMs - nowMs;
  const initialEventLine = summary.trim();

  const initialStatusLine = kind === "start" || initialDiffMs <= 0 ? `Уже началась` : `Через ${formatCountdownRu(initialDiffMs)}`;
  const initialTitleLine = initialEventLine;

  const detailsText = [
    `Начало: ${ev.start.toLocaleString("ru-RU")}`,
    ev.end ? `Конец: ${ev.end.toLocaleString("ru-RU")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
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
      <div id="status" class="status">${esc(initialStatusLine)}</div>
      <div id="meetingTitle" class="meeting-title">${esc(initialTitleLine)}</div>
      <div id="details" class="details">${esc(detailsText)}</div>
    </div>
    <div class="btns">
      <button onclick="document.title='assistant-action:start_recording'"><span class="btn-icon">🎙</span>Диктофон</button>
      <button onclick="document.title='assistant-action:cancelled'"><span class="btn-icon">⊖</span>Встреча отменена</button>
      <button class="btn-danger" onclick="document.title='assistant-action:close'"><span class="btn-icon">✕</span>Закрыть</button>
    </div>
  </div>
  <script>
    try {
      const kind = ${JSON.stringify(kind)};
      const startMs = Date.parse(${JSON.stringify(startIso)});
      const endIso = ${JSON.stringify(endIso)};
      const summary = ${JSON.stringify(summary)};
      const location = ${JSON.stringify(location)};
      const url = ${JSON.stringify(urlLink)};
      const minutesBefore = ${Number.isFinite(Number(minutesBefore)) ? Math.max(0, Number(minutesBefore)) : 0};

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
        parts.push("Начало: " + fmtDateTime(${JSON.stringify(startIso)}));
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
    } catch {
      // Если скрипт упал/заблокирован — остаются сервер-сайд тексты (headline/details).
    }
  </script>
</body>
</html>`;

  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  void win.loadURL(url);

  const onAction = async (a: string) => {
    try {
      if (a === "create_protocol") await actions?.createProtocol?.(ev);
      if (a === "start_recording") await actions?.startRecording?.(ev);
      if (a === "cancelled") await actions?.meetingCancelled?.(ev);
    } finally {
      try {
        win.close();
      } catch {
        // ignore
      }
    }
  };

  win.webContents.on("page-title-updated", (e: unknown, title: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any)?.preventDefault?.();
    const t = String(title ?? "");
    const m = t.match(/^assistant-action:([a-z_]+)$/);
    if (!m) return;
    // Группа всегда есть, если regex совпал.
    void onAction(String(m[1]));
  });

  win.once("ready-to-show", () => {
    try {
      win.showInactive();
    } catch {
      win.show();
    }
  });

  window.setTimeout(() => {
    try {
      if (!win.isDestroyed()) win.close();
    } catch {
      // ignore
    }
  }, timeoutMs);
}

