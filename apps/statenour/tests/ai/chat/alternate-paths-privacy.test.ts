import { describe, expect, it } from "vitest";
import { runAlternatePaths } from "@/app/api/ai/chat/alternate-paths";

describe("alternate chat paths and Private Lab", () => {
  it("falls through before hidden alternate model calls in private mode", async () => {
    const result = await runAlternatePaths({ privateMode: true } as never);

    expect(result).toBeNull();
  });
});
