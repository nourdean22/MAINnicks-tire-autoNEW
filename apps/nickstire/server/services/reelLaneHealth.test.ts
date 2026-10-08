import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sliceBlock } from "../testUtils/sourceBlock";
import { readReelLane, renderReelLaneException } from "./reelLaneHealth";

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
  const fake = (hoursSince: unknown, n: unknown) => {
    const answers = [[[{ hoursSince }]], [[{ n }]]];
    return { execute: async () => answers.shift() };
  };

  it("maps the two reads into a measured reading (TiDB returns numbers as strings)", async () => {
    await expect(readReelLane(fake("101", "2"))).resolves.toEqual({ kind: "measured", hoursSinceLastPost: 101, readyAwaitingApproval: 2 });
  });

  it("no posted row → null hours, which renders as a stall", async () => {
    const r = await readReelLane(fake(null, 0));
    expect(r).toEqual({ kind: "measured", hoursSinceLastPost: null, readyAwaitingApproval: 0 });
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
    expect(block).toContain('parts.push("Instagram Reel lane UNKNOWN');
  });
});
