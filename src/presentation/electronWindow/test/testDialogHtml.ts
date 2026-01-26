export type TestDialogHtmlParams = {
  hostWebContentsId?: number;
  cspConnectSrc: string[];
};

/**
 * Сгенерировать HTML для тестового диалога (data: URL).
 */
export function buildTestDialogHtml(p: TestDialogHtmlParams): string {
  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
      margin-bottom: 16px;
      color: rgb(128, 128, 128);
      -webkit-app-region: drag;
    }
    .buttons {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    button {
      flex: 1;
      padding: 10px 16px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.92);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover {
      background: rgba(255,255,255,0.15);
    }
    button:active {
      background: rgba(255,255,255,0.20);
    }
    .test_transport_log_block {
      margin-top: 16px;
      padding: 12px;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 6px;
      background: rgba(0,0,0,0.3);
      min-height: 200px;
      max-height: 400px;
      overflow-y: auto;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: rgba(255,255,255,0.85);
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .test_transport_log_entry {
      margin-bottom: 4px;
      padding: 2px 0;
    }
    .test_transport_log_entry_time {
      color: rgba(255,255,255,0.5);
    }
    .test_transport_log_entry_sent {
      color: rgb(100, 200, 255);
    }
    .test_transport_log_entry_received {
      color: rgb(255, 200, 100);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">Dialog window transport</div>
    <div class="buttons">
      <button id="test_transport_btn_one">Dialog one</button>
      <button id="test_transport_btn_two">Dialog two</button>
      <button id="test_transport_btn_three">Dialog three</button>
    </div>
    <div class="buttons">
      <button id="test_transport_btn_close">Close</button>
    </div>
    <div class="test_transport_log_block" id="test_transport_log_block"></div>
  </div>
  <script>
    (function() {
      const hostId = ${hostId};
      const logBlock = document.getElementById('test_transport_log_block');
      const transport = window.__assistantTransport;
      
      function addLog(message, type) {
        const time = new Date().toLocaleTimeString('ru-RU', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
        const entry = document.createElement('div');
        entry.className = 'test_transport_log_entry';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'test_transport_log_entry_time';
        timeSpan.textContent = '[' + time + '] ';
        const msgSpan = document.createElement('span');
        msgSpan.className = type === 'sent' ? 'test_transport_log_entry_sent' : 'test_transport_log_entry_received';
        msgSpan.textContent = message;
        entry.appendChild(timeSpan);
        entry.appendChild(msgSpan);
        logBlock.appendChild(entry);
        logBlock.scrollTop = logBlock.scrollHeight;
      }
      
      function sendMessage(action) {
        console.log('[TestDialog] sendMessage вызван, action:', action);
        
        if (!transport || typeof transport.send !== 'function' || !transport.isReady()) {
          const err = 'ОШИБКА: транспорт еще не готов';
          console.error('[TestDialog]', err);
          addLog(err, 'sent');
          return;
        }
        
        const message = {
          id: 'test-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          ts: Date.now(),
          action: action
        };
        
        addLog('test_transport_send: ' + JSON.stringify(action), 'sent');
        console.log('[TestDialog] отправляю сообщение через транспорт:', message);
        
        try {
          transport.send({ type: 'window/request', payload: message });
          console.log('[TestDialog] сообщение отправлено через транспорт');
        } catch (e) {
          const err = 'ОШИБКА при отправке через транспорт: ' + String(e);
          console.error('[TestDialog]', err, e);
          addLog(err, 'sent');
        }
      }

      function sendClose() {
        try {
          const id = 'close-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
          const req = { id: id, ts: Date.now(), action: { kind: 'close' } };
          if (transport && transport.send && transport.isReady && transport.isReady()) {
            transport.send({ type: 'window/request', payload: req });
          } else {
            window.close();
          }
        } catch {
          try { window.close(); } catch {}
        }
      }
      
      console.log('[TestDialog] test_transport_init, hostId:', hostId);
      if (transport && typeof transport.onMessage === 'function') {
        transport.onMessage((data) => {
          console.log('[TestDialog] test_transport_recv:', data);
          try {
            if (data && data.type === 'test/message') {
              addLog('test_transport_recv: ' + JSON.stringify(data.payload || data), 'received');
            }
          } catch (e) {
            console.error('[TestDialog] ошибка при обработке сообщения:', e);
            addLog('ОШИБКА при обработке сообщения: ' + String(e), 'received');
          }
        });
        transport.onReady(() => {
          addLog('test_transport_ready', 'received');
        });
      } else {
        const warn = 'ПРЕДУПРЕЖДЕНИЕ: window.__assistantTransport недоступен';
        console.warn('[TestDialog]', warn);
        addLog(warn, 'sent');
      }
      
      document.getElementById('test_transport_btn_one').addEventListener('click', () => {
        sendMessage({ kind: 'test.dialogOne' });
      });
      
      document.getElementById('test_transport_btn_two').addEventListener('click', () => {
        sendMessage({ kind: 'test.dialogTwo' });
      });
      
      document.getElementById('test_transport_btn_three').addEventListener('click', () => {
        sendMessage({ kind: 'test.dialogThree' });
      });

      document.getElementById('test_transport_btn_close').addEventListener('click', () => {
        sendClose();
      });
      
      addLog('test_transport_dialog_init', 'sent');
      console.log('[TestDialog] test_transport_ready');
    })();
  </script>
</body>
</html>`;
}
