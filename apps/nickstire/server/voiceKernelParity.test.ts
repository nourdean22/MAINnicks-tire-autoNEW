/**
 * Voice Kernel parity — the guard that keeps the voice singular.
 *
 * Nick's brand voice was defined in seven places and no two agreed. This suite
 * exists so that can never silently happen again. It fails the build when:
 *
 *   1. a consumer grows its own word list instead of importing the kernel;
 *   2. either governing document re-grows a hand-written kill list;
 *   3. the IG generator prompt and the IG critic prompt stop banning the same
 *      set (they diverged inside a single file before the kernel);
 *   4. a deleted duplicate of the linter comes back;
 *   5. a kernel rule is malformed in a way that makes it silently useless.
 *
 * Precedent for the pattern: `nickSmsPersona.ts` (ROS-042) and
 * `businessFacts.ts` (ROS-043) — same disease, same cure, both pinned by tests.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  KILL_RULES,
  KILL_RULE_IDS,
  VOICE_PATTERNS,
  findVoiceViolations,
  renderBannedWordsForPrompt,
  renderCriticRubricForPrompt,
  renderVoiceRulesForPrompt,
} from "../shared/voice";

const APP = process.cwd();
const read = (rel: string) => readFileSync(join(APP, rel), "utf-8");

/**
 * Files that must source their rules from the kernel. A local array of banned
 * words in any of these is the exact regression this kernel was built to end.
 */
const KERNEL_CONSUMERS = [
  "scripts/lint-brand-voice.ts",
  "server/services/igAutopost.ts",
  "server/voice-compliance.test.ts",
];

/** Duplicates that were deleted. Their return means the drift has restarted. */
const DELETED_DUPLICATES = [
  "scripts/lint-brand-voice.mjs",
  "scripts/diagnostics/lint-brand-voice.mjs",
];

describe("Voice Kernel — single source of truth", () => {
  it.each(KERNEL_CONSUMERS)("%s imports the kernel", (file) => {
    expect(read(file)).toMatch(/from ["'](?:@shared|\.\.\/shared)\/voice["']/);
  });

  it.each(KERNEL_CONSUMERS)("%s declares no local kill list", (file) => {
    const src = read(file);
    // A local `const KILL_LIST = [` / `const BANNED_WORDS = [` etc.
    expect(src).not.toMatch(/\bconst\s+(?:KILL_LIST|BANNED_WORDS|BANNED|CLICHES?)\s*(?::[^=]+)?=\s*\[/);
  });

  it.each(DELETED_DUPLICATES)("%s stays deleted", (file) => {
    expect(existsSync(join(APP, file))).toBe(false);
  });

  it("no source file outside the kernel hardcodes the signature banned-word run", () => {
    // The literal comma-run that appeared in both igAutopost prompts. If it
    // shows up anywhere again, someone re-inlined the list.
    const generator = read("server/services/igAutopost.ts");
    expect(generator).not.toMatch(/trusted,\s*expert/i);
  });
});

describe("Voice Kernel — generator and critic cannot drift apart", () => {
  it("the critic bans every phrase the generator bans", () => {
    const generator = renderBannedWordsForPrompt({ surface: "social" });
    const critic = renderCriticRubricForPrompt();
    const blocking = KILL_RULES.filter((r) => r.severity === "block");
    for (const rule of blocking) {
      if (rule.exempt?.includes("social")) continue;
      expect(generator, `generator missing: ${rule.id}`).toContain(rule.label);
      expect(critic, `critic missing: ${rule.id}`).toContain(rule.label);
    }
  });

  it("igAutopost renders both prompts from the kernel rather than literals", () => {
    const src = read("server/services/igAutopost.ts");
    expect(src).toContain("renderBannedWordsForPrompt");
    expect(src).toContain("renderCriticRubricForPrompt");
  });

  it("igAutopost quotes no hardcoded price in its critic rubric", () => {
    // The rubric used to hardcode "used tires from $60 installed" — the exact
    // fabricated floor ROS-058 removed as a reinfection vector — so the judge
    // scored the SSOT-correct "from $25 installed" as 0.0 price-compliance.
    // Prices must interpolate BUSINESS, never be restated.
    const src = read("server/services/igAutopost.ts");
    const rubric = src.slice(src.indexOf("function buildEvalSystemPrompt"));
    const evalBlock = rubric
      .slice(0, rubric.indexOf("\n}"))
      // Comments may legitimately name the old drifted figure while explaining
      // why it is gone. Only the emitted prompt text is under test.
      .replace(/\/\/[^\n]*/g, "");
    expect(evalBlock).not.toMatch(/\$\d/);
  });
});

describe("Voice Kernel — governing documents hold no second list", () => {
  const DOCS = ["docs/brand/VOICE.md", ".claude/brand-voice-guidelines.md"];

  it.each(DOCS)("%s points at the kernel", (doc) => {
    expect(read(doc)).toContain("shared/voice.ts");
  });

  it("VOICE.md no longer carries the kill-list table", () => {
    const md = read("docs/brand/VOICE.md");
    expect(md).not.toMatch(/^\|\s*Phrase\s*\|\s*Why kill\s*\|/m);
  });

  it("brand-voice-guidelines.md section 3 no longer carries the kill-list bullets", () => {
    const md = read(".claude/brand-voice-guidelines.md");
    // Scoped to section 3 on purpose: later sections carry unrelated ❌ bullets
    // (availability and FCFS phrasing) that are guidance, not a word list.
    const start = md.indexOf("## 3. The Kill List");
    expect(start, "section 3 heading missing").toBeGreaterThan(-1);
    const section = md.slice(start, md.indexOf("\n## ", start + 1));
    expect(section.match(/^-\s*❌\s*"/gm) ?? []).toEqual([]);
    expect(section).toContain("shared/voice.ts");
  });
});

describe("Voice Kernel — rule hygiene", () => {
  it("rule ids are unique", () => {
    expect(new Set(KILL_RULE_IDS).size).toBe(KILL_RULE_IDS.length);
  });

  it("every rule carries a why, a fix, a label and at least one source", () => {
    for (const r of KILL_RULES) {
      expect(r.why.length, r.id).toBeGreaterThan(0);
      expect(r.fix.length, r.id).toBeGreaterThan(0);
      expect(r.label.length, r.id).toBeGreaterThan(0);
      expect(r.sources.length, r.id).toBeGreaterThan(0);
    }
  });

  it("no rule pattern carries the global flag", () => {
    // A shared global regex carries mutable lastIndex between callers — the
    // precise cross-consumer state bug this kernel exists to prevent. The
    // matcher builds a fresh global copy per scan instead.
    for (const r of KILL_RULES) {
      expect(r.pattern.flags, r.id).not.toContain("g");
    }
  });

  it("every rule actually matches something it claims to ban", () => {
    // A rule whose pattern can never fire is worse than no rule: it reads as
    // coverage. Each rule must match its own label or a documented probe.
    const PROBES: Record<string, string> = {
      "cliche.reliable": "a reliable shop",
      "cliche.family-owned": "family-owned",
      // NOT "best tire shop" — that is an allowlisted SEO query target, which
      // is itself worth pinning: the probe proves the rule fires on
      // self-description while the allowlist test proves it spares the query.
      "archetype.hero-superlative": "the best mechanic around",
      "archetype.certified-technicians": "certified technicians on staff",
      "archetype.empowering": "empowering you to choose",
      "archetype.award-winning": "award-winning shop",
      "archetype.trust-me": "experience you can trust",
      "llm.preamble": "let's dive in",
      "llm.unleash": "unlock your savings",
      "positioning.appointment-language": "Book Appointment",
      "positioning.schedule-appointment": "Schedule Appointment",
      "positioning.cheap": "affordable tires",
      "positioning.acima-credit-language": "Acima financing",
      "bot.have-a-great-day": "have a great day",
    };
    for (const r of KILL_RULES) {
      const probe = PROBES[r.id] ?? r.label;
      const hits = findVoiceViolations(probe).filter((v) => v.ruleId === r.id);
      expect(hits.length, `${r.id} never fires on "${probe}"`).toBeGreaterThan(0);
    }
  });

  it("allowlisted phrases suppress the rule they are attached to", () => {
    // The drift case and its exception, pinned together.
    expect(findVoiceViolations("Grounded & Reliable strategy")).toEqual([]);
    expect(findVoiceViolations("Safe, reliable braking").map((v) => v.ruleId)).toContain(
      "cliche.reliable",
    );
    expect(findVoiceViolations("ride quality is better")).toEqual([]);
    expect(findVoiceViolations("premium synthetic oil change")).toEqual([]);
    expect(findVoiceViolations("ASE certified mechanics")).toEqual([]);
  });

  it("surface exemptions apply", () => {
    const copy = "our waiting room";
    expect(findVoiceViolations(copy, { surface: "web" }).length).toBeGreaterThan(0);
    expect(findVoiceViolations(copy, { surface: "admin" })).toEqual([]);
  });
});

describe("Voice Kernel — the positive half exists and is renderable", () => {
  it("carries all 7 VOICE.md patterns", () => {
    expect(VOICE_PATTERNS).toHaveLength(7);
    for (const p of VOICE_PATTERNS) expect(p.examples.length).toBeGreaterThan(0);
  });

  it("renders voice rules a prompt can consume", () => {
    const rendered = renderVoiceRulesForPrompt();
    expect(rendered).toContain("Surprises");
    expect(rendered).toContain("Anti-promises");
    expect(rendered).toMatch(/at most 1 absurd line per 3 paragraphs/);
  });
});
