import { describe, expect, it } from "vitest";
import { rsvpStatusBadgeRu } from "../../src/domain/policies/rsvpStatusBadgeRu";

describe("domain/policies/rsvpStatusBadgeRu", () => {
  it("маппит rsvp статусы в badge строки (совместимо с AgendaView)", () => {
    expect(rsvpStatusBadgeRu("accepted")).toBe(" • принято");
    expect(rsvpStatusBadgeRu("declined")).toBe(" • отклонено");
    expect(rsvpStatusBadgeRu("tentative")).toBe(" • возможно");
    expect(rsvpStatusBadgeRu("needs_action")).toBe(" • нет ответа");
    expect(rsvpStatusBadgeRu(undefined)).toBe("");
  });
});

