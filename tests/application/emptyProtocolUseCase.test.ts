import { describe, expect, it, vi } from "vitest";
import { EmptyProtocolUseCase } from "../../src/application/protocols/emptyProtocolUseCase";

describe("EmptyProtocolUseCase", () => {
  it("создаёт пустой протокол и открывает его", async () => {
    const file = { path: "p.md" } as any;
    const createEmptyProtocol = vi.fn().mockResolvedValue(file);
    const openProtocol = vi.fn().mockResolvedValue(undefined);

    const uc = new EmptyProtocolUseCase({ protocols: { createEmptyProtocol, openProtocol } as any });
    await uc.createAndOpen();

    expect(createEmptyProtocol).toHaveBeenCalledTimes(1);
    expect(openProtocol).toHaveBeenCalledWith(file);
  });
});
