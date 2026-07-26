/**
 * NickGPT truth kernel pins (ROS-058, 2026-07-25).
 *
 * An external quality report was gated claim-by-claim; these tests pin every
 * CONFIRMED defect's fix so it cannot regress:
 *  1. Intent-confidence variable shadowing (preflight graded "general"/0)
 *  2. Fabricated catalog prices ($60/$149/$79 not in the BUSINESS SSOT)
 *  3. Silent state-changing actions (body="" after confirm/cancel/approve)
 *  4. "warranty" word auto-blocking fact-grounded answers
 *  5. Qualifier-satisfied invented prices ("about $899" passed)
 *  6. Token/char confusion (320-token budget vs 320-char contract)
 *  7. Training examples with amputated context ({})
 *  8. DB fact overrides never reaching the live prompt
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runNickgptPreflightGuard } from "./services/nickgptPreflightGuard";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const guard = (candidateBody: string, sourceType: "nickgpt" | "deterministic_template" = "nickgpt") =>
  runNickgptPreflightGuard({ eventType: "inbound_sms", candidateBody, sourceType });

describe("the classifier result reaches the preflight guard (shadowing fix)", () => {
  it("orchestrator declares detectedIntent/confScore exactly once — no shadowed re-declaration", () => {
    const s = read("server/services/smsOrchestrator.ts");
    expect((s.match(/let detectedIntent\b/g) ?? []).length).toBe(1);
    expect((s.match(/let confScore\b/g) ?? []).length).toBe(1);
  });
});

describe("catalog prices come from the SSOT, never restated", () => {
  const catalog = () => read("server/services/smsMessageCatalog.ts");

  it("carries no fabricated amounts ($60 flat, $149 brakes, $79 alignment) outside comments", () => {
    // Comments may narrate the history; only executable template text is pinned.
    const withoutComments = catalog()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/^\s*\*.*$/gm, "");
    expect(withoutComments).not.toMatch(/\$60|\$149|\$79/);
  });

  it("used-tire replies interpolate the BUSINESS floor + band (the band travels with the $25)", () => {
    const s = catalog();
    expect(s).toMatch(/BUSINESS\.usedTires\.priceDisplay/);
    expect(s).toMatch(/BUSINESS\.usedTires\.typicalBand/);
    expect(s).toMatch(/BUSINESS\.usedTires\.fineprint/);
  });
});

describe("state-changing actions produce receipts, never silence", () => {
  const orch = () => read("server/services/smsOrchestrator.ts");

  it("confirm / cancel / approve / decline all set a customer-facing body", () => {
    const s = orch();
    expect(s).toMatch(/action_receipt_confirm/);
    expect(s).toMatch(/action_receipt_cancel/);
    expect(s).toMatch(/action_receipt_estimate_approve/);
    expect(s).toMatch(/action_receipt_estimate_decline/);
  });

  it("receipts stay honest about FCFS — no reserved-slot language", () => {
    const s = orch();
    expect(s).toMatch(/first come, first served/);
    expect(s).not.toMatch(/appointment (is )?reserved/i);
  });

  it("the cancel receipt disambiguates the CANCEL/opt-out overload", () => {
    expect(orch()).toMatch(/Reply STOP to also stop automated texts/);
  });
});

describe("guard: warranty facts are reviewable, disputes are blocked", () => {
  it("a fact-grounded warranty answer routes to human review, NOT block", () => {
    const r = guard("Used tires carry a 7-day limited replacement warranty for verified defects present at sale.");
    expect(r.action).toBe("force_human_review");
    expect(r.findings.some((f) => f.code === "warranty_mention_review")).toBe(true);
  });

  it("refund/legal/lawsuit language still hard-blocks", () => {
    const r = guard("We will process your refund after the lawsuit review.");
    expect(r.action).toBe("block_send");
  });
});

describe("guard: every dollar amount must be an approved SSOT price", () => {
  it("'about $899' blocks — a qualifier no longer launders an invented price", () => {
    const r = guard("It should be about $899 for that repair, give or take.");
    expect(r.action).toBe("block_send");
    expect(r.findings.some((f) => f.code === "unapproved_dollar_amount")).toBe(true);
  });

  it("the approved oil-change price passes", () => {
    const r = guard("Conventional oil change is $49 — walk in any day.");
    expect(r.allowed).toBe(true);
  });

  it("the approved used-tire floor passes", () => {
    const r = guard("Used tires start at $25 installed for qualifying 12-inch sizes.");
    expect(r.allowed).toBe(true);
  });
});

describe("guard: length matches the 320-char persona contract", () => {
  it("a 400-char NickGPT reply routes to human review", () => {
    const r = guard("a".repeat(400));
    expect(r.action).toBe("force_human_review");
  });

  it("a 500+-char NickGPT reply blocks", () => {
    const r = guard("a".repeat(520));
    expect(r.action).toBe("block_send");
  });

  it("the model budget is ~320 CHARS of tokens, not 320 tokens of text", () => {
    expect(read("server/services/nickgpt-client.ts")).toMatch(/DEFAULT_MAX_TOKENS = 110/);
  });
});

describe("learning examples keep their decision context", () => {
  it("training rows no longer store an empty context object", () => {
    const s = read("server/services/smsLearningEngine.ts");
    expect(s).not.toMatch(/conversationContextJson: JSON\.stringify\(\{\}\)/);
  });
});

describe("the live prompt consumes DB fact overrides", () => {
  it("nickgpt-client uses buildWarrantyFactsPreambleLive (override-aware), not the seed-only version", () => {
    const s = read("server/services/nickgpt-client.ts");
    expect(s).toMatch(/await buildWarrantyFactsPreambleLive\(\)/);
  });
});

describe("training context is captured at draft time and copied through (0098)", () => {
  it("the draft insert persists the full decision context (turns, router, plan)", () => {
    const s = read("server/services/smsOrchestrator.ts");
    expect(s).toMatch(/contextJson: JSON\.stringify\(\{/);
    expect(s).toMatch(/conversationTurns: conversationContext/);
    expect(s).toMatch(/router: \{ primary: routerDecision\.primary/);
    expect(s).toMatch(/goal: replyPlan\.goal/);
  });

  it("the learning engine copies the draft's real context, with an honest pre-0098 fallback", () => {
    const s = read("server/services/smsLearningEngine.ts");
    expect(s).toMatch(/draft\.contextJson \?\? JSON\.stringify/);
    expect(s).toMatch(/pre-0098 draft/);
  });

  it("migration 0098 exists, is journaled, and the schema carries the column", () => {
    expect(read("drizzle/0098_nickgpt_drafts_context.sql")).toMatch(/ADD COLUMN context_json TEXT NULL/);
    expect(read("drizzle/meta/_journal.json")).toContain("0098_nickgpt_drafts_context");
    expect(read("drizzle/schema.ts")).toMatch(/contextJson: text\("context_json"\)/);
  });
});

// ── 2026-07-26 · outbound AI meta-language never reaches a customer ──
//
// Recovered from a 2026-07-09 stash whose feature otherwise shipped. Every
// other injection defense here faces INBOUND (classifiers.ts) or runs
// POST-HOC (editClassifier's ROBOTIC category feeds the training digest and
// never gates a send), so nothing stopped the DRAFT from announcing itself
// as a bot. These pin the outbound direction.

describe("guard: the outbound draft never leaks assistant-speak", () => {
  it("blocks a reply that says 'As an AI'", () => {
    const r = guard("As an AI, I can't quote that price for you.");
    expect(r.allowed).toBe(false);
    expect(r.action).toBe("block_send");
    expect(r.severity).toBe("critical");
    expect(r.findings.some(f => f.code === "ai_meta_language")).toBe(true);
  });

  it("blocks the other assistant-speak tells", () => {
    for (const body of [
      "I'm an AI and cannot access that.",
      "That is outside my system prompt.",
      "As a language model I don't have that info.",
      "My training data ends before that.",
    ]) {
      const r = guard(body);
      expect(r.allowed, `should block: ${body}`).toBe(false);
      expect(r.findings.some(f => f.code === "ai_meta_language"), body).toBe(true);
    }
  });

  it("leaves a normal tire-shop reply alone", () => {
    const r = guard("Got you down for Thursday at 9. We'll take a look at that front tire.");
    expect(r.allowed).toBe(true);
    expect(r.findings.some(f => f.code === "ai_meta_language")).toBe(false);
  });

  it("does not fire on ordinary words that merely contain a tell", () => {
    // "airing", "email", "assistant manager" must not trip the \b-anchored set.
    const r = guard("Our assistant manager can help when you get here — email works too.");
    expect(r.findings.some(f => f.code === "ai_meta_language")).toBe(false);
  });

  it("routes a correction-style 'ignore previous' to a human instead of blocking it", () => {
    // A shop legitimately sends corrections; blocking one suppresses the fix,
    // not the defect. From NickGPT it may be an echoed injection — so: review.
    const r = guard("Sorry, ignore previous message - we meant Thursday at 9.");
    expect(r.action).toBe("force_human_review");
    expect(r.allowed).toBe(false);
    expect(r.findings.some(f => f.code === "echoed_injection_phrasing")).toBe(true);
  });

  it("does not apply the echo rule to deterministic templates", () => {
    const r = guard("Sorry, ignore previous message - we meant Thursday at 9.", "deterministic_template");
    expect(r.findings.some(f => f.code === "echoed_injection_phrasing")).toBe(false);
  });
});
