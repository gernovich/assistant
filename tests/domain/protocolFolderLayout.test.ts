import { describe, expect, test } from "vitest";
import { protocolTargetDir } from "../../src/domain/policies/protocolFolderLayout";

describe("protocolTargetDir", () => {
  test("protocol without meeting goes to root protocolsDir", () => {
    expect(protocolTargetDir({ protocolsDir: "Ассистент/Протоколы" })).toBe("Ассистент/Протоколы");
    expect(protocolTargetDir({ protocolsDir: "Ассистент/Протоколы/" })).toBe("Ассистент/Протоколы");
  });

  test("protocol from meeting goes to meeting basename subfolder", () => {
    expect(
      protocolTargetDir({
        protocolsDir: "Ассистент/Протоколы",
        meetingFilePath: "Ассистент/Встречи/Планёрка [abc].md",
      }),
    ).toBe("Ассистент/Протоколы/Планёрка [abc]");
  });

  test("if meetingFilePath missing, falls back to root", () => {
    expect(protocolTargetDir({ protocolsDir: "Ассистент/Протоколы" })).toBe("Ассистент/Протоколы");
  });
});

