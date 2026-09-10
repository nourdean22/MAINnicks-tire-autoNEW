/**
 * Registered-procedure census — emits `<type>.<path>` for every procedure on the real
 * `appRouter`, the exact shape the [tRPC first-call] probe logs, into
 * `eval-datasets/proc-census.json`.
 *
 * Lives as a test because importing `appRouter` spins up the full router graph (heavy
 * modules); the vitest env already pays that cost for trpc-auth-tier.test.ts, which reads
 * the same registry.
 *
 * WHAT IT IS FOR. This file is the SUBTRAHEND of the dead-procedure harvest: probe lines
 * harvested from Railway logs MINUS this list = dead candidates for the named window. It is
 * NOT a delete list (#1478) — every procedure is reachable over HTTP by callers outside this
 * repo.
 *
 * WHY IT IS NOW A DRIFT GATE RATHER THAN A WRITE.
 *
 * It used to write the file on every run and assert only `count > 100`. Two consequences,
 * both real and both observed on 2026-09-10:
 *
 *   1. The committed snapshot went stale silently — 725 entries against 735 live, ten
 *      procedures added since it was last committed. Nothing anywhere reads this file (the
 *      only reference in the app is this test), so no gate caught it and nothing degraded
 *      loudly. What it corrupts is the HARVEST: a stale subtrahend subtracts too little, so
 *      live procedures that never appear in it get labelled dead candidates. The harvest is
 *      run by a person, occasionally, and would have been quietly wrong.
 *   2. Running the suite dirtied the working tree, every time. That is how the staleness was
 *      found — the file showed up in `git status` during unrelated work — but it also means
 *      `git status` is never clean after a test run, which is exactly the condition under
 *      which a real change gets missed or an unrelated one gets swept into a commit.
 *
 * So the default is now to COMPARE and fail with instructions, the same shape as the
 * reality-ledger check in completion-authority.yml. Regenerate deliberately:
 *
 *     PROC_CENSUS_WRITE=1 pnpm exec vitest run server/__tests__/proc-census.test.ts
 *
 * `generatedAt` is deliberately NOT compared: it changes on every write and would make the
 * gate fail for a reason that says nothing about the procedure list. `count` is not compared
 * either — it is derived from `procedures`, so comparing it as well would report one drift
 * as two.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appRouter } from "../routers";

const CENSUS_PATH = join(process.cwd(), "eval-datasets", "proc-census.json");

/** `<type>.<path>` for every registered procedure, sorted. */
function liveProcedures(): string[] {
  const procedures = (
    appRouter as unknown as { _def: { procedures: Record<string, { _def?: { type?: string } }> } }
  )._def.procedures;
  const out: string[] = [];
  for (const [path, proc] of Object.entries(procedures)) {
    const type = proc?._def?.type;
    if (!type) throw new Error(`procedure without type: ${path}`);
    out.push(`${type}.${path}`);
  }
  return out.sort();
}

function committedProcedures(): string[] {
  const raw = JSON.parse(readFileSync(CENSUS_PATH, "utf8")) as { procedures?: unknown };
  expect(
    Array.isArray(raw.procedures),
    `${CENSUS_PATH} has no procedures array; this gate would be reading nothing`,
  ).toBe(true);
  return raw.procedures as string[];
}

describe("registered-procedure census (harvest subtrahend)", () => {
  it("every registered procedure has a type", () => {
    // The positive control. A router graph that failed to load would give an empty list, and
    // an empty list compared against an empty file would agree forever.
    const live = liveProcedures();
    expect(live.length).toBeGreaterThan(100);
    expect(live).toContain("query.lot.health");
  });

  it("the committed census matches the live router", () => {
    const live = liveProcedures();

    if (process.env.PROC_CENSUS_WRITE === "1") {
      writeFileSync(
        CENSUS_PATH,
        JSON.stringify({ generatedAt: new Date().toISOString(), count: live.length, procedures: live }, null, 2) + "\n",
      );
      console.log(`registered procedures: ${live.length} -> ${CENSUS_PATH}`);
      return;
    }

    const committed = committedProcedures();
    const added = live.filter((p) => !committed.includes(p));
    const removed = committed.filter((p) => !live.includes(p));
    expect(
      { added, removed },
      `eval-datasets/proc-census.json is stale. It is the SUBTRAHEND of the dead-procedure ` +
        `harvest, so a list missing ${added.length} live procedure(s) makes those procedures ` +
        `look DEAD in the next harvest. Regenerate deliberately and commit the result:\n` +
        `  PROC_CENSUS_WRITE=1 pnpm exec vitest run server/__tests__/proc-census.test.ts`,
    ).toEqual({ added: [], removed: [] });
  });

  it("the gate would NOTICE a census that had drifted", () => {
    // The canary. Without it a comparison rewritten to compare nothing — or one reading an
    // absent field as `[]` on both sides — would pass forever and this file would be
    // decoration, which is precisely what it was before.
    const live = liveProcedures();
    const pretendCommitted = live.slice(0, -1);
    const added = live.filter((p) => !pretendCommitted.includes(p));
    expect(added).toHaveLength(1);
    expect(added[0]).toBe(live[live.length - 1]);
  });
});
