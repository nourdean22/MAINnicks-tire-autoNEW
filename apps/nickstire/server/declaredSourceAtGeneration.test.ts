/**
 * A BEAT DECLARED REAL IS NEVER GENERATED (2026-10-08).
 *
 * The proof packs tag their evidence beats REAL and their cards DETERMINISTIC,
 * and the approved-pack builder carries a declared `source` through. Nothing in
 * the generator read either: a proof pack enqueued from Studio would have sent
 * "REAL macro of a tire tread" to the video model — a synthetic shot
 * documenting real work, the one thing the production doctrine forbids.
 *
 * Neither declared route has a publishable lane yet (the stock guard refuses
 * every clip the free local lane hosts), so the rule is a refusal, applied
 * where a decision costs nothing: at enqueue, again at generation for rows
 * already queued, and at the single-beat repair entry. The behaviour of the
 * rule is tested in shared/shotRouter.test.ts and over every committed pack in
 * approvedReelPackRotation.test.ts; this file pins WHERE it runs, the way
 * condemnedAtGeneration.test.ts pins the condemned-script gate.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sliceBlock } from "./testUtils/sourceBlock";

const PIPE = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");
const between = (from: string, to: string) => {
  const start = PIPE.indexOf(from);
  expect(start, `${from} not found`).toBeGreaterThan(-1);
  const rest = PIPE.slice(start);
  const end = rest.indexOf(to);
  expect(end, `${to} not found after ${from}`).toBeGreaterThan(-1);
  return rest.slice(0, end);
};

describe("the generator refuses declared real/deterministic beats before it spends", () => {
  const stage = between("export async function processNextReelJob", "\nexport async function processNextAssemblyJob");

  it("runs after the row is claimed and before the paid provider anchor and any clip", () => {
    const claim = stage.indexOf('eq(reelJobs.status, "queued")');
    const check = stage.indexOf("beatsTheGeneratorMustNotRender(beats, existingClips)");
    const paidAnchor = stage.indexOf("videoProvider = await selectReelVideoProvider()");
    const generate = stage.indexOf("const { generateReelClipVideo }");
    expect(claim).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(claim);
    expect(paidAnchor).toBeGreaterThan(check);
    expect(generate).toBeGreaterThan(check);
  });

  it("fails the job closed with the named reason, releases the reservation, and stops", () => {
    const body = sliceBlock(stage, "beatsTheGeneratorMustNotRender(beats, existingClips)", "const { assertDurableStorageForGeneration", { label: "processNextReelJob" });
    expect(body).toContain("generationHoldReason(blocked)");
    expect(body).toContain('status: "failed"');
    expect(body).toContain("releaseFailedJobReservation(job.payload, job.id)");
    expect(body).toContain("return { processed: true, jobId: job.id, status: \"failed\" }");
  });

  it("a resumed job keeps the clips it has (the check reads clipUrlsJson)", () => {
    const block = sliceBlock(stage, "A BEAT DECLARED REAL IS NEVER GENERATED", "beatsTheGeneratorMustNotRender(beats, existingClips)", { label: "processNextReelJob" });
    expect(block).toContain("existingClips = job.clipUrlsJson ? JSON.parse(job.clipUrlsJson) : []");
  });
});

describe("and one layer earlier, at enqueue, before a slot or budget is reserved", () => {
  const enqueue = between("export async function enqueueReelJob", "\nexport async function processNextReelJob");

  it("refuses with the enqueue wording before the governor reservation", () => {
    const check = enqueue.indexOf("beatsTheGeneratorMustNotRender(brief.storyboardBeats ?? [], [])");
    const slot = enqueue.indexOf("await requestReservation(");
    expect(check).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(check);
    expect(enqueue).toContain('throw new Error(generationHoldReason(blocked, "enqueue"))');
  });

  it("the condemned-script gate is still first — this adds a layer, it moves none", () => {
    expect(enqueue.indexOf("condemnedContentProblem")).toBeLessThan(enqueue.indexOf("beatsTheGeneratorMustNotRender"));
  });
});
