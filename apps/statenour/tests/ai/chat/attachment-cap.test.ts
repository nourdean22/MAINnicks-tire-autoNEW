/**
 * U5 (2026-10-30) · the chat route's own limit on a new message's inline attachments.
 *
 * Before: no server-side byte or count cap anywhere under the chat route; only client hints that a
 * modified client skips. Now the gate refuses (413) a newest message with more than 10 file parts
 * or more than ~18 MB of data: URLs. Older turns in the history are not re-checked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, resetAt: Date.now() + 60_000 })),
  getClientIp: vi.fn(() => "127.0.0.1"),
  RATE_LIMITS: { ai: { capacity: 10, refillPerMinute: 10 } },
}));
vi.mock("@/lib/services/power-panel", () => ({ checkAiBudget: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/ai/intent-classifier", () => ({ inferPersona: vi.fn(() => ({ persona: "master", confidence: 0.8 })) }));

import { runGate } from "@/lib/ai/chat/gate";
import { attachmentCapProblem, MAX_FILES_PER_MESSAGE, MAX_INLINE_CHARS } from "@/lib/ai/chat/attachment-cap";
import * as rateLimit from "@/lib/rate-limit";
import * as powerPanel from "@/lib/services/power-panel";

const photo = (chars = 100) => ({ type: "file", mediaType: "image/jpeg", url: `data:image/jpeg;base64,${"A".repeat(chars)}`, filename: "p.jpg" });
const userMsg = (files: unknown[]) => ({ id: "m1", role: "user", parts: [{ type: "text", text: "look" }, ...files] });
const post = (messages: unknown[]) =>
  new Request("https://test.local/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) });

beforeEach(() => {
  vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true, resetAt: Date.now() + 60_000 } as ReturnType<typeof rateLimit.checkRateLimit>);
  vi.mocked(powerPanel.checkAiBudget).mockResolvedValue({ allowed: true });
});

describe("attachment cap", () => {
  it("10 photos pass; 11 are refused, naming the limit", () => {
    expect(attachmentCapProblem(userMsg(Array.from({ length: MAX_FILES_PER_MESSAGE }, () => photo())))).toBeNull();
    expect(attachmentCapProblem(userMsg(Array.from({ length: 11 }, () => photo())))).toMatch(/At most 10 files/);
  });

  it("too many inline bytes are refused even with few files", () => {
    expect(attachmentCapProblem(userMsg([photo(MAX_INLINE_CHARS)]))).toMatch(/too large/);
  });

  it("the gate returns 413 for an over-cap newest message", async () => {
    const out = await runGate(post([userMsg(Array.from({ length: 11 }, () => photo()))]));
    expect(out.kind).toBe("block");
    if (out.kind === "block") {
      expect(out.response.status).toBe(413);
      expect(((await out.response.json()) as { error: string }).error).toMatch(/At most 10 files/);
    }
  });

  it("CONTROL: an old over-cap turn in the history does not block a new plain message", async () => {
    const old = { ...userMsg(Array.from({ length: 11 }, () => photo())), id: "m0" };
    const out = await runGate(post([old, { id: "a0", role: "assistant", parts: [{ type: "text", text: "ok" }] }, { id: "m2", role: "user", parts: [{ type: "text", text: "next" }] }]));
    expect(out.kind).toBe("pass");
  });

  it("older turns lose their inline bytes at the gate, whatever the client sent", async () => {
    const old = { ...userMsg([photo()]), id: "m0" };
    const out = await runGate(post([old, { id: "m2", role: "user", parts: [{ type: "text", text: "next" }] }]));
    expect(out.kind).toBe("pass");
    if (out.kind === "pass") {
      expect(JSON.stringify(out.messages)).not.toContain("data:");
      expect((out.messages[0].parts as Array<{ type: string }>)[1].type).toBe("text");
    }
  });

});
