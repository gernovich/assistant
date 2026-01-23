import { describe, expect, it } from "vitest";
import { yamlStringArrayLines } from "../../src/domain/policies/frontmatterYaml";

describe("domain/policies/frontmatterYaml", () => {
  it("пустой массив -> key: []", () => {
    expect(yamlStringArrayLines({ key: "k", values: [], escape: (s) => s })).toEqual(["k: []"]);
  });

  it("непустой массив -> многострочный YAML список", () => {
    expect(yamlStringArrayLines({ key: "k", values: ["a", "b"], escape: (s) => s })).toEqual(["k:", "  - a", "  - b"]);
  });

  it("использует escape для значений", () => {
    expect(yamlStringArrayLines({ key: "k", values: ["a"], escape: () => "X" })).toEqual(["k:", "  - X"]);
  });
});
