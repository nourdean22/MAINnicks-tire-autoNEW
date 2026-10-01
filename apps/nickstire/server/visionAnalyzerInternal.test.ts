/**
 * analyzePhoto · internal callers bypass the MMS feature flag (2026-10-01).
 *
 * POSITIVE CONTROL: with `photo_assess_enabled` OFF and no `internal` flag,
 * analyzePhoto returns reason "disabled" before touching any provider — the
 * exact result the IG autopost critic received in a prod where the MMS flag
 * was never armed, which igVisualQaGate turns into a HOLD of every
 * autonomous static post. With `internal: true` + an explicit provider the
 * call reaches the provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./services/featureFlags", () => ({ isEnabled: async () => false }));

import { analyzePhoto } from "./services/vision-analyzer";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Clean studio shot of a tire. SCORE: 81" } }] }) } as unknown as Response;
    }
    return { ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) } as unknown as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("analyzePhoto and the photo_assess_enabled flag", () => {
  it("POSITIVE CONTROL: MMS-lane call with the flag off is 'disabled' and calls no provider", async () => {
    const r = await analyzePhoto({ photoUrl: "https://cdn.nickstire.org/generated/x.jpg", prompt: "rate", provider: "gemini" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => String(c[0]).includes("generativelanguage"))).toBe(false);
  });
  it("internal caller with an explicit provider reaches the provider despite the flag", async () => {
    const r = await analyzePhoto({ photoUrl: "https://cdn.nickstire.org/generated/x.jpg", prompt: "rate", provider: "gemini", internal: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.description).toMatch(/SCORE: 81/);
  });
  it("internal without an explicit provider does NOT bypass the flag", async () => {
    const r = await analyzePhoto({ photoUrl: "https://cdn.nickstire.org/generated/x.jpg", prompt: "rate", internal: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
  });
});
