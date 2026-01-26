import type { WindowRequest, WindowResponse, WindowTransportMessage } from "./windowBridgeContracts";
import { WindowRequestSchema } from "../../../shared/validation/windowRequestResponseSchemas";
import type { WindowTransport } from "../transport/windowTransport";

export function installWindowTransportRequestBridge(params: {
  transport: WindowTransport;
  timeoutMs?: number;
  onRequest: (req: WindowRequest) => void | Promise<void>;
}): () => void {
  const timeoutMs = Math.max(50, Math.floor(Number(params.timeoutMs ?? 3000)));

  const handler = (msg: unknown) => {
    const envelope = msg as WindowTransportMessage | null;
    if (!envelope || envelope.type !== "window/request") return;
    const payload = envelope.payload;
    const parsed = WindowRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const badId = typeof (payload as any)?.id === "string" ? String((payload as any).id) : "";
      if (badId) {
        const resp: WindowResponse = {
          id: badId,
          ok: false,
          error: { code: "E_VALIDATION", message: "Ассистент: некорректный запрос окна" },
        };
        params.transport.send({ type: "window/response", payload: resp } satisfies WindowTransportMessage);
      }
      return;
    }

    const req = parsed.data as WindowRequest;
    const okResp: WindowResponse = { id: req.id, ok: true };
    params.transport.send({ type: "window/response", payload: okResp } satisfies WindowTransportMessage);

    void Promise.race([
      Promise.resolve().then(() => params.onRequest(req)),
      new Promise<void>((_, rej) => setTimeout(() => rej("timeout"), timeoutMs)),
    ]).catch((err) => {
      const resp: WindowResponse = {
        id: req.id,
        ok: false,
        error: { code: "E_TIMEOUT", message: "Ассистент: операция не успела завершиться", cause: String(err) },
      };
      params.transport.send({ type: "window/response", payload: resp } satisfies WindowTransportMessage);
    });
  };

  const unsub = params.transport.onMessage(handler);
  return () => {
    try {
      unsub();
    } catch {
      // Игнорируем ошибки отписки.
    }
  };
}
