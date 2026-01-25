import type { WindowTransport, TransportConfig } from "./windowTransport";
import { WebSocketTransport } from "./webSocketTransport";

export class TransportRegistry {
  constructor(
    private deps: {
      randomHex: () => string;
    },
  ) {}

  createDialogTransport(params: { webContents: any; hostWebContentsId: number }): WindowTransport {
    const host = "127.0.0.1";
    const port = 0;
    const path = `/assistant-dialog/${this.deps.randomHex()}`;
    return new WebSocketTransport({ host, port, path });
  }

  getDialogConfig(transport: WindowTransport): TransportConfig | null {
    return transport.getConfig();
  }

  // No electron access needed for WS transport.
}
