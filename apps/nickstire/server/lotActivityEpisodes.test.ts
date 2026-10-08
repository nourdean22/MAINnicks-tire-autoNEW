/**
 * Two reads in routers/lot.ts whose SHAPE is the contract (Codex on #2920):
 *
 *  - `lot.activity` must count the same identity as the headline counter in `lot.now`: one
 *    EPISODE is one car (stitched re-arrivals share an episodeId). Summing rows inflated today's
 *    observed arrivals against the baseline, so lotDataConfidence could read an undercount as OK.
 *  - The open-only floor board read must keep the LONGEST-waiting cars when it hits its LIMIT:
 *    newest-first ordering before the cap dropped exactly the cars about to become complaints.
 *
 * And the heartbeat ingest must hand the lattice the producer's heartbeat counter, or a restarted
 * edge reads as blind for its first ten minutes.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const router = fs.readFileSync(path.join(__dirname, "routers", "lot.ts"), "utf8");
const ingest = fs.readFileSync(path.join(__dirname, "routes", "cameraVisitsRoutes.ts"), "utf8");

describe("lot.activity counts episodes, like lot.now", () => {
  it("arrivals and pass-throughs per hour are COUNT(DISTINCT COALESCE(episodeId, visitId)), never a row sum", () => {
    const start = router.indexOf("activity: adminProcedure.query(");
    const end = router.indexOf("GROUP BY dayOffset, etHour", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = router.slice(start, end);
    expect(block).toContain("COUNT(DISTINCT CASE WHEN state <> 'PASS_THROUGH' THEN COALESCE(episodeId, visitId) END) AS arrivals");
    expect(block).toContain("COUNT(DISTINCT CASE WHEN state =  'PASS_THROUGH' THEN COALESCE(episodeId, visitId) END) AS passThroughs");
    expect(block).not.toMatch(/SUM\(CASE WHEN state <> 'PASS_THROUGH' THEN 1/);
    // The headline counter it must agree with: lot.now's arrivalsToday counts the same identity
    // (one episode, one car) behind its own preexisting / day-start filters.
    expect(router).toMatch(
      /COUNT\(DISTINCT CASE WHEN preexisting = 0 AND state <> 'PASS_THROUGH'[\s\S]{0,200}?THEN COALESCE\(episodeId, visitId\) END\) AS arrivalsToday/,
    );
  });
});

describe("lot.visits open-only read survives its cap", () => {
  it("open visits are read oldest first, the recent list newest first", () => {
    expect(router).toContain('ORDER BY COALESCE(arrivedAt, createdAt) ${input.openOnly ? sql.raw("ASC") : sql.raw("DESC")}');
  });
});

describe("the heartbeat ingest passes the producer's uptime into the lattice", () => {
  it("deriveStateAtIngest receives heartbeatSeq", () => {
    const start = ingest.indexOf("const verdict = deriveStateAtIngest({");
    const end = ingest.indexOf("});", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(ingest.slice(start, end)).toContain("heartbeatSeq: b.heartbeatSeq,");
  });
});
