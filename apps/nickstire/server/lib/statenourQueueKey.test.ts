import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statenourQueueKey } from "./statenourQueueKey";

describe("statenourQueueKey", () => {
  it("prefers the scoped queue key", () => {
    expect(statenourQueueKey({ STATENOUR_QUEUE_KEY: "q", STATENOUR_SYNC_KEY: "s" } as NodeJS.ProcessEnv)).toBe("q");
  });
  it("falls back to the bridge key until the queue key is set", () => {
    expect(statenourQueueKey({ STATENOUR_SYNC_KEY: "s" } as NodeJS.ProcessEnv)).toBe("s");
  });
  it("is empty when neither is set (the router then refuses)", () => {
    expect(statenourQueueKey({} as NodeJS.ProcessEnv)).toBe("");
  });
});

describe("both Command Queue calls use it", () => {
  const src = readFileSync(resolve(__dirname, "../routers/content.ts"), "utf8");
  it("list and act read statenourQueueKey(), not the bridge key directly", () => {
    const calls = src.match(/const syncKey = statenourQueueKey\(\);/g) ?? [];
    expect(calls.length).toBe(2);
    expect(src).not.toMatch(/const syncKey = process\.env\.STATENOUR_SYNC_KEY/);
  });
});
