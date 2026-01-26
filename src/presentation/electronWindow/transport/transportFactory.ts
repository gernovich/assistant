import type { WindowTransport } from "./windowTransport";
import { MessageChannelTransport } from "./messageChannelTransport";
import { MockTransport } from "./mockTransport";

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
  return new MockTransport();
}
