import { describe, expect, it } from "vitest";
import { extractEmailsFromTextPolicy } from "../../src/domain/policies/extractEmails";

describe("extractEmailsFromTextPolicy", () => {
  it("извлекает, нормализует и дедуплицирует email", () => {
    const text = "A: ME@EXAMPLE.com, B: me@example.com; other@test.io";
    expect(extractEmailsFromTextPolicy(text)).toEqual(["me@example.com", "other@test.io"]);
  });
});
