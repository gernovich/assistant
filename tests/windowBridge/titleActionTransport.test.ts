import { describe, expect, it } from "vitest";
import { formatAssistantActionTitle, parseAssistantActionFromTitle } from "../../src/presentation/electronWindow/bridge/titleActionTransport";

describe("titleActionTransport", () => {
  it("parse: reminder actions", () => {
    const a = parseAssistantActionFromTitle("assistant-action:start_recording");
    expect(a.ok).toBe(true);
    if (!a.ok) throw new Error("expected ok");
    expect(a.action.kind).toBe("reminder.startRecording");

    const c = parseAssistantActionFromTitle("assistant-action:create_protocol");
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error("expected ok");
    expect(c.action.kind).toBe("reminder.createProtocol");

    const b = parseAssistantActionFromTitle("assistant-action:cancelled");
    expect(b.ok).toBe(true);
    if (!b.ok) throw new Error("expected ok");
    expect(b.action.kind).toBe("reminder.meetingCancelled");
  });

  it("parse: close", () => {
    const a = parseAssistantActionFromTitle("assistant-action:close");
    expect(a.ok).toBe(true);
    if (!a.ok) throw new Error("expected ok");
    expect(a.action.kind).toBe("close");
  });

  it("parse: recording controls", () => {
    const s = parseAssistantActionFromTitle("assistant-action:rec_stop");
    expect(s.ok).toBe(true);
    if (!s.ok) throw new Error("expected ok");
    expect(s.action.kind).toBe("recording.stop");

    const p = parseAssistantActionFromTitle("assistant-action:rec_pause");
    expect(p.ok).toBe(true);
    if (!p.ok) throw new Error("expected ok");
    expect(p.action.kind).toBe("recording.pause");

    const r = parseAssistantActionFromTitle("assistant-action:rec_resume");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.action.kind).toBe("recording.resume");
  });

  it("parse: recording start payload", () => {
    const payload = { mode: "manual_new" as const, protocolFilePath: "Ассистент/Протоколы/a.md" };
    const title = "assistant-action:rec_start:" + encodeURIComponent(JSON.stringify(payload));
    const a = parseAssistantActionFromTitle(title);
    expect(a.ok).toBe(true);
    if (!a.ok) throw new Error("expected ok");
    expect(a.action.kind).toBe("recording.start");
    if (a.action.kind !== "recording.start") throw new Error("unexpected kind");
    expect(a.action.payload.mode).toBe("manual_new");
    expect(a.action.payload.protocolFilePath).toBe("Ассистент/Протоколы/a.md");
  });

  it("parse: open_protocol payload", () => {
    const title = "assistant-action:open_protocol:" + encodeURIComponent("Ассистент/Протоколы/a.md");
    const a = parseAssistantActionFromTitle(title);
    expect(a.ok).toBe(true);
    if (!a.ok) throw new Error("expected ok");
    expect(a.action.kind).toBe("recording.openProtocol");
    if (a.action.kind !== "recording.openProtocol") throw new Error("unexpected kind");
    expect(a.action.protocolFilePath).toBe("Ассистент/Протоколы/a.md");
  });

  it("format: is backward compatible with existing strings", () => {
    expect(formatAssistantActionTitle({ kind: "close" })).toBe("assistant-action:close");
    expect(formatAssistantActionTitle({ kind: "reminder.startRecording" })).toBe("assistant-action:start_recording");
    expect(formatAssistantActionTitle({ kind: "reminder.createProtocol" })).toBe("assistant-action:create_protocol");
    expect(formatAssistantActionTitle({ kind: "reminder.meetingCancelled" })).toBe("assistant-action:cancelled");
    expect(formatAssistantActionTitle({ kind: "recording.stop" })).toBe("assistant-action:rec_stop");
    expect(formatAssistantActionTitle({ kind: "recording.pause" })).toBe("assistant-action:rec_pause");
    expect(formatAssistantActionTitle({ kind: "recording.resume" })).toBe("assistant-action:rec_resume");
  });

  it("parse: ignores non assistant-action titles", () => {
    const a = parseAssistantActionFromTitle("hello");
    expect(a.ok).toBe(false);
  });
});

