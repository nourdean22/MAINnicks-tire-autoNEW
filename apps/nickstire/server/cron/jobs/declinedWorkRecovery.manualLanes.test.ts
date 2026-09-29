/**
 * The manual declined-work lanes: the admin "run now" button and
 * scripts/fire-declined-recovery.ts (2026-09-29).
 *
 * Red on origin/main 1f7084b57: neither export existed; the admin mutation and
 * the CLI called runDeclinedWorkRecovery directly, skipping the estimate-invoice
 * match the scheduled lane requires first; and the CLI's --dry-run relied on
 * FEATURE_DECLINED_RECOVERY being unset, so with the flag on it sent.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sliceBlock } from "../../testUtils/sourceBlock";
import { recoverySendsEnabled, runDeclinedWorkRecoveryAfterMatch } from "./declinedWorkRecovery";

const APP = join(__dirname, "..", "..", "..");

describe("recoverySendsEnabled", () => {
  it("an explicit dry run never sends, even with the env flag on or the gate skipped", () => {
    expect(recoverySendsEnabled({ FEATURE_DECLINED_RECOVERY: "1" }, { dryRun: true })).toBe(false);
    expect(recoverySendsEnabled({}, { dryRun: true, skipDryRunGate: true })).toBe(false);
  });

  it("otherwise the env flag or the operator's skip enables sends, as before", () => {
    expect(recoverySendsEnabled({ FEATURE_DECLINED_RECOVERY: "1" })).toBe(true);
    expect(recoverySendsEnabled({}, { skipDryRunGate: true })).toBe(true);
    expect(recoverySendsEnabled({})).toBe(false);
    expect(recoverySendsEnabled({ FEATURE_DECLINED_RECOVERY: "true" })).toBe(false);
  });
});

describe("runDeclinedWorkRecoveryAfterMatch", () => {
  it("sends nothing when the estimate-invoice match fails", async () => {
    const recover = vi.fn();
    const r = await runDeclinedWorkRecoveryAfterMatch({ skipDryRunGate: true }, {
      match: async () => {
        throw new Error("database unavailable");
      },
      recover,
    });
    expect(recover).not.toHaveBeenCalled();
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/match failed, so nothing was sent/);
  });

  it("matches first, then runs the sender with the same options", async () => {
    const calls: string[] = [];
    const opts = { maxSends: 7, bypassBusinessHoursCheck: true, skipDryRunGate: true };
    const r = await runDeclinedWorkRecoveryAfterMatch(opts, {
      match: async (dryRun) => {
        calls.push(`match:${dryRun}`);
        return { matched: 3, scanned: 40 };
      },
      recover: async (o) => {
        calls.push("recover");
        expect(o).toEqual(opts);
        return { recordsProcessed: 5, details: "5 sent" };
      },
    });
    expect(calls).toEqual(["match:false", "recover"]);
    expect(r.recordsProcessed).toBe(5);
    expect(r.details).toMatch(/^matched 3 of 40 .* · 5 sent$/);
  });

  it("a dry run matches in dry-run mode, so nothing is written", async () => {
    const match = vi.fn(async () => ({ matched: 2, scanned: 9 }));
    const r = await runDeclinedWorkRecoveryAfterMatch({ dryRun: true }, {
      match,
      recover: async () => ({ recordsProcessed: 4, details: "DRY RUN" }),
    });
    expect(match).toHaveBeenCalledWith(true);
    expect(r.details).toMatch(/would clear 2 of 9/);
  });
});

describe("the manual lanes reach the wrapper (the consumer half)", () => {
  it("the admin run-now mutation matches first", () => {
    const src = readFileSync(join(APP, "server", "routers", "advanced", "invoices.ts"), "utf8");
    const mutation = sliceBlock(src, "runDeclinedRecoveryNow:", "}),", { label: "invoices.ts" });
    expect(mutation).toContain("runDeclinedWorkRecoveryAfterMatch({");
    expect(mutation).not.toMatch(/runDeclinedWorkRecovery\(/);
  });

  it("the CLI uses the wrapper on both paths, and its dry run passes dryRun: true", () => {
    const src = readFileSync(join(APP, "scripts", "fire-declined-recovery.ts"), "utf8");
    expect(src.match(/runDeclinedWorkRecoveryAfterMatch\(\{/g)?.length).toBe(2);
    expect(src).not.toMatch(/runDeclinedWorkRecovery\(\{/);
    const dryBranch = sliceBlock(src, "if (dryRun) {", "} else {", { label: "fire-declined-recovery.ts" });
    expect(dryBranch).toMatch(/dryRun: true,/);
  });
});
