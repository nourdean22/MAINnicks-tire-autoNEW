/**
 * Page leave / dwell (2026-10-23, usage telemetry).
 *
 * page_visit records an OPEN; nothing recorded the visit ending, so "what does Nour do inside a page"
 * had no data. A leave is its own `page_leave` AuditEvent (never a page_visit: page-intelligence, the
 * page-visit GET, the pipeline's late-night count and system-actions all count page_visit rows).
 * `detail` is the bare path; dwellMs, the reason it ended and the ET hour ride in `payload`. The reader
 * is Appendix E query 1 in docs/research/2026-10-23-brain-usage-map-appendix-e.md: it groups
 * payload->>'page' and reads payload->>'dwellMs', so those key names are pinned here.
 * Assertions read what prisma was asked to STORE.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { create } } }));

import { recordPageLeave } from "@/lib/services/brain-domain";
import { MAX_DWELL_MS } from "@/lib/brain/page-dwell";

const stored = () => create.mock.calls[0][0].data as { actor: string; eventType: string; detail: string; payload: Record<string, unknown> };

// Braces matter: a beforeEach that RETURNS the mock is registered by vitest as its teardown and called
// again after the test, which re-threw the "db down" rejection as a test failure.
beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "evt" });
});

describe("recordPageLeave", () => {
  it("writes one page_leave row: detail is the bare path, payload carries dwellMs and the reason", async () => {
    await recordPageLeave({ page: "/chat", dwellMs: 42_000, reason: "route" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(stored().eventType).toBe("page_leave");
    expect(stored().actor).toBe("page_tracker");
    expect(stored().detail).toBe("/chat");
    expect(stored().payload).toMatchObject({ page: "/chat", dwellMs: 42_000, reason: "route" });
    expect(typeof stored().payload.hour).toBe("number");
  });

  it("caps a sleeping-laptop dwell at 4 hours and says it was capped", async () => {
    await recordPageLeave({ page: "/", dwellMs: 7 * 24 * 3_600_000, reason: "pagehide" });
    expect(MAX_DWELL_MS).toBe(4 * 3_600_000);
    expect(stored().payload.dwellMs).toBe(MAX_DWELL_MS);
    expect(stored().payload.capped).toBe(true);
  });

  it("a dwell under the cap is not marked capped", async () => {
    await recordPageLeave({ page: "/", dwellMs: 1_000, reason: "hidden" });
    expect(stored().payload.capped).toBe(false);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "5000" as unknown as number])(
    "writes nothing for a dwell that is not a non-negative finite number (%s)",
    async (dwellMs) => {
      const r = await recordPageLeave({ page: "/chat", dwellMs, reason: "route" });
      expect(create).not.toHaveBeenCalled();
      expect(r.ok).toBe(false);
    },
  );

  it("writes nothing for an unknown reason or an empty page", async () => {
    await recordPageLeave({ page: "/chat", dwellMs: 10, reason: "bogus" as never });
    await recordPageLeave({ page: "", dwellMs: 10, reason: "route" });
    expect(create).not.toHaveBeenCalled();
  });

  it("a failed write never throws into the caller, and does not claim the row was stored", async () => {
    create.mockRejectedValue(new Error("db down"));
    const r = await recordPageLeave({ page: "/chat", dwellMs: 10, reason: "route" });
    expect(r.ok).toBe(false);
  });
});
