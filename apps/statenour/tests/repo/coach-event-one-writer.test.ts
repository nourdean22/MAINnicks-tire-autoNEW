/**
 * One writer for coach events (home-pulse W3, 2026-10-31).
 *
 * The operator's done and snooze survive a re-fire only because recordCoachEvent reads the prior state
 * before its upsert (lib/services/coach-events.ts). A file that wrote BrainMemory rows with the
 * coach_event category itself would skip that and bring dismissed items back. Measured on main
 * 570633c25b: 21 other files name the category and every one only reads. This holds that at zero.
 * Blind spot, on purpose: a write keyed by row id with no category line near it. The one today is
 * lib/system/stale-data-purger.ts, which acks drift rows older than 14 days (a writer ack, harmless).
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "..", "..");
const CATEGORY = /category:\s*("coach_event"|BRAIN_CATEGORIES\.COACH_EVENT)/;
const CALL = /\.(findMany|findFirst|findUnique|count|groupBy|aggregate|create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/g;
const WRITES = new Set(["create", "createMany", "upsert", "update", "updateMany"]);

/** Each coach_event category line whose nearest preceding prisma call (8 lines up) is a write. */
function coachEventWrites(source: string): number[] {
  const lines = source.split(/\r?\n/);
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (!CATEGORY.test(line)) return;
    const window = lines.slice(Math.max(0, i - 8), i + 1).join("\n");
    const calls = [...window.matchAll(CALL)].map((m) => m[1]);
    const nearest = calls[calls.length - 1];
    if (nearest && WRITES.has(nearest)) hits.push(i + 1);
  });
  return hits;
}

const files = execFileSync("git", ["ls-files", "lib", "app"], { cwd: APP, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f));

describe("coach events have one writer", () => {
  it("the detector sees a real write: coach-events.ts's own upsert (positive control)", () => {
    expect(coachEventWrites(readFileSync(join(APP, "lib/services/coach-events.ts"), "utf8")).length).toBeGreaterThan(0);
  });

  it("the detector flags a planted direct create and passes a read", () => {
    expect(coachEventWrites(`await prisma.brainMemory.create({\n  data: {\n    category: "coach_event",\n  },\n});`)).toEqual([3]);
    expect(coachEventWrites(`await prisma.brainMemory.findMany({\n  where: {\n    category: "coach_event",\n  },\n});`)).toEqual([]);
  });

  it("no file outside lib/services/coach-events.ts writes coach_event rows", () => {
    const offenders = files
      .filter((f) => f !== "lib/services/coach-events.ts")
      .flatMap((f) => coachEventWrites(readFileSync(join(APP, f), "utf8")).map((line) => `${f}:${line}`));
    expect(offenders).toEqual([]);
  });
});
