/**
 * calibrate-importance-threshold · READ-ONLY
 *
 * Answers one question with real data instead of intuition: what score do the
 * operator's actual chat messages get, and where should persistIfImportant's
 * threshold sit?
 *
 * Context · `chat_importance` held 10 rows in the 3.5 months to 2026-08-06.
 * That single fact starves the contradiction detector, which requires BOTH the
 * fresh row and its neighbour to be chat_importance and >= 7 days apart. With
 * a 10-row pool it can never fire. The tempting fix is lowering the threshold,
 * but importance-scorer.ts:218 records that low-score rows once built "a
 * multi-thousand-row garbage pool" — so the number has to be measured, not
 * guessed.
 *
 * WHY A SCRIPT AND NOT SQL · scoreMessage is seven regex groups plus a length
 * bonus and a question penalty. Re-implementing that in SQL would introduce
 * translation error into the very number we are trying to trust. This imports
 * the REAL production function instead, so the histogram is what production
 * would actually have scored.
 *
 * PRIVACY · message CONTENT is read into memory, scored, and discarded. Only
 * aggregate counts are printed. No content is written, logged, or emitted.
 *
 * SAFETY · one findMany. No writes, no DDL, no mutations of any kind.
 *
 * Usage (from apps/statenour):  pnpm exec tsx scripts/calibrate-importance-threshold.ts
 */

import { PrismaClient } from "@prisma/client";
import { scoreMessage } from "../lib/brain/importance-scorer";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.chatMessage.findMany({
    where: { role: "user" },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const histogram = new Map<number, number>();
  const byPrimary = new Map<string, number>();
  let withPrimary = 0;
  let tooShort = 0;

  // What each candidate threshold would admit. persistIfImportant requires
  // BOTH score >= threshold AND a non-null primary, so model both.
  const admitted = new Map<number, number>();
  // Of those admitted, how many carry a primary the contradiction surfacer
  // actually reacts to — that is the number that matters for the starved lane.
  const admittedEligible = new Map<number, number>();
  const CONTRADICTION_PRIMARIES = new Set(["decision", "preference", "commitment"]);

  for (const r of rows) {
    const s = scoreMessage(r.content);
    histogram.set(s.score, (histogram.get(s.score) ?? 0) + 1);
    if (s.reason === "too short") tooShort++;
    if (s.primary) {
      withPrimary++;
      byPrimary.set(s.primary, (byPrimary.get(s.primary) ?? 0) + 1);
    }
    for (let t = 1; t <= 10; t++) {
      if (s.score >= t && s.primary) {
        admitted.set(t, (admitted.get(t) ?? 0) + 1);
        if (CONTRADICTION_PRIMARIES.has(s.primary)) {
          admittedEligible.set(t, (admittedEligible.get(t) ?? 0) + 1);
        }
      }
    }
  }

  const first = rows.at(-1)?.createdAt;
  const last = rows[0]?.createdAt;
  const days =
    first && last ? Math.max(1, (last.getTime() - first.getTime()) / 86_400_000) : 1;

  console.log("");
  console.log("=== CORPUS ===");
  console.log(`user messages      ${rows.length}`);
  console.log(`span (days)        ${days.toFixed(0)}`);
  console.log(`too short (<20ch)  ${tooShort}`);
  console.log(`with a primary     ${withPrimary}`);

  console.log("");
  console.log("=== SCORE HISTOGRAM ===");
  for (let s = 0; s <= 10; s++) {
    const n = histogram.get(s) ?? 0;
    if (n === 0) continue;
    const pct = ((100 * n) / rows.length).toFixed(1);
    console.log(`score ${String(s).padStart(2)}  ${String(n).padStart(5)}  ${pct.padStart(5)}%`);
  }

  console.log("");
  console.log("=== PRIMARY CATEGORY (of messages that get one) ===");
  for (const [cat, n] of [...byPrimary.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${cat.padEnd(14)} ${String(n).padStart(5)}`);
  }

  console.log("");
  console.log("=== WHAT EACH THRESHOLD WOULD ADMIT ===");
  console.log("thresh  admitted  per-month  contradiction-eligible  per-month");
  for (let t = 1; t <= 10; t++) {
    const a = admitted.get(t) ?? 0;
    const e = admittedEligible.get(t) ?? 0;
    const perMonth = (a / days) * 30;
    const ePerMonth = (e / days) * 30;
    console.log(
      `${String(t).padStart(6)}  ${String(a).padStart(8)}  ${perMonth.toFixed(1).padStart(9)}  ${String(e).padStart(22)}  ${ePerMonth.toFixed(1).padStart(9)}`,
    );
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
