/**
 * tests/services/correction-where-single-owner.test.ts · 2026-10-02 · full-circle wave 3
 *
 * "What counts as a correction" (a recommendation dismissed or rated not useful)
 * drives the fine-tune odometer, the eval-dataset exporter, the recall-corpus
 * builder and the harvest cron. Four hand-typed copies could drift four ways
 * silently; `CORRECTION_WHERE` is the one owner and this pins that the literal
 * survives nowhere else under lib/, app/ or scripts/.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { CORRECTION_WHERE } from "@/lib/services/outcome-ledger";

const APP = join(__dirname, "../..");
// The pre-2026-10-10 predicate, or the current one's dismissal arm: either
// hand-typed outside the service is a second owner.
const LITERAL =
  /OR:\s*\[\s*\{\s*decision:\s*"dismissed"\s*\}\s*,\s*\{\s*outcomeUseful:\s*false\s*\}\s*\]|decision:\s*"dismissed",\s*OR:/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("CORRECTION_WHERE · one owner", () => {
  it("is the operator dismissed-or-not-useful predicate: no machine predictions, no timing/alternative dismissals", () => {
    expect(CORRECTION_WHERE).toEqual({
      kind: { not: "prediction" },
      NOT: { sourceEngine: { startsWith: "tutor:" } },
      OR: [
        { decision: "dismissed", OR: [{ resultRef: null }, { resultRef: { notIn: ["dismiss:timing", "dismiss:alternative"] } }] },
        { outcomeUseful: false },
      ],
    });
    // Row-level semantics (a prediction row, a dismiss:timing row) are pinned in
    // tests/services/outcome-ledger-contract-task11.test.ts.
  });

  it("the literal appears in exactly one source file — the service", () => {
    const hits = ["lib", "app", "scripts"]
      .flatMap((d) => walk(join(APP, d)))
      .filter((f) => LITERAL.test(readFileSync(f, "utf8")))
      .map((f) => relative(APP, f).replace(/\\/g, "/"));
    expect(hits).toEqual(["lib/services/outcome-ledger.ts"]);
  });

  it("MUTATION — the detector sees the literal when it is present", () => {
    expect(LITERAL.test('where: { OR: [{ decision: "dismissed" }, { outcomeUseful: false }] }')).toBe(true);
    expect(LITERAL.test('{ decision: "dismissed", OR: [{ resultRef: null }] }')).toBe(true);
  });
});
