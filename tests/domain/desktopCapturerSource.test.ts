import { describe, expect, it } from "vitest";
import { pickDesktopCapturerSourceId } from "../../src/domain/policies/desktopCapturerSource";

describe("domain/policies/desktopCapturerSource", () => {
  it("prefers browser window by name", () => {
    const id = pickDesktopCapturerSourceId([{ id: "1", name: "Screen 1" }, { id: "2", name: "Chrome" }]);
    expect(id).toBe("2");
  });

  it("falls back to screen/entire", () => {
    const id = pickDesktopCapturerSourceId([{ id: "1", name: "Entire Screen" }]);
    expect(id).toBe("1");
  });
});

