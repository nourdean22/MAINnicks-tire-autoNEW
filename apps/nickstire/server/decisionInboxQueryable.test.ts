/**
 * decisionInboxQueryable.test.ts · 2026-08-04
 *
 * #1340 added `queryable: boolean` to topDecisions() precisely so an
 * unconsultable decision queue would stop reading as a clear one — then wired it
 * to the cron and the LLM query route (morningBrief.ts:235,
 * nour-os-query.ts:117) and not to the admin panel the operator actually looks at.
 *
 * The gap is invisible to `isError`: topDecisions returns
 * `{ decisions: [], queryable: false }` when the DB is unreachable
 * (opportunityQueue.ts:398) or the query throws (:442). The tRPC call SUCCEEDS
 * carrying that shape, so isError stays false, decisions is empty, and the panel
 * printed "Either the queue is clear...". Same class the wave was closing, opened
 * by the wave.
 *
 * These are source-text assertions in the deadEndClosure style, because the
 * defect is a missing BRANCH — there is no value to assert, only the absence of
 * a guard. A render test that mounted the panel with queryable:false would prove
 * more, but the panel pulls tRPC, auth and a mutation, and the repo has no
 * harness for that; a guard that ships beats a harness that does not.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const panel = read("client/src/pages/admin/DecisionInboxPanel.tsx");
const service = read("server/services/opportunityQueue.ts");
const router = read("server/routers/opportunityQueue.ts");

describe("the queryable flag reaches the operator, not just the cron", () => {
  /** If the service stops emitting it, the panel's guard silently does nothing. */
  it("topDecisions still reports queryable on both failure paths", () => {
    expect(service).toMatch(/queryable:\s*false/);
    expect(service).toMatch(/queryable:\s*true/);
    // Both known failure exits must carry it, not just one.
    const falses = service.match(/queryable:\s*false/g) ?? [];
    expect(falses.length).toBeGreaterThanOrEqual(2);
  });

  it("the top procedure forwards topDecisions verbatim, so the flag is on the wire", () => {
    expect(router).toMatch(/top:\s*adminProcedure[\s\S]{0,220}topDecisions\(/);
  });

  it("the panel branches on queryable === false", () => {
    expect(panel).toMatch(/data\?\.queryable === false/);
  });

  /**
   * The regression that matters. The empty state must not render when the queue
   * was unreadable — otherwise the guard above adds a banner while the "queue is
   * clear" sentence still prints underneath it, which is worse than either alone.
   */
  it("the empty state is gated on queryable, not only on isError", () => {
    const emptyBranch = panel.match(/\{!isError && [^}]*decisions\.length === 0 &&/);
    expect(emptyBranch, "the decisions.length === 0 branch changed shape").not.toBeNull();
    expect(emptyBranch![0]).toContain("queryable");
  });

  it("the header does not print a count derived from an unread queue", () => {
    // totalLive is 0 on the unreadable path, so "top 0 of 0 live" would be a
    // fabricated all-clear in the same breath as the banner saying otherwise.
    expect(panel).toMatch(/queue unreadable/i);
  });
});
