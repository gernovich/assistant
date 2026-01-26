import type { WindowTransport, TransportConfig } from "./windowTransport";
import { MessageChannelTransport } from "./messageChannelTransport";
import { MockTransport } from "./mockTransport";

export class TransportRegistry {
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
      return new MessageChannelTransport({
        messageChannelMain: MessageChannelMain,
        webContents,
      });
    }
    return new MockTransport();
  }

  getDialogConfig(transport: WindowTransport): TransportConfig | null {
    return transport.getConfig();
  }

}
