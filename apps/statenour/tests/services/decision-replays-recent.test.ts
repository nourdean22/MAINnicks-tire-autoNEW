/**
 * The "recent reviewed" list on /brain (components/brain/memory-tab.tsx via buildDecisionReplaysView) shows the
 * 10 latest reviewed=true replays by reviewedAt. scripts/brain-hygiene/close-overdue-replays.ts closes overdue
 * replays as reviewed with outcome "not reviewed, expired" and reviewedAt = now(), which would put 28 rows with
 * no score at the top of that list. The reader must skip them and keep every real review, including a real
 * review with no score and one with no outcome text (markReplayed stores outcomeScore ?? null).
 *
 * The prisma mock applies the where clause to an in-memory table, so the test checks what the reader would
 * return, not what text it sent. NULL semantics are modelled the SQL way: `outcome: { not: X }` does not match NULL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPIRED_OUTCOME } from "@/lib/brain/decision-replay-outcome";

type Row = { id: string; reviewed: boolean; outcome: string | null; outcomeScore: number | null; reviewedAt: Date; createdAt: Date };
const T = (d: number) => new Date(Date.UTC(2026, 9, d));
const TABLE: Row[] = [
  { id: "closed-1", reviewed: true, outcome: "not reviewed, expired", outcomeScore: null, reviewedAt: T(23), createdAt: T(1) },
  { id: "closed-2", reviewed: true, outcome: "not reviewed, expired", outcomeScore: null, reviewedAt: T(23), createdAt: T(2) },
  { id: "real-scored", reviewed: true, outcome: "went well", outcomeScore: 6, reviewedAt: T(20), createdAt: T(1) },
  { id: "real-no-score", reviewed: true, outcome: "mixed", outcomeScore: null, reviewedAt: T(19), createdAt: T(1) },
  { id: "real-no-outcome", reviewed: true, outcome: null, outcomeScore: null, reviewedAt: T(18), createdAt: T(1) },
  { id: "open", reviewed: false, outcome: null, outcomeScore: null, reviewedAt: T(17), createdAt: T(1) },
];

type Where = { reviewed?: boolean; outcome?: string | null | { not: string }; OR?: Where[]; NOT?: Where };
function matches(r: Row, w: Where): boolean {
  if (w.reviewed !== undefined && r.reviewed !== w.reviewed) return false;
  if (w.outcome !== undefined) {
    const o = w.outcome;
    if (o === null) {
      if (r.outcome !== null) return false;
    } else if (typeof o === "string") {
      if (r.outcome !== o) return false;
    } else if (r.outcome === null || r.outcome === o.not) return false; // SQL: NULL <> x is not true
  }
  if (w.OR && !w.OR.some((c) => matches(r, c))) return false;
  if (w.NOT && matches(r, w.NOT)) return false;
  return true;
}

const h = vi.hoisted(() => ({ replayWhere: [] as unknown[] }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findMany: async () => [] },
    decisionReplay: {
      findMany: async (args: { where: Where; orderBy: { reviewedAt: "desc" }; take: number }) => {
        h.replayWhere.push(args.where);
        return TABLE.filter((r) => matches(r, args.where))
          .sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime())
          .slice(0, args.take);
      },
    },
  },
}));

import { buildDecisionReplaysView } from "@/lib/services/decision-replays";

beforeEach(() => {
  h.replayWhere.length = 0;
});

describe("recent reviewed replays", () => {
  it("POSITIVE CONTROL: the close-out text in the fixtures is the constant the script writes", () => {
    expect(EXPIRED_OUTCOME).toBe("not reviewed, expired");
  });

  it("a replay closed as 'not reviewed, expired' never appears; every real review does", async () => {
    const view = await buildDecisionReplaysView();
    const ids = view.recent.map((r) => r.id);
    expect(ids).not.toContain("closed-1");
    expect(ids).not.toContain("closed-2");
    expect(ids).toEqual(["real-scored", "real-no-score", "real-no-outcome"]);
  });

  it("closed rows do not use up the ten slots", async () => {
    for (let i = 0; i < 12; i++) {
      TABLE.push({ id: `closed-x${i}`, reviewed: true, outcome: "not reviewed, expired", outcomeScore: null, reviewedAt: T(24), createdAt: T(1) });
    }
    try {
      const view = await buildDecisionReplaysView();
      expect(view.recent.map((r) => r.id)).toEqual(["real-scored", "real-no-score", "real-no-outcome"]);
    } finally {
      TABLE.splice(TABLE.length - 12, 12);
    }
  });
});
