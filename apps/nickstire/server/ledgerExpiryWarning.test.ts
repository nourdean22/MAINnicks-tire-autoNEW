/**
 * Lead time for the capability-ledger gate (2026-10-15).
 *
 * check-capability-ledger.mjs exits 1 for EVERY pull request the moment a
 * load-bearing claim (exposure production or limited_autonomy) passes its
 * verificationExpiresAt: first hit 2026-10-15 01:07Z on `shopstate-lot-band`,
 * with no earlier sign. The script now prints one warning per such entry inside
 * 14 days of its date. A warning is lead time, not a verdict, so the contract
 * pinned here is the EXIT CODE and the OUTPUT together, on the real script run
 * as a child process the way .github/workflows/completion-authority.yml runs it.
 *
 * Arms are tagged:
 *   FAILS-ON-OLD - red against the script before this change (it printed
 *                  nothing for a claim still inside its date);
 *   PINS         - same verdict on old and new, red under the named mutation.
 * LEDGER_CHECKER=<path to a copy of the script> runs every CLI arm against that
 * copy, which is how both claims were checked.
 *
 * Fixture dates are relative to the real clock because the CLI reads it. Every
 * one sits half a day clear of a day boundary, so a slow machine cannot move an
 * entry across it. The exact edges are pinned below with an injected `now`.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error - plain .mjs module, no type declarations by design
import { assessExpiringSoon, assessFreshness } from "../scripts/check-capability-ledger.mjs";

const DAY = 86_400_000;
const SCRIPT = process.env.LEDGER_CHECKER ?? join(__dirname, "..", "scripts", "check-capability-ledger.mjs");

/** A valid, fully evidenced production claim; `over` bends one field at a time. */
const entry = (id: string, over: Record<string, unknown> = {}) => ({
  capabilityId: id,
  name: id,
  owner: "op",
  codeState: "merged",
  operationalState: "live_verified",
  exposure: "production",
  evidence: { tests: ["t"], codeCommit: "c", deploymentId: "d", liveRuns: ["r"] },
  blockers: [],
  deferredScope: [],
  ...over,
});
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function runCli(capabilities: unknown[], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ledger-expiry-"));
  try {
    const file = join(dir, "ledger.json");
    writeFileSync(file, JSON.stringify({ capabilities }));
    // CI sets GITHUB_ACTIONS itself and the child inherits it, so every arm sets it explicitly.
    const r = spawnSync(process.execPath, [SCRIPT, file], {
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, GITHUB_ACTIONS: "", ...env },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the CLI, run the way completion-authority.yml runs it", () => {
  it("FAILS-ON-OLD - warns about a load-bearing claim a week out, and the exit code stays 0", () => {
    const r = runCli([entry("fx-soon", { verificationExpiresAt: inDays(7.5) })]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^note: ledger entry fx-soon expires \S+ \(7d left, live_verified @ production\)/m);
    expect(r.out).toMatch(/Re-prove it .* or lower the claim \(scripts\/regress-capability\.mjs\)/);
    expect(r.out).toMatch(/capability ledger valid/); // the run still ends in its normal success line
  });

  it("FAILS-ON-OLD - warns all the way to the window edge, not only in the last few days", () => {
    const r = runCli([entry("fx-edge", { verificationExpiresAt: inDays(13.5) })]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^note: ledger entry fx-edge expires \S+ \(13d left,/m);
  });

  it("FAILS-ON-OLD - limited_autonomy is load-bearing too", () => {
    const r = runCli([entry("fx-lim", { exposure: "limited_autonomy", verificationExpiresAt: inDays(3.5) })]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^note: ledger entry fx-lim expires \S+ \(3d left, live_verified @ limited_autonomy\)/m);
  });

  it.each([
    ["a load-bearing claim 14.5 days out", entry("fx-far", { verificationExpiresAt: inDays(14.5) })],
    ["a load-bearing claim 30 days out", entry("fx-30", { verificationExpiresAt: inDays(30) })],
    ["an internal claim 7 days out", entry("fx-int", { exposure: "internal", verificationExpiresAt: inDays(7.5) })],
    ["an operator_only claim 7 days out", entry("fx-op", { exposure: "operator_only", verificationExpiresAt: inDays(7.5) })],
  ])("PINS - says nothing about %s", (_label, cap) => {
    const r = runCli([cap]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/capability ledger valid/); // it ran to the end; silence is not a crash
    expect(r.out + r.err).not.toMatch(/ledger entry|note:|::warning/);
  });

  it("PINS - an expired load-bearing claim still exits 1 and is reported as expired, never as a warning", () => {
    const r = runCli([entry("fx-expired", { verificationExpiresAt: inDays(-1) })]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/fx-expired.*expired.*LOAD-BEARING/);
    expect(r.out).not.toMatch(/ledger entry|note:/);
  });

  it("FAILS-ON-OLD - a run that fails anyway still shows what expires next", () => {
    const r = runCli([
      entry("fx-expired", { verificationExpiresAt: inDays(-1) }),
      entry("fx-next", { verificationExpiresAt: inDays(7.5) }),
    ]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/fx-expired.*LOAD-BEARING/);
    expect(r.out).toMatch(/^note: ledger entry fx-next expires/m);
    expect(r.out).not.toMatch(/ledger entry fx-expired/);

    const invalid = runCli([
      entry("fx-bad", { exposure: "operator_only", operationalState: "unverified", evidence: {} }),
      entry("fx-next", { verificationExpiresAt: inDays(7.5) }),
    ]);
    expect(invalid.code).toBe(1);
    expect(invalid.err).toMatch(/capability ledger INVALID/);
    expect(invalid.out).toMatch(/^note: ledger entry fx-next expires/m);
  });

  it("FAILS-ON-OLD - under GitHub Actions the same text is a workflow annotation", () => {
    const r = runCli([entry("fx-soon", { verificationExpiresAt: inDays(7.5) })], { GITHUB_ACTIONS: "true" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^::warning title=Load-bearing ledger claim expiring soon::ledger entry fx-soon expires /m);
    expect(r.out).not.toMatch(/^note:/m);
  });

  it("FAILS-ON-OLD - an id cannot end the annotation and start another workflow command", () => {
    const r = runCli([entry("fx-evil\n::error::boom 100%", { verificationExpiresAt: inDays(7.5) })], {
      GITHUB_ACTIONS: "true",
    });
    expect(r.code).toBe(0);
    const commands = r.out.split("\n").filter((line) => line.startsWith("::"));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatch(/^::warning /);
    expect(commands[0]).toContain("fx-evil%0A::error::boom 100%25");
  });
});

describe("assessExpiringSoon - the window edges", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");
  const ledgerAt = (offsetMs: number, over: Record<string, unknown> = {}) => ({
    capabilities: [entry("e", { verificationExpiresAt: new Date(now.getTime() + offsetMs).toISOString(), ...over })],
  });
  const soon = (offsetMs: number, over: Record<string, unknown> = {}) => assessExpiringSoon(ledgerAt(offsetMs, over), now);
  const stale = (offsetMs: number) => assessFreshness(ledgerAt(offsetMs), now);

  it("includes the 14-day edge and excludes one millisecond past it", () => {
    expect(soon(14 * DAY)).toHaveLength(1);
    expect(soon(14 * DAY + 1)).toHaveLength(0);
  });

  it("hands over to assessFreshness with no gap and no overlap", () => {
    // Expiring exactly now is not stale yet (assessFreshness) and is the last warning (0 days left).
    expect(stale(0)).toHaveLength(0);
    expect(soon(0)).toHaveLength(1);
    // One millisecond later it is stale and no longer a warning.
    expect(stale(-1)).toHaveLength(1);
    expect(soon(-1)).toHaveLength(0);
    // Across the whole range exactly one list claims the entry until it is past the window.
    for (let hours = -72; hours <= 14 * 24 + 48; hours += 6) {
      const offset = hours * 3_600_000;
      const claimed = stale(offset).length + soon(offset).length;
      expect(claimed, `offset ${hours}h`).toBe(hours <= 14 * 24 ? 1 : 0);
    }
  });

  it("counts whole days left, rounding down, with the finding's fields", () => {
    expect(soon(7 * DAY + 23 * 3_600_000)[0]).toMatchObject({
      capabilityId: "e",
      daysLeft: 7,
      exposure: "production",
      operationalState: "live_verified",
    });
    expect(soon(1)[0].daysLeft).toBe(0);
    expect(soon(14 * DAY)[0].daysLeft).toBe(14);
  });

  it("forecasts exactly the claims whose expiry would fail the build", () => {
    const later = new Date(now.getTime() + 2 * DAY);
    for (const exposure of ["disabled", "shadow", "internal", "operator_only", "limited_autonomy", "production"]) {
      const forecast = soon(DAY, { exposure }).length === 1;
      const wouldBlock = assessFreshness(ledgerAt(DAY, { exposure }), later).some((f: { blocking: boolean }) => f.blocking);
      expect(forecast, exposure).toBe(wouldBlock);
    }
    expect(soon(DAY, { exposure: "production" })).toHaveLength(1);
    expect(soon(DAY, { exposure: "internal" })).toHaveLength(0);
  });

  it("skips what assessFreshness skips: no date, an unparseable date, no capabilities", () => {
    const { verificationExpiresAt: _omit, ...undated } = entry("n", { verificationExpiresAt: "2026-10-16" });
    expect(assessExpiringSoon({ capabilities: [undated, entry("u", { verificationExpiresAt: "soon" })] }, now)).toEqual([]);
    expect(assessExpiringSoon({}, now)).toEqual([]);
  });
});
