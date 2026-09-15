/**
 * Persona probe — run the read-only persona scouts against the live
 * storefront on the existing Stagehand/Browserbase lane, write a report, and
 * (optionally) post friction as H2 evidence to the Reality Ledger over HTTP.
 *
 *   pnpm exec tsx scripts/proof/persona-probe.ts                # all scouts
 *   pnpm exec tsx scripts/proof/persona-probe.ts --only sunday-used-225-60r16
 *   pnpm exec tsx scripts/proof/persona-probe.ts --post         # also POST to the ledger
 *
 * Needs the same env the browse tools need (BROWSERBASE_* + an LLM key).
 * Posting needs STATENOUR_SYNC_URL + STATENOUR_SYNC_KEY — HTTP, never a
 * direct DB write from a script (prod-db-guard).
 *
 * Output: test-results/persona-probe-<date>.json. Each receipt carries the
 * planner's steps and summary; `blocked` / `max_steps` / `error` are friction
 * and become claims. A `completed` run is NOT proof the page is good — it is
 * one scout's opinion, graded H2 at most, and never written above that.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PERSONA_SCOUTS, type PersonaScout } from "../../lib/proof/personas";

interface ScoutResult {
  id: string;
  goalId: string;
  status: string;
  summary: string;
  steps: number;
  durationMs: number;
  replayUrl: string | null;
  friction: boolean;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runScout(s: PersonaScout): Promise<ScoutResult> {
  const { browseAndDo } = await import("../../lib/ai/browser/browse-and-do");
  const r = await browseAndDo({
    goal: s.goal,
    permission: s.permission, // "read" — the planner never plans an act step
    startUrl: s.startUrl,
    maxSteps: s.maxSteps,
    budgetMs: s.budgetMs,
  });
  const friction = r.status !== "completed";
  return { id: s.id, goalId: s.goalId, status: r.status, summary: r.summary, steps: r.steps.length, durationMs: r.durationMs, replayUrl: r.replayUrl, friction };
}

async function postFriction(results: ScoutResult[]): Promise<void> {
  const base = process.env.STATENOUR_SYNC_URL?.replace(/\/+$/, "");
  const key = process.env.STATENOUR_SYNC_KEY;
  if (!base || !key) {
    console.log("ledger: STATENOUR_SYNC_URL / STATENOUR_SYNC_KEY not set — not posted");
    return;
  }
  const now = new Date().toISOString();
  const events = results.map((r) => ({
    eventType: "probe.persona_run",
    observedAt: now,
    objects: [{ type: "persona", id: r.id }, { type: "goal", id: r.goalId }, { type: "site", id: "nickstire.org" }],
    source: { system: "statenour-persona-probe", uri: r.replayUrl ?? undefined },
    quality: "observed",
    privacy: "internal",
    payload: { status: r.status, steps: r.steps, durationMs: r.durationMs, summary: r.summary.slice(0, 1000) },
  }));
  const claims = results
    .filter((r) => r.friction)
    .map((r) => ({
      claimText: `Persona scout ${r.id} could not complete its goal (${r.status}): ${r.summary.slice(0, 300)}`,
      grade: "H2",
      hypothesisId: r.id,
      goalId: r.goalId,
      disposition: "supported",
      createdBy: "agent",
    }));
  const res = await fetch(`${base}/api/sync/evidence`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-key": key },
    body: JSON.stringify({ events, claims, sentAt: now, sender: "statenour-persona-probe" }),
    signal: AbortSignal.timeout(10_000),
  });
  console.log(`ledger: ${res.status} — ${events.length} event(s), ${claims.length} friction claim(s)`);
}

async function main() {
  const only = argValue("--only");
  const scouts = only ? PERSONA_SCOUTS.filter((s) => s.id === only) : PERSONA_SCOUTS;
  if (!scouts.length) throw new Error(`no scout matches --only ${only}`);
  const results: ScoutResult[] = [];
  for (const s of scouts) {
    process.stdout.write(`▶ ${s.id} … `);
    try {
      const r = await runScout(s);
      results.push(r);
      console.log(`${r.status} in ${r.steps} step(s), ${Math.round(r.durationMs / 1000)}s`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ id: s.id, goalId: s.goalId, status: "error", summary: message, steps: 0, durationMs: 0, replayUrl: null, friction: true });
      console.log(`error — ${message}`);
    }
  }
  mkdirSync("test-results", { recursive: true });
  const file = `test-results/persona-probe-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  console.log(`wrote ${file}`);
  const friction = results.filter((r) => r.friction);
  console.log(`${results.length} scout(s) · ${friction.length} with friction${friction.length ? ": " + friction.map((f) => f.id).join(", ") : ""}`);
  if (process.argv.includes("--post")) await postFriction(results);
  if (friction.length) console.log("next: turn each friction summary into an episode — apps/nickstire/scripts/proof/promote-episode.mjs --task ... --path ...");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
