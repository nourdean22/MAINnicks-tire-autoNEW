/**
 * Structure rules: the sentence shapes that make shop copy read machine-written
 * (job 2026-10-30-antislop-humanizer-pages, PR F). KILL_RULES bans words; these ban
 * shapes: a dash as the all-purpose connector, a stacked "no X, no Y" tail, a
 * one-line closer, and the doubled "Honest X, honest Y" meta line.
 *
 * They live in a SEPARATE list on purpose. KILL_RULES also feeds the IG generator
 * and critic prompts, the runtime SMS and social checks, and the voice-compliance
 * debt baseline; a dash rule there would change live behaviour in other lanes. Only
 * scripts/lint-brand-voice.ts reads STRUCTURE_RULES, and only on web and meta copy.
 */
import { describe, expect, it } from "vitest";
import {
  findVoiceViolations,
  KILL_RULES,
  renderBannedWordsForPrompt,
  STRUCTURE_RULES,
} from "./voice";

const ids = (text: string, surface: "web" | "meta" | "sms" | "voice" | "social" | "admin" = "web") =>
  findVoiceViolations(text, { surface, rules: STRUCTURE_RULES }).map((v) => v.ruleId);

describe("structure rules fire on the shapes they ban (positive control)", () => {
  it.each([
    ["structure.dash", "Written quote — you approve first."],
    ["structure.dash", "Pads – rotors"],
    ["structure.dash", "Closed Sunday &mdash; open Monday."],
    ["structure.dash", "Pads -- rotors"],
    ["structure.negation-tail", "Free check. No pressure, no upsells."],
    ["structure.negation-tail", "We fix it right, no guessing."],
    ["structure.closer", "The metal doesn't lie. Neither do we."],
    ["structure.honest-doubled", "Honest parts, honest work."],
  ])("%s fires on %j", (id, text) => {
    expect(ids(text)).toContain(id);
  });
});

describe("structure rules spare what they must not touch", () => {
  it("passes plain copy", () => {
    expect(ids("Written quote first. You approve it before we start.")).toEqual([]);
    expect(ids("No appointment needed. Walk in any day.")).toEqual([]);
    expect(ids("Honest answer before any work.")).toEqual([]);
  });

  it("spares a string that is only a dash (an empty-value placeholder)", () => {
    expect(ids('{value ?? "—"}')).toEqual([]);
    expect(ids("const empty = '—';")).toEqual([]);
    // Control: the same character in prose still fires.
    expect(ids('{value ?? "—"} Pads — rotors')).toContain("structure.dash");
  });

  it.each(["sms", "voice", "social", "admin"] as const)("does not apply to the %s surface", (surface) => {
    expect(ids("Written quote — no pressure, no upsells.", surface)).toEqual([]);
  });

  it("applies to meta copy", () => {
    expect(ids("Brakes — Nick's Tire & Auto", "meta")).toContain("structure.dash");
  });
});

describe("structure rules stay out of KILL_RULES, prompts and the default scan", () => {
  it("no structure rule id is in KILL_RULES", () => {
    const kill = new Set(KILL_RULES.map((r) => r.id));
    expect(STRUCTURE_RULES.filter((r) => kill.has(r.id)).map((r) => r.id)).toEqual([]);
  });

  it("the IG prompt text is unchanged by the structure rules", () => {
    const prompt = renderBannedWordsForPrompt({ surface: "social" });
    for (const r of STRUCTURE_RULES) expect(prompt).not.toContain(r.label);
  });

  it("a default scan (no rules option) runs KILL_RULES only, so runtime SMS and social checks are unchanged", () => {
    expect(findVoiceViolations("Written quote — no pressure, no upsells.", { surface: "web" }).map((v) => v.ruleId))
      .not.toContain("structure.dash");
  });

  it("every structure rule is well formed (no global flag, why, fix, label, source)", () => {
    for (const r of STRUCTURE_RULES) {
      expect(r.pattern.flags).not.toContain("g");
      expect(r.why && r.fix && r.label && r.sources.length).toBeTruthy();
      expect(r.exempt).toEqual(expect.arrayContaining(["sms", "voice", "social", "admin"]));
    }
  });
});

describe("the dated warn ramp (scripts/lib/brandVoiceScope.ts)", () => {
  const BEFORE = new Date("2026-11-01T12:00:00-05:00");
  const AFTER = new Date("2026-12-01T12:00:00-05:00");

  it("blocks structure hits in a cleaned file now", async () => {
    const { effectiveSeverity } = await import("../scripts/lib/brandVoiceScope");
    expect(effectiveSeverity("client/src/pages/Home.tsx", "structure.dash", "block", BEFORE)).toBe("block");
  });

  it("reports structure hits elsewhere, and any hit in a newly scoped data file, as warn before the date", async () => {
    const { effectiveSeverity } = await import("../scripts/lib/brandVoiceScope");
    expect(effectiveSeverity("client/src/pages/About.tsx", "structure.dash", "block", BEFORE)).toBe("warn");
    expect(effectiveSeverity("shared/blog.ts", "cliche.quality", "block", BEFORE)).toBe("warn");
  });

  it("keeps word rules blocking on pages that were already in scope", async () => {
    const { effectiveSeverity } = await import("../scripts/lib/brandVoiceScope");
    expect(effectiveSeverity("client/src/pages/About.tsx", "cliche.reliable", "block", BEFORE)).toBe("block");
  });

  it("blocks everything after the date", async () => {
    const { effectiveSeverity } = await import("../scripts/lib/brandVoiceScope");
    expect(effectiveSeverity("client/src/pages/About.tsx", "structure.dash", "block", AFTER)).toBe("block");
    expect(effectiveSeverity("shared/blog.ts", "cliche.quality", "block", AFTER)).toBe("block");
  });

  it("the ramp has not expired: on its date, finish the page groups or renew it with a reason", async () => {
    const { STRUCTURE_WARN_UNTIL } = await import("../scripts/lib/brandVoiceScope");
    expect(Date.now()).toBeLessThan(Date.parse(`${STRUCTURE_WARN_UNTIL}T23:59:59-05:00`));
  });
});
