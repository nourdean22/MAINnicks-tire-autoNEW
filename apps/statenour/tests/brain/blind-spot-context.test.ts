/**
 * getBlindSpotContext() verdict awareness · lib/brain/blind-spot-detector.ts
 * (2026-08-22).
 *
 * THE DEFECT. This read had no verdict filter, so a spot the operator had
 * explicitly rated "Noise" was read back into Nick's system prompt every
 * night — the system telling itself the thing it was told to disregard.
 * Measured on prod 2026-08-22: both rows rated `noise` on 08-21 were inside
 * the take(5) window the next day.
 *
 * THE SECOND DEFECT, CAUGHT WHILE FIXING THE FIRST. The obvious Prisma
 * predicate `NOT: { metadata: { path: ["discoveryVerdict"], equals: "noise" } }`
 * compiles to `NOT (metadata #> '{discoveryVerdict}' = '"noise"')`, which is
 * NULL — and therefore false — for any row without that key. Run against prod
 * it kept 1 of 241 live blind_spot rows: it would have cut this section of the
 * system prompt from five spots to one while reading like a tightened filter.
 * `keeps unjudged rows` below is the canary for that, and it is the reason the
 * implementation overfetches and filters in JS instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findMany: mocks.findMany }, brainDump: {}, commitment: {} },
}));

import { getBlindSpotContext } from "@/lib/brain/blind-spot-detector";

const spotRow = (content: string, verdict?: string) => ({
  content,
  metadata: verdict === undefined ? {} : { discoveryVerdict: verdict },
});

beforeEach(() => vi.clearAllMocks());

describe("getBlindSpotContext", () => {
  it("EXCLUDES a spot the operator called noise", async () => {
    mocks.findMany.mockResolvedValueOnce([
      spotRow("[HIGH] Open loop untouched: research hacks", "noise"),
      spotRow("[HIGH] Commitment overdue: pull the list"),
    ]);
    const ctx = await getBlindSpotContext();
    expect(ctx).not.toContain("research hacks");
    expect(ctx).toContain("pull the list");
  });

  it("CANARY · keeps unjudged rows — the path-null trap that kept 1 of 241", async () => {
    // Every row here has NO discoveryVerdict key at all. A JSON-path NOT
    // predicate drops all of them and returns "". If this test ever goes
    // empty-string, the filter has regressed to the SQL form.
    mocks.findMany.mockResolvedValueOnce([
      spotRow("[HIGH] spot one"),
      spotRow("[HIGH] spot two"),
      spotRow("[HIGH] spot three"),
    ]);
    const ctx = await getBlindSpotContext();
    expect(ctx).toContain("spot one");
    expect(ctx).toContain("spot two");
    expect(ctx).toContain("spot three");
  });

  it("KEEPS `known` — the operator confirmed it TRUE, it is just not new", async () => {
    // known is a NOVELTY verdict. Dropping it here would strip the prompt of
    // facts the operator personally vouched for, which is the opposite of what
    // "already knew" means.
    mocks.findMany.mockResolvedValueOnce([spotRow("[HIGH] a known truth", "known")]);
    expect(await getBlindSpotContext()).toContain("a known truth");
  });

  it("KEEPS `investigate` — it is live work, not a dismissal", async () => {
    mocks.findMany.mockResolvedValueOnce([spotRow("[HIGH] under investigation", "investigate")]);
    expect(await getBlindSpotContext()).toContain("under investigation");
  });

  it("still yields a FULL five when suppressed rows sit at the top", async () => {
    // Filtering after a take(5) would return two. The overfetch is what makes
    // suppression free of a silent budget cut.
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => spotRow(`[HIGH] muted ${i}`, "noise")),
      ...Array.from({ length: 6 }, (_, i) => spotRow(`[HIGH] live ${i}`)),
    ];
    mocks.findMany.mockResolvedValueOnce(rows);
    const ctx = await getBlindSpotContext();
    expect(ctx).not.toContain("muted");
    for (const i of [0, 1, 2, 3, 4]) expect(ctx).toContain(`live ${i}`);
    expect(ctx).not.toContain("live 5");
  });

  it("overfetches beyond the five it renders, so the filter has room to work", async () => {
    mocks.findMany.mockResolvedValueOnce([]);
    await getBlindSpotContext();
    expect(mocks.findMany.mock.calls[0][0].take).toBeGreaterThan(5);
    // metadata must be selected or the filter has nothing to read.
    expect(mocks.findMany.mock.calls[0][0].select.metadata).toBe(true);
  });

  it("returns empty when every candidate is suppressed, rather than inventing filler", async () => {
    mocks.findMany.mockResolvedValueOnce([spotRow("[HIGH] muted", "noise")]);
    expect(await getBlindSpotContext()).toBe("");
  });
});
