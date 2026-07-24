/**
 * Admin false-green regression pins (admin-wide register Wave 1, 2026-07-24).
 *
 * The defect class: a failed query falling through `?? 0` / `?? []` /
 * undefined-checks into the SCREEN'S HAPPIEST STATE — "$0 owed", "All
 * clear", "QUIET DAY", "All Caught Up!", "F25e live", emerald "Avg: 0m".
 * Failure must render as unknown, never as good news. Source pins, same
 * pattern as emptyIsNotUnknown.test.ts (which pinned this class for the
 * Instagram queues — this file extends it to the rest of the admin).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), `client/src/pages/admin/${p}`), "utf8");

describe("money never reports collected when it could not look", () => {
  it("UnpaidInvoices captures isError and refuses the paid-in-full empty state on failure", () => {
    const s = read("money/UnpaidInvoicesSection.tsx");
    expect(s).toMatch(/isError/);
    expect(s).toMatch(/UNKNOWN IS NOT ZERO/);
  });
});

describe("Settings cannot say All clear over checks that never ran", () => {
  it("the hook reports failedChecks per query", () => {
    const s = read("settings/useSettingsStatus.ts");
    expect(s).toMatch(/failedChecks/);
    for (const flag of ["isDashStatsError", "isFlagsError", "isFunnelError", "isAlgError", "isSmsGwError", "isSmsStatusError", "isVapiError", "isCronError"]) {
      expect(s).toContain(flag);
    }
  });

  it("the tab renders an unknown banner before it will render All clear", () => {
    const s = read("settings/SettingsStatusTab.tsx");
    expect(s).toMatch(/failedChecks\.length > 0 \?/);
    expect(s).toMatch(/could not run/);
  });
});

describe("Voice tells the truth about what it knows", () => {
  const voice = () => read("VoiceReceptionistSection.tsx");

  it("a failed metrics read is METRICS UNREADABLE, never QUIET DAY", () => {
    expect(voice()).toMatch(/METRICS UNREADABLE/);
    expect(voice()).toMatch(/metricsError\s*\?/);
  });

  it("the metrics skeleton resolves to an error block instead of shimmering forever", () => {
    expect(voice()).toMatch(/metricsError \?/);
  });

  it("the Action Required pill is driven by queue contents, not tab selection", () => {
    const s = voice();
    expect(s).not.toMatch(/Action Required/);
    expect(s).toMatch(/queueItems!\.length/);
    expect(s).toMatch(/queueError &&/);
  });

  it("All Caught Up! requires a successful read", () => {
    expect(voice()).toMatch(/queueError \?/);
    expect(voice()).toMatch(/Queue unreadable/);
  });

  it("copy-to-clipboard confirms only on promise success", () => {
    expect(voice()).toMatch(/clipboard\.writeText\(text\)\.then\(/);
  });
});

describe("MorningBrief never fabricates gateway liveness", () => {
  it("F25e live requires online === true; undefined is its own state", () => {
    const s = read("today/MorningBrief.tsx");
    expect(s).toMatch(/online === true \? "F25e live"/);
    expect(s).toMatch(/F25e status unknown/);
  });
});

describe("LeadSLAMonitor never paints emerald Avg: 0m from a failed read", () => {
  it("captures isError and renders an unknown card", () => {
    const s = read("intelligence/LeadSLAMonitor.tsx");
    expect(s).toMatch(/isError/);
    expect(s).toMatch(/unknown<\/strong>, not 0 minutes/);
  });
});

describe("no raw alert()/confirm()/prompt() in the SMS orchestrator (dead in the iOS PWA)", () => {
  it("SmsOrchestratorSection uses toasts with real error detail", () => {
    const s = read("outreach/SmsOrchestratorSection.tsx");
    expect(s).not.toMatch(/\balert\(/);
    expect(s).toMatch(/toast\.error\("Failed to export training corpus"/);
  });
});
