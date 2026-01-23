import type { EventKey } from "./eventKey";

/**
 * ProtocolId — идентичность протокола.
 *
 * В проекте исторически это равно EventKey (`calendar_id:event_id`),
 * но держим отдельный бренд, чтобы явно выражать смысл.
 */
export type ProtocolId = string & { readonly __brand: "ProtocolId" };

export function protocolIdFromEventKey(eventKey: EventKey): ProtocolId {
  return String(eventKey) as ProtocolId;
}
