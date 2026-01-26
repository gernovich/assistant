import type { WindowTransport, TransportConfig } from "./windowTransport";
import { WebSocketTransport } from "./webSocketTransport";
import { MessageChannelTransport } from "./messageChannelTransport";

export class TransportRegistry {
  constructor(
    private deps: {
      randomHex: () => string;
    },
  ) {}

  createDialogTransport(params: { webContents: any; hostWebContentsId: number }): WindowTransport {
    const { webContents } = params;
    let MessageChannelMain: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require("electron");
      MessageChannelMain = electron?.MessageChannelMain ?? electron?.remote?.MessageChannelMain ?? null;
    } catch {
      MessageChannelMain = null;
    }
    if (MessageChannelMain) {
      return new MessageChannelTransport({ messageChannelMain: MessageChannelMain, webContents });
    }
    const host = "127.0.0.1";
    const port = 0;
    const path = `/assistant-dialog/${this.deps.randomHex()}`;
    return new WebSocketTransport({ host, port, path });
  }

  getDialogConfig(transport: WindowTransport): TransportConfig | null {
    return transport.getConfig();
  }

  // Для WS-транспорта не нужен доступ к Electron API.
}
