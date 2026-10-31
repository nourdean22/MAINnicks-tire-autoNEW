/**
 * "Push Latest Config" keeps an auto-promoted prompt edit (self-learning W2, 2026-10-31).
 *
 * The nightly loop pushes only the live system prompt. updateAssistant rebuilds
 * the prompt from the code constant, so without the overlay Nour's next manual
 * push would silently revert a promoted edit. When the code has moved and the
 * edit no longer fits, code wins and the push says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ overlay: null as null | { find: string; replace: string; versionId: string }, overlayFails: false }));
vi.mock("./services/nickMemory", () => ({ getPromptLessons: async () => "" }));

import { OVERLAY_KEY, promotionKv } from "./services/receptionistPromotion";
import { ASSISTANT_SYSTEM_PROMPT, updateAssistant } from "./services/vapi";

function stubVapi() {
  const patches: Array<{ model: { messages: Array<{ content: string }> } }> = [];
  vi.stubEnv("VAPI_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit = {}) => {
    if ((init.method ?? "GET").toUpperCase() === "PATCH") {
      const body = JSON.parse(String(init.body));
      patches.push(body);
      return new Response(JSON.stringify(body), { status: 200 });
    }
    const last = patches[patches.length - 1] as { metadata?: unknown } | undefined;
    return new Response(JSON.stringify({ model: { tools: [] }, metadata: last?.metadata }), { status: 200 });
  }));
  return patches;
}

// A real line of the code prompt, so the overlay is exercised against the text the push sends.
const LINES = ASSISTANT_SYSTEM_PROMPT.split("\n");
const AT = LINES.findIndex((l, i) => i > 0 && l.trim().length > 20 && LINES.indexOf(l) === i && LINES.lastIndexOf(l) === i);
const FIND = LINES.slice(AT - 1, AT + 2).join("\n");
const REPLACE = [LINES[AT - 1], `${LINES[AT]} (learned)`, LINES[AT + 1]].join("\n");

beforeEach(() => {
  mocks.overlay = null;
  mocks.overlayFails = false;
  // The kv row is the seam: the real reader and applier run on top of it.
  vi.spyOn(promotionKv, "get").mockImplementation(async (key: string) => {
    if (key !== OVERLAY_KEY) return null;
    if (mocks.overlayFails) throw new Error("db down");
    return mocks.overlay ? JSON.stringify(mocks.overlay) : null;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("updateAssistant and the promoted overlay", () => {
  it("no promoted edit: the code prompt is pushed unchanged", async () => {
    const patches = stubVapi();
    const res = await updateAssistant("asst-1", "https://nickstire.org/api/webhooks/vapi");
    expect(res.success).toBe(true);
    expect(patches[0].model.messages[0].content).toBe(ASSISTANT_SYSTEM_PROMPT);
  });

  it("a promoted edit that fits is carried into the manual push", async () => {
    mocks.overlay = { find: FIND, replace: REPLACE, versionId: "v-1" };
    const patches = stubVapi();
    const res = await updateAssistant("asst-1", "https://nickstire.org/api/webhooks/vapi");
    expect(res.success).toBe(true);
    expect(patches[0].model.messages[0].content).toBe(ASSISTANT_SYSTEM_PROMPT.replace(FIND, REPLACE));
    expect(res.warning ?? "").not.toMatch(/auto-promoted/);
  });

  it("an edit that no longer fits the code: code wins, and the push says so", async () => {
    mocks.overlay = { find: "text that is not in the prompt", replace: "x", versionId: "v-2" };
    const patches = stubVapi();
    const res = await updateAssistant("asst-1", "https://nickstire.org/api/webhooks/vapi");
    expect(res.success).toBe(true);
    expect(patches[0].model.messages[0].content).toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(res.warning).toMatch(/auto-promoted edit v-2 no longer fits/);
  });

  it("an unreadable overlay never blocks the push; it says the edit may be dropped", async () => {
    mocks.overlayFails = true;
    const patches = stubVapi();
    const res = await updateAssistant("asst-1", "https://nickstire.org/api/webhooks/vapi");
    expect(res.success).toBe(true);
    expect(patches[0].model.messages[0].content).toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(res.warning).toMatch(/auto-promoted edit could not be read/);
  });
});
