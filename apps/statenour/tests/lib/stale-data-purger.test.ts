/**
 * tests/lib/stale-data-purger.test.ts — purger contract invariants
 *
 * Locks down the purer pieces of lib/system/stale-data-purger.ts:
 *   - purgeStaleCategory rejects unknown ids (D6 safety)
 *   - the pending_actions_7d predicate itself (2026-08-12: promoted from
 *     an operator-tap action to an unsupervised nightly cron via
 *     data-cleanup, so the WHERE/DATA shape is now load-bearing — a
 *     flipped comparison or mistyped status would either let the queue
 *     regrow to the 468-row backlog or auto-reject rows that were never
 *     pending, weekly counts unsupervised either way)
 *   - buildDismissedContradictionContent emits canonical shape and
 *     correctly no-ops rows that are already resolved/dismissed (D5,
 *     D6, D9 fixes)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    autonomousAction: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  purgeStaleCategory,
  buildDismissedContradictionContent,
} from "@/lib/system/stale-data-purger";

describe("purgeStaleCategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws on unknown category", async () => {
    await expect(
      // @ts-expect-error — intentional invalid category for the guard
      purgeStaleCategory("not_a_real_category"),
    ).rejects.toThrow(/Unknown stale category/);
  });

  it("pending_actions_7d rejects ONLY pending rows older than 7 days", async () => {
    mockPrisma.autonomousAction.updateMany.mockResolvedValue({ count: 5 });

    const before = Date.now();
    const result = await purgeStaleCategory("pending_actions_7d");

    expect(mockPrisma.autonomousAction.updateMany).toHaveBeenCalledTimes(1);
    const args = mockPrisma.autonomousAction.updateMany.mock.calls[0][0] as {
      where: { approval: string; createdAt: { lt: Date } };
      data: Record<string, unknown>;
    };
    // The guard: never touch approved/rejected/auto rows.
    expect(args.where.approval).toBe("pending");
    // The window: strictly older than 7 days (±30s tolerance for run time).
    const cutoffMs = args.where.createdAt.lt.getTime();
    const sevenDaysAgo = before - 7 * 86_400_000;
    expect(Math.abs(cutoffMs - sevenDaysAgo)).toBeLessThan(30_000);
    // The transition: a status flip with the distinct bulk audit trail —
    // never a delete, never impersonating an operator verdict.
    expect(args.data).toEqual({ approval: "rejected", approvedBy: "auto-purge" });

    expect(result.category).toBe("pending_actions_7d");
    expect(result.purged).toBe(5);
    expect(result.note).toContain("5");
  });

  it("pending_actions_7d reports a genuine zero without inventing work", async () => {
    mockPrisma.autonomousAction.updateMany.mockResolvedValue({ count: 0 });
    const result = await purgeStaleCategory("pending_actions_7d");
    expect(result.purged).toBe(0);
  });
});

describe("buildDismissedContradictionContent", () => {
  const NOW_ISO = "2026-04-24T10:15:00.000Z";

  it("emits a dismissed record for an unresolved contradiction", () => {
    const input = JSON.stringify({
      status: "unresolved",
      why: "we said X but keep doing Y",
      text: "scroll scroll scroll",
    });
    const out = buildDismissedContradictionContent(input, NOW_ISO);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.status).toBe("dismissed");
    expect(parsed.resolved_at).toBe(NOW_ISO);
    expect(parsed.why).toContain("[auto-dismissed 2026-04-24 · stale >60d]");
    expect(parsed.why).toContain("we said X but keep doing Y");
    // Any extra fields on the original row are preserved.
    expect(parsed.text).toBe("scroll scroll scroll");
  });

  it("no-ops (returns null) when status is already resolved", () => {
    const input = JSON.stringify({ status: "resolved", why: "fixed it" });
    expect(buildDismissedContradictionContent(input, NOW_ISO)).toBeNull();
  });

  it("no-ops (returns null) when status is dismissed", () => {
    const input = JSON.stringify({ status: "dismissed", why: "ignored" });
    expect(buildDismissedContradictionContent(input, NOW_ISO)).toBeNull();
  });

  it("no-ops (returns null) when status is both_valid", () => {
    const input = JSON.stringify({ status: "both_valid", why: "context dep" });
    expect(buildDismissedContradictionContent(input, NOW_ISO)).toBeNull();
  });

  it("treats missing-status row as unresolved → dismiss", () => {
    const input = JSON.stringify({ why: "no status field" });
    const out = buildDismissedContradictionContent(input, NOW_ISO);
    expect(out).not.toBeNull();
    expect(JSON.parse(out as string).status).toBe("dismissed");
  });

  it("recovers from malformed JSON with a minimal dismissed record", () => {
    const out = buildDismissedContradictionContent("not even json {", NOW_ISO);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.status).toBe("dismissed");
    expect(parsed.resolved_at).toBe(NOW_ISO);
    expect(parsed.why).toContain("previously unparseable");
  });

  it("strips leading whitespace when original `why` is empty", () => {
    const input = JSON.stringify({ status: "unresolved" });
    const out = buildDismissedContradictionContent(input, NOW_ISO);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.why.startsWith("[auto-dismissed")).toBe(true);
  });

  it("uses the exact date slice (YYYY-MM-DD) in the marker", () => {
    const iso = "2099-12-31T23:59:59.000Z";
    const input = JSON.stringify({ status: "unresolved" });
    const out = buildDismissedContradictionContent(input, iso);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.why).toContain("2099-12-31");
    // And NOT the hour/minute/second portion
    expect(parsed.why).not.toContain("23:59");
  });
});
