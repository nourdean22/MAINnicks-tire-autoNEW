/**
 * A brief built on nothing is not a good day.
 *
 * THE DEFECT, 2026-08-23. `intelligence-daily-brief`'s ingestion step caught
 * every per-source error, logged it, and returned normally. A source returning
 * `{ success: false }` was not even logged. So if all seven feeds failed — one
 * expired credential is enough — the step returned `sourcesIngested: 0`, the
 * function completed, and Inngest marked the run SUCCEEDED. The brief then
 * shipped built on no new input, and the only trace was a log line nobody reads.
 *
 * This is the same shape as the `ingest-reviews` 16-day silent failure and the
 * `cron-heartbeat` outcome lane: a job that runs and produces nothing is not a
 * job that succeeded.
 *
 * WHY IT PAGES VIA A THROW. `onFailure: onInngestFailure` is already wired on
 * this function and already routes to Telegram once retries are exhausted. The
 * throw reuses that path; a second alerting route would be a parallel system to
 * keep in sync. Nothing new was built.
 *
 * MEASURED BEFORE ARMING. Prod 2026-08-23: 7 registered sources, and
 * intelligence_claims holds rows on 20 of the last 21 days (20-76/day). Zero
 * ingestion is not the steady state, so this fires rarely. The counter-example
 * is `ollama-model-liveness` with its 2,308-run failure streak — the identical
 * assert there would page ~97% of days and be muted inside a week. A gate is
 * only worth arming once you know its base rate.
 */
import { describe, it, expect } from "vitest";
import { ingestionFailure } from "@/lib/inngest/functions/intelligence-brief";

describe("ingestionFailure · zero ingest is a failure", () => {
  it("THE DEFECT: every source failed, and the run used to report success", () => {
    const msg = ingestionFailure({
      sourcesAttempted: 7,
      sourcesIngested: 0,
      failures: ["AI News: 401 unauthorized", "SEO Weekly: 401 unauthorized"],
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain("0 of 7");
  });

  it("carries the REASON, not just the count — that is the actionable half", () => {
    // IngestionResult.message was being discarded entirely. An alert saying
    // "0 sources ingested" tells the operator something is wrong; one saying
    // "401 unauthorized" tells them it is a credential and they can fix it.
    const msg = ingestionFailure({
      sourcesAttempted: 3,
      sourcesIngested: 0,
      failures: ["AI News: 401 unauthorized"],
    });
    expect(msg).toContain("401 unauthorized");
  });

  it("says so explicitly when no reason was captured", () => {
    // Silence about WHY must not read as "no reason existed".
    const msg = ingestionFailure({ sourcesAttempted: 3, sourcesIngested: 0 });
    expect(msg).toContain("No per-source reason was captured");
  });

  it("POSITIVE CONTROL: a healthy run returns null", () => {
    // Without this, a function hardcoded to return a string would satisfy every
    // assertion above while failing the brief every single morning.
    expect(ingestionFailure({ sourcesAttempted: 7, sourcesIngested: 7 })).toBeNull();
  });

  it("the === 0 condition is load-bearing for IDEMPOTENCY, not just sensitivity", () => {
    // A throw inside step.run makes Inngest re-run the step, and runIngestion has
    // no dedup — it writes a source_documents row per successful call with no
    // content hash. Firing on a PARTIAL day would therefore re-ingest whatever
    // already succeeded and duplicate it. Firing only at zero means nothing was
    // written on that attempt, so a retry has nothing to duplicate.
    //
    // This pins the property: any partial result must return null.
    for (const ingested of [1, 2, 6]) {
      expect(
        ingestionFailure({ sourcesAttempted: 7, sourcesIngested: ingested }),
        `${ingested}/7 must not throw — a retry would duplicate the ${ingested} that succeeded`,
      ).toBeNull();
    }
  });

  it("POSITIVE CONTROL: ONE surviving source is not a total outage", () => {
    // Partial degradation is real and is logged, but it is not this gate's job.
    // A gate that fired on any failure would page on a single flaky feed and be
    // muted, taking the total-outage signal with it.
    expect(
      ingestionFailure({ sourcesAttempted: 7, sourcesIngested: 1, failures: ["six failed"] }),
    ).toBeNull();
  });

  it("THE GUARD: no sources registered means ingesting nothing is CORRECT", () => {
    // Without this branch, an empty configuration becomes a permanent daily
    // alarm — the failure-is-steady-state trap that made ollama-model-liveness
    // unusable. Zero of zero is not a failure.
    expect(ingestionFailure({ sourcesAttempted: 0, sourcesIngested: 0 })).toBeNull();
    expect(ingestionFailure({ sourcesAttempted: 0, sourcesIngested: 0, failures: [] })).toBeNull();
  });
});

describe("the throw is wired into the step, and reasons are collected", () => {
  const src = readSource();

  it("the step throws on the failure verdict rather than returning", () => {
    expect(src).toMatch(/const fatal = ingestionFailure\(/);
    expect(src, "returning normally is exactly what made an outage look healthy").toMatch(
      /if \(fatal\) \{[\s\S]{0,400}throw new Error\(fatal\)/,
    );
  });

  it("a soft failure is recorded — it used to be neither counted nor logged", () => {
    // Scoped to the ELSE branch specifically. An earlier version asserted that
    // `failures.push(` appeared anywhere in the file, which the catch block
    // satisfies on its own — so deleting the soft-failure collection entirely
    // left this green. A mutation proved it; the assertion now reads the branch.
    const elseBranch = src.slice(src.indexOf("          } else {"), src.indexOf("        } catch (err) {"));
    expect(elseBranch.length).toBeGreaterThan(0);
    expect(
      elseBranch,
      "a source returning success:false must be collected, not just logged",
    ).toMatch(/failures\.push\(/);
    expect(elseBranch).toContain("ingestion_source_soft_failure");
  });

  it("the per-source message reaches the failures list", () => {
    // res.message is the only place an auth error is described.
    expect(src).toMatch(/res\.message/);
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(process.cwd(), "lib/inngest/functions/intelligence-brief.ts"), "utf8");
}
