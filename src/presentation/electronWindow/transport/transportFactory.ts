import type { WindowTransport } from "./windowTransport";
import { WebSocketTransport } from "./webSocketTransport";
import { MessageChannelTransport } from "./messageChannelTransport";

export function createDialogTransport(params?: { webContents?: any; channelName?: string }): WindowTransport {
  let MessageChannelMain: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron");
    MessageChannelMain = electron?.MessageChannelMain ?? electron?.remote?.MessageChannelMain ?? null;
  } catch {
    MessageChannelMain = null;
  }
  if (MessageChannelMain && params?.webContents) {
    return new MessageChannelTransport({
      messageChannelMain: MessageChannelMain,
      webContents: params.webContents,
      channelName: params.channelName,
    });
  }
  const host = "127.0.0.1";
  const port = 0;
  const path = "/assistant-dialog";
  return new WebSocketTransport({ host, port, path });
}
