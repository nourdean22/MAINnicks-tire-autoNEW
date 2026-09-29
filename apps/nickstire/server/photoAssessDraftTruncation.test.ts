/**
 * F4a · the photo-assess reply AUTO-SENDS, and it used to adopt a NickGPT draft
 * with `draft.slice(0, 300)` — a cut mid-sentence by a second route. Now a draft
 * is adopted only when the provider confirmed it finished AND it fits whole;
 * otherwise the operator-vetted template goes out. Never a sliced draft.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDraft = vi.fn();
const mockOrchestrate = vi.fn();
vi.mock("./services/vision-analyzer", () => ({
  analyzePhoto: async () => ({ ok: true, description: "worn tread", serviceSuggest: "unclear", urgency: "low", latencyMs: 1, source: "test" }),
}));
vi.mock("./sms", () => ({ sendSms: vi.fn() }));
vi.mock("./services/nickgpt-client", () => ({ draftSmsReply: (...a: unknown[]) => mockDraft(...a) }));
vi.mock("./services/smsOrchestrator", () => ({ orchestrateSms: (...a: unknown[]) => mockOrchestrate(...a) }));

import { runPhotoAssess, DEFAULT_REPLIES_FOR_TEST } from "./services/photo-assess-pipeline";

const TEMPLATE = DEFAULT_REPLIES_FOR_TEST.unclear;
const FINISHED = "Got the photo, thanks. Bring it by for a free check and we'll tell you where it stands.";
const sentText = () => (mockOrchestrate.mock.calls[0][0] as { replyText: string }).replyText;
const run = () => runPhotoAssess({ phone: "2165550088", photoUrl: "https://example.test/p.jpg", source: "manual" } as never);

describe("runPhotoAssess · F4a no truncated draft is sent", () => {
  beforeEach(() => {
    mockDraft.mockReset();
    mockOrchestrate.mockReset().mockResolvedValue({ status: "sent" });
  });

  it("positive control: a finished NickGPT draft that fits is sent whole", async () => {
    mockDraft.mockResolvedValue({ ok: true, draft: FINISHED, source: "nickgpt-ollama", completion: "complete" });
    await run();
    expect(sentText()).toBe(FINISHED);
  });

  it.each(["truncated", "unknown", undefined])("a %s-completion draft falls back to the template", async (completion) => {
    mockDraft.mockResolvedValue({ ok: true, draft: FINISHED, source: "nickgpt-ollama", completion });
    await run();
    expect(sentText()).toBe(TEMPLATE);
  });

  it("an over-length finished draft is not sliced — the template goes out", async () => {
    const long = `${"We looked at the photo closely. ".repeat(12)}Bring it by.`;
    expect(long.length).toBeGreaterThan(300);
    mockDraft.mockResolvedValue({ ok: true, draft: long, source: "nickgpt-ollama", completion: "complete" });
    await run();
    expect(sentText()).toBe(TEMPLATE);
  });
});
