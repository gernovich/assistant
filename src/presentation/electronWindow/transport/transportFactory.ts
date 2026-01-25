import type { WindowTransport } from "./windowTransport";
import { WebSocketTransport } from "./webSocketTransport";

export function createDialogTransport(): WindowTransport {
  const host = "127.0.0.1";
  const port = 0;
  const path = "/assistant-dialog";
  return new WebSocketTransport({ host, port, path });
}
