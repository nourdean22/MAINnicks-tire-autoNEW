/**
 * Trial-reel tracking pins (Wave C′) — code-shaped raw-source anchors (no
 * comment stripping; see igEvidence.test.ts for why).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(process.cwd(), "server/routers/instagramAdmin.ts"), "utf8");
const PROC = SRC.slice(SRC.indexOf("recordTrialResult:"));

describe("recordTrialResult contract", () => {
  it("exists and takes the optimistic-concurrency token", () => {
    expect(PROC.length).toBeGreaterThan(100);
    expect(PROC).toContain("expectedVersion: z.number().int().min(1)");
  });

  it("CAS-updates on version and fails CLOSED via affectedRowCount — the `?? 1` class stays dead", () => {
    const body = PROC.slice(0, PROC.indexOf("return { ok: true"));
    expect(body).toContain("affectedRowCount");
    expect(body).toContain("eq(socialContentInventory.version, input.expectedVersion)");
    expect(body).toContain('code: "CONFLICT"');
  });

  it("merges only entered fields so a partial save cannot null earlier numbers", () => {
    expect(PROC).toContain("filter(([, v]) => v !== undefined)");
  });

  it("the trial input is strict — unknown keys are rejected, not silently stored", () => {
    expect(PROC).toContain(".strict()");
  });
});
