/**
 * A QUEUE IS NOT A SAFE PLACE TO STORE AN UNENFORCED DECISION.
 *
 * `enqueueReelJob` blocks a condemned script before the spend boundary, which
 * is correct for every job created since that gate shipped — and does nothing
 * for rows that were ALREADY QUEUED when it shipped.
 *
 * Those rows exist. Found in production 2026-09-09: job 1830003 had sat
 * `queued` since 2026-08-30 carrying the voiceover "In Ohio, it's an automatic
 * fail for your E-Check". That is false in 81 of Ohio's 88 counties, and it is
 * the exact assertion the 2026-08-29 claim audit condemned, reproduced verbatim
 * under a new job id — the defect the audit's own key-by-job-id weakness let
 * through. It was next in the generation queue.
 *
 * The publish door would have refused it. After the clips were rendered and
 * paid for, and after a false safety-adjacent claim had been spoken aloud in a
 * finished asset.
 *
 * So the gate is re-checked where the cost actually is.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PIPE = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");

function genStage(): string {
  const start = PIPE.indexOf("export async function processNextReelJob");
  expect(start, "processNextReelJob not found").toBeGreaterThan(-1);
  const rest = PIPE.slice(start);
  const end = rest.indexOf("\nexport async function processNextAssemblyJob");
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("the generator refuses a condemned script before it spends", () => {
  const stage = genStage();

  it("the check exists inside the generation stage, not only at enqueue", () => {
    expect(stage).toContain("condemnedContentProblem");
  });

  it("it runs BEFORE the PAID provider is chosen and before any clip is bought", () => {
    // Two selectReelVideoProvider() calls live in this stage and only the
    // second one costs anything: `preflightProvider` is a read-only credential
    // check that runs before the row is even claimed, while `videoProvider` is
    // the pricing anchor settle() bills against. An earlier version of this pin
    // matched the free one and reported a false failure — the ordering that
    // matters is against the anchor, not against the first textual match.
    const check = stage.indexOf("condemnedContentProblem");
    const paidAnchor = stage.indexOf("videoProvider = await selectReelVideoProvider()");
    const generate = stage.indexOf("renderHiggsfieldBeat(");
    expect(check).toBeGreaterThan(-1);
    expect(paidAnchor, "pricing anchor not found").toBeGreaterThan(-1);
    expect(generate, "clip generation call not found").toBeGreaterThan(-1);
    expect(check, "the gate must precede the paid provider anchor").toBeLessThan(paidAnchor);
    expect(check, "the gate must precede clip generation").toBeLessThan(generate);
  });

  it("and it runs AFTER the row is claimed, so two workers cannot both fail it", () => {
    const claim = stage.indexOf('eq(reelJobs.status, "queued")');
    const check = stage.indexOf("condemnedContentProblem");
    expect(claim).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(claim);
  });

  it("it fails the job CLOSED and releases the reservation", () => {
    const block = stage.slice(stage.indexOf("condemnedContentProblem"));
    const body = block.slice(0, 1600);
    expect(body).toContain('status: "failed"');
    expect(body).toContain("releaseFailedJobReservation");
    // And it must stop — not fall through into generation.
    expect(body).toContain("return { processed: true");
  });

  it("the error names the gate so the row is diagnosable later", () => {
    expect(stage).toContain("REEL_SCRIPT_CONDEMNED (blocked at generation, before spend)");
  });

  it("the enqueue-time gate is still there — this ADDS a layer, it does not move one", () => {
    const enq = PIPE.slice(PIPE.indexOf("export async function enqueueReelJob"));
    const enqBody = enq.slice(0, enq.indexOf("\nexport async function"));
    expect(enqBody).toContain("condemnedContentProblem");
    expect(enqBody).toContain("REEL_SCRIPT_CONDEMNED");
  });

  it("PLANTED CANARY: the condemned claim this was written against is still condemned", async () => {
    // If the audit's script list is ever emptied or its matcher weakened, this
    // gate silently stops gating. Assert on the actual claim, not on the gate.
    const { condemnedContentProblem } = await import("../shared/reelClaimAudit");
    const hit = condemnedContentProblem({
      voiceover: "That little Check Engine light isn't just a suggestion. In Ohio, it's an automatic fail for your E-Check.",
      onScreenText: "",
    });
    expect(hit, "the E-Check claim must still be condemned").toBeTruthy();
  });

  it("and a clean script is NOT blocked — the gate is not a blanket refusal", async () => {
    const { condemnedContentProblem } = await import("../shared/reelClaimAudit");
    const clean = condemnedContentProblem({
      voiceover: "A hum that rises with road speed can be one clue a wheel bearing is worth checking.",
      onScreenText: "WORTH CHECKING",
    });
    expect(clean).toBeFalsy();
  });
});
