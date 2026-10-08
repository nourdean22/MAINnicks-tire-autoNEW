import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sliceBlock } from "../testUtils/sourceBlock";
import { readReelLane, renderDeliveredQaException, renderProviderDriftException, renderReelLaneException } from "./reelLaneHealth";

describe("renderReelLaneException — three states, never a silent unknown", () => {
  it("healthy lane (posted within the window) says nothing", () => {
    expect(renderReelLaneException({ kind: "measured", hoursSinceLastPost: 20, readyAwaitingApproval: 4 })).toBeNull();
  });

  it("the 2026-10-05..08 shape: stalled with finished reels waiting names the approval that unblocks it", () => {
    const line = renderReelLaneException({ kind: "measured", hoursSinceLastPost: 4 * 24 + 6, readyAwaitingApproval: 2 });
    expect(line).toBe("No Reel posted in 4 day(s) — 2 finished Reel(s) waiting for your approval (Instagram → Queue)");
  });

  it("stalled with nothing waiting points at production, not approval (36 h is the boundary)", () => {
    expect(renderReelLaneException({ kind: "measured", hoursSinceLastPost: 35, readyAwaitingApproval: 0 })).toBeNull();
    expect(renderReelLaneException({ kind: "measured", hoursSinceLastPost: 36, readyAwaitingApproval: 0 }))
      .toContain("no finished Reel is waiting for approval");
  });

  it("never posted is a stall, not a healthy zero", () => {
    expect(renderReelLaneException({ kind: "measured", hoursSinceLastPost: null, readyAwaitingApproval: 0 }))
      .toContain("No Reel has ever been recorded as posted");
  });

  it("a failed read is UNKNOWN, never silence", () => {
    expect(renderReelLaneException({ kind: "unreadable" })).toContain("UNKNOWN");
  });
});

describe("readReelLane", () => {
  const fake = (hoursSince: unknown, n: unknown, recent: Array<{ id: number; payload: string | null }> = []) => {
    const answers = [[[{ hoursSince }]], [[{ n }]], [recent]];
    return { execute: async () => answers.shift() };
  };

  it("maps the reads into a measured reading (TiDB returns numbers as strings)", async () => {
    await expect(readReelLane(fake("101", "2"))).resolves.toEqual({ kind: "measured", hoursSinceLastPost: 101, readyAwaitingApproval: 2, deliveredIssues: [], deliveredUnmeasured: [], providerDrift: [] });
  });

  it("collects delivered-copy QA failures and skips unparseable payloads", async () => {
    const r = await readReelLane(fake("5", "0", [
      { id: 7, payload: JSON.stringify({ deliveredQa: { verdict: "issues", issues: ["audio_lost"] } }) },
      { id: 6, payload: JSON.stringify({ deliveredQa: { verdict: "pass", issues: [] } }) },
      { id: 5, payload: "{not json" },
    ]));
    expect(r).toMatchObject({ deliveredIssues: [{ jobId: 7, issues: ["audio_lost"] }] });
    expect(renderDeliveredQaException(r)).toBe("1 posted Reel(s) look worse on Instagram than the master — job 7: audio_lost");
    expect(renderReelLaneException(r)).toBeNull();
  });

  it("a delivered-copy check that could not run in 3 attempts is said out loud, never read as healthy", async () => {
    const r = await readReelLane(fake("5", "0", [
      { id: 11, payload: JSON.stringify({ deliveredQa: { verdict: "unmeasured", issues: [], attempts: 3, reason: "delivered URL unavailable: Instagram not configured (need META_PAGE_ACCESS_TOKEN)" } }) },
      { id: 10, payload: JSON.stringify({ deliveredQa: { verdict: "unmeasured", issues: [], attempts: 1, reason: "ffprobe exited 1" } }) }, // still retrying: not reported
    ]));
    expect(r).toMatchObject({ deliveredUnmeasured: [{ jobId: 11 }] });
    expect(renderDeliveredQaException(r)).toBe(
      "Delivered-copy QA UNMEASURED for 1 posted Reel(s) after 3 attempts — delivered URL unavailable: Instagram not configured (need META_PAGE_ACCESS_TOKEN) (job 11)",
    );
  });

  it("collects clip probes from assembled and posted rows and reports a provider whose clips changed shape", async () => {
    const probe = (beatNumber: number, over: Record<string, unknown> = {}) => ({ beatNumber, provider: "higgsfield", width: 1080, height: 1920, fps: 24, durationSec: 5, ...over });
    const r = await readReelLane(fake("5", "0", [
      { id: 9, payload: JSON.stringify({ clipProbes: [probe(1, { width: 720, height: 1280 }), probe(2, { width: 720, height: 1280 }), probe(3)] }) },
      { id: 8, payload: JSON.stringify({ clipProbes: [probe(1), probe(2), probe(3)] }) },
    ]));
    expect(r.kind === "measured" && r.providerDrift?.[0]).toMatchObject({ provider: "higgsfield", baseline: "1080x1920@24", baselineShare: 4 / 6, total: 6 });
    expect(renderProviderDriftException(r)).toBe(
      "Provider drift: 2 of 6 higgsfield clips this week came back off its 1080x1920@24 / 5s baseline (e.g. 720x1280@24 5s, job 9 beat 1) — check the provider before the next paid run",
    );
  });

  it("a window with no majority shape is reported as a provider change, not as drift from a norm", async () => {
    const probe = (beatNumber: number, over: Record<string, unknown> = {}) => ({ beatNumber, provider: "higgsfield", width: 1080, height: 1920, fps: 24, durationSec: 5, ...over });
    const r = await readReelLane(fake("5", "0", [
      { id: 9, payload: JSON.stringify({ clipProbes: [probe(1, { width: 720, height: 1280 }), probe(2, { width: 720, height: 1280 }), probe(3, { width: 720, height: 1280 })] }) },
      { id: 8, payload: JSON.stringify({ clipProbes: [probe(1), probe(2), probe(3)] }) },
    ]));
    expect(renderProviderDriftException(r)).toMatch(/^Provider drift: higgsfield clips this week have no majority shape \(most common 1080x1920@24 holds 50% of 6; e\.g\. 720x1280@24 5s, job 9 beat 1\)/);
  });

  it("one odd clip is a glitch, not drift: no line", async () => {
    const probe = (beatNumber: number, over: Record<string, unknown> = {}) => ({ beatNumber, provider: "higgsfield", width: 1080, height: 1920, fps: 24, durationSec: 5, ...over });
    const r = await readReelLane(fake("5", "0", [
      { id: 9, payload: JSON.stringify({ clipProbes: [probe(1, { durationSec: 2.1 }), probe(2), probe(3), probe(4), probe(5)] }) },
    ]));
    expect(renderProviderDriftException(r)).toBeNull();
  });

  it("no posted row → null hours, which renders as a stall", async () => {
    const r = await readReelLane(fake(null, 0));
    expect(r).toEqual({ kind: "measured", hoursSinceLastPost: null, readyAwaitingApproval: 0, deliveredIssues: [], deliveredUnmeasured: [], providerDrift: [] });
    expect(renderReelLaneException(r)).not.toBeNull();
  });

  it("a throwing query propagates, so the caller can render UNKNOWN", async () => {
    await expect(readReelLane({ execute: async () => { throw new Error("db down"); } })).rejects.toThrow("db down");
  });
});

describe("wiring", () => {
  it("the morning brief's EXCEPTIONS block reads the lane and maps a throw to UNKNOWN", () => {
    const src = readFileSync(new URL("../cron/jobs/morningBrief.ts", import.meta.url), "utf8");
    const block = sliceBlock(src, "Exception brief (Autopilot Wave 2)", "Promise ledger truth", { label: "morningBrief.ts" });
    expect(block).toContain('import("../../services/reelLaneHealth")');
    expect(block).toContain("renderReelLaneException(");
    expect(block).toContain("if (line) parts.push(line);");
    expect(block).toContain("if (delivered) parts.push(delivered);");
    expect(block).toContain("if (drift) parts.push(drift);");
    expect(block).toContain('parts.push("Instagram Reel lane UNKNOWN');
  });
});
