/**
 * Bug hunt over the full-circle waves · 2026-10-02
 *
 * One file for the fixes that are small enough not to need their own suite.
 * Each test names the failure it pins.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const m = vi.hoisted(() => ({ findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { intelligenceOutcome: { findFirst: m.findFirst, findUnique: m.findUnique, updateMany: m.updateMany } },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { recordDecisionByContent, recordDecisionFromEvidence } from "@/lib/services/outcome-ledger";
import { webhookErrorIsLive, LIVE_ERROR_WINDOW_MS } from "@/lib/services/telegram-webhook-status";

beforeEach(() => {
  m.findFirst.mockReset();
  m.findUnique.mockReset();
  m.updateMany.mockReset();
});

describe("decide-by-content never walks back onto an older row", () => {
  it("a second act on today's already-decided row is refused — yesterday's row is never touched", async () => {
    m.findFirst.mockResolvedValue({ id: "today" }); // newest row for the text, already decided
    m.updateMany.mockResolvedValue({ count: 0 }); // the CAS refuses it
    expect(await recordDecisionByContent("3 unreviewed skill candidates", "dismissed")).toBe(false);
    expect(m.updateMany).toHaveBeenCalledOnce();
    expect(m.updateMany.mock.calls[0][0].where.id).toBe("today");
    expect(m.findFirst.mock.calls[0][0].where).not.toHaveProperty("decision");
  });
});

describe("a dismissal never inherits the task it named", () => {
  it("dismissed decides with no resultRef and never reads evidence", async () => {
    m.updateMany.mockResolvedValue({ count: 1 });
    await recordDecisionFromEvidence("row", "dismissed");
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.updateMany.mock.calls[0][0].data.resultRef).toBeUndefined();
  });

  it("control: accepted still carries the evidence task", async () => {
    m.findUnique.mockResolvedValue({ evidenceRefs: { taskId: "t1" } });
    m.updateMany.mockResolvedValue({ count: 1 });
    await recordDecisionFromEvidence("row", "accepted");
    expect(m.updateMany.mock.calls[0][0].data.resultRef).toBe("task:t1");
  });
});

describe("a stale Telegram error is history, not a live failure", () => {
  const now = Date.parse("2026-10-02T16:00:00Z");
  it("an error from last week with nothing pending is not live", () => {
    expect(webhookErrorIsLive({ lastErrorAt: "2026-09-25T10:00:00Z", pendingUpdates: 0 }, now)).toBe(false);
  });
  it("a recent error, or updates piling up, is live", () => {
    expect(webhookErrorIsLive({ lastErrorAt: new Date(now - LIVE_ERROR_WINDOW_MS / 2).toISOString(), pendingUpdates: 0 }, now)).toBe(true);
    expect(webhookErrorIsLive({ lastErrorAt: "2026-09-25T10:00:00Z", pendingUpdates: 12 }, now)).toBe(true);
  });
});

describe("source pins for fixes that live in SQL text or prompts", () => {
  it("task-timing reads the real deleted_at column and logs a failed read", () => {
    const src = read("lib/personal/task-timing-predictor.ts");
    expect(src).toContain("AND deleted_at IS NULL");
    expect(src).not.toContain('"deletedAt" IS NULL');
    expect(src).toContain("completions read failed");
  });
  it("semantic-link binds a Date, not text, against created_at", () => {
    const src = read("lib/brain/semantic-link.ts");
    expect(src).not.toContain("since7d.toISOString()");
  });
  it("the combined brief and the proactive pushes ledger a DATED summary", () => {
    expect(read("lib/inngest/functions/intelligence-brief.ts")).toContain("summary: `daily brief ${briefContent.date} · ");
    expect(read("lib/brain/proactive-pushes.ts")).toMatch(/summary: `\$\{new Date\(\)\.toLocaleDateString\("en-CA"/);
  });
  it("diagnose-cron-failure leaves declared degradation to the owner panel", () => {
    const src = read("lib/inngest/functions/diagnose-cron-failure.ts");
    expect(src.match(/DECLARED_DEGRADATION_PREFIX/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it("an Inngest-scheduled cron has no manual HTTP path — said, not 404", () => {
    expect(read("lib/services/cron-control.ts")).toContain("if (!def.path && def.inngest)");
    expect(read("lib/trpc/routers/system/cron.ts").match(/err instanceof ServiceError/g)?.length).toBe(2);
  });
  it("the integrations list excludes capability receipts", () => {
    expect(read("lib/services/system-pages.ts")).toContain('where: { type: { not: "capability" } }');
  });
  it("Home's waiting rail asks only for the buckets it renders", () => {
    expect(read("components/home/waiting-line.tsx")).toContain('useQuery({ scope: "rail" }');
  });
  it("skill nudges and the capability chip point where those surfaces live now", () => {
    const nudge = read("lib/brain/cross-system-nudge.ts");
    expect(nudge).not.toContain("triage in /settings");
    expect(nudge.match(/link: "\/brain\?tab=memory"/g)?.length).toBe(2);
    expect(read("features/chat-v2/components/chat-capability-indicator.tsx")).toContain('href="/system/health"');
  });
});
