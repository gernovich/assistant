import { describe, expect, it } from "vitest";
import { VAULT_EVENTS_DIR, VAULT_PEOPLE_DIR, VAULT_PROJECTS_DIR, VAULT_ROOT } from "../src/vault/vaultPaths";

describe("vaultPaths", () => {
  it("содержит дефолтные пути под корнем 'Ассистент'", () => {
    expect(VAULT_ROOT).toBe("Ассистент");
    expect(VAULT_PROJECTS_DIR).toBe("Ассистент/Проекты");
    expect(VAULT_PEOPLE_DIR).toBe("Ассистент/Люди");
    expect(VAULT_EVENTS_DIR).toBe("Ассистент/Встречи");
  });
});
