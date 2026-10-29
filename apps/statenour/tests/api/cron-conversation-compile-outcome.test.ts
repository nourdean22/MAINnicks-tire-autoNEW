/**
 * conversation-compile reports a failed or partial sweep as a failure
 * (Codex P1 on PR 3351). cron-manager files a red row only for an explicit
 * `ok: false`; without it a night whose digests all failed logged success
 * with resultCount 0, the same row a night with no work writes.
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ sweep: vi.fn() }));
vi.mock("@/lib/utils/http", () => ({ cronHandler: (fn: () => Promise<unknown>) => fn }));
vi.mock("@/lib/brain/conversation-memory", () => ({ summarizeIdleConversations: h.sweep }));

import { GET } from "@/app/api/cron/conversation-compile/route";

const run = GET as unknown as () => Promise<Record<string, unknown>>;

describe("conversation-compile cron outcome", () => {
  it("a sweep with failed compiles returns ok: false with a reason", async () => {
    h.sweep.mockResolvedValue({ eligible: 3, compiled: 1, skipped: 0, failed: 2, conversationIds: [] });
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("2 of 3 conversation compiles failed");
    expect(out.resultCount).toBe(1);
  });

  it("CONTROL · a clean sweep, including one with no work, is not a failure", async () => {
    h.sweep.mockResolvedValue({ eligible: 0, compiled: 0, skipped: 0, failed: 0, conversationIds: [] });
    const out = await run();
    expect(out.ok).not.toBe(false);
    expect(out.resultCount).toBe(0);
  });
});
