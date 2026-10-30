import { describe, expect, it, vi } from "vitest";
import { SMS_EVAL_CASES, evalExitCode, installModelOnlyFetch, scoreEvalOutcome, type EvalCase } from "./smsReplyEval";
import { TEMPLATE_VARIANTS } from "./smsMessageCatalog";

// Codex review of #3393: a run that measured nothing must not exit 0.
describe("SMS reply eval · exit code", () => {
  const ok = { score: "right" as const, draftFailed: false };
  const clean = { paidAttempts: 0, isolationClean: true };
  it("a clean run with valid results exits 0", () => {
    expect(evalExitCode({ rows: [ok, { score: "none", draftFailed: false }], ...clean }).code).toBe(0);
  });
  it.each([
    ["a case errored", { rows: [ok, { score: "error" as const, draftFailed: false }], ...clean }],
    ["a draft failed (provider down)", { rows: [ok, { score: "none" as const, draftFailed: true }], ...clean }],
    ["no rows at all", { rows: [], ...clean }],
    ["a paid lane was attempted", { rows: [ok], paidAttempts: 1, isolationClean: true }],
    ["isolation was not clean", { rows: [ok], paidAttempts: 0, isolationClean: false }],
  ])("%s exits 1", (_why, input) => {
    expect(evalExitCode(input).code).toBe(1);
  });
});

const sent = (body: string) => ({ status: "compiled", shouldAutoSend: true, body });
const held = { status: "drafted", shouldAutoSend: false, body: "a draft staff will see" };
const silent = { status: "skipped", shouldAutoSend: false, body: "" };
const byId = (id: string) => SMS_EVAL_CASES.find((c) => c.id === id) as EvalCase;

describe("SMS reply eval · the case set", () => {
  it("has unique ids and covers every expectation kind", () => {
    const ids = SMS_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const kinds = new Set(SMS_EVAL_CASES.map((c) => c.expect.kind));
    expect([...kinds].sort()).toEqual(["answer", "either", "handoff", "silent"]);
  });

  it("holds no phone numbers or email addresses (the repo is public)", () => {
    for (const c of SMS_EVAL_CASES) {
      expect(c.body, c.id).not.toMatch(/\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/);
      expect(c.body, c.id).not.toMatch(/\S+@\S+\.\w+/);
    }
  });
});

describe("SMS reply eval · scoring from the customer's side", () => {
  it("answer: a finished reply with the facts is right; missing facts is wrong; held is none; a stub is a fragment", () => {
    const c = byId("tire-price-2");
    expect(scoreEvalOutcome(c, sent("Used tires start at $25 installed, most sizes $40-80. Pull up and we'll check your size.")).score).toBe("right");
    expect(scoreEvalOutcome(c, sent("Pull up any time and we'll take a look at it for you.")).score).toBe("wrong");
    expect(scoreEvalOutcome(c, held).score).toBe("none");
    expect(scoreEvalOutcome(c, sent("Hey, this Reply STOP to opt out.")).score).toBe("fragment");
  });

  it("answer: every hours_location template variant counts as telling the customer how to come in", () => {
    // The third variant says "Stop by anytime"; the eval scored it wrong on rotation (2026-10-30).
    const c = byId("hours-1");
    for (const v of TEMPLATE_VARIANTS.hours_location) {
      expect(scoreEvalOutcome(c, sent(v.replace("{shopPhone}", "(216) 862-0005"))).score).toBe("right");
    }
  });

  it("answer: a reply that repeats what the customer pushed back on is wrong", () => {
    const c = byId("align-4");
    const pushy = "If the car pulls, we check the alignment plus steering and suspension first, then price it. First come, first served.";
    expect(scoreEvalOutcome(c, sent(pushy)).score).toBe("wrong");
    expect(scoreEvalOutcome(c, sent("Sure, we can do just the alignment. First come, first served, any day.")).score).toBe("right");
  });

  it("handoff: only the holding reply is right; an AI answer is wrong; silence or a held draft is none", () => {
    const c = byId("diag-1");
    expect(scoreEvalOutcome(c, sent("Thanks for the details. A staff member will get back to you shortly.")).score).toBe("right");
    expect(scoreEvalOutcome(c, sent("Oil changes are $49 conventional and $80 synthetic, walk in any day.")).score).toBe("wrong");
    expect(scoreEvalOutcome(c, held).score).toBe("none");
    expect(scoreEvalOutcome(c, silent).score).toBe("none");
  });

  it("silent: texting or queueing a non-customer is wrong; silence is right", () => {
    const c = byId("spam-payroll-1");
    expect(scoreEvalOutcome(c, silent).score).toBe("right");
    expect(scoreEvalOutcome(c, sent("No thanks, we're all set here at the shop today.")).score).toBe("wrong");
    expect(scoreEvalOutcome(c, held).score).toBe("wrong");
  });

  it("either: silence or a finished reply is right; a fragment is a fragment; held or a holding reply is none, never wrong", () => {
    const c = byId("thanks-4");
    expect(scoreEvalOutcome(c, silent).score).toBe("right");
    expect(scoreEvalOutcome(c, sent("Glad to hear it, thanks for letting us know.")).score).toBe("right");
    expect(scoreEvalOutcome(c, sent("Glad to")).score).toBe("fragment");
    expect(scoreEvalOutcome(c, held).score).toBe("none");
    expect(scoreEvalOutcome(c, { ...held, holdingReply: true }).score).toBe("none");
  });

  it("the holding reply: right for a staff-only question, none for one the bot should answer, wrong to a non-customer", () => {
    const heldWithHolding = { ...held, holdingReply: true };
    expect(scoreEvalOutcome(byId("status-1"), heldWithHolding).score).toBe("right");
    expect(scoreEvalOutcome(byId("tire-price-1"), heldWithHolding).score).toBe("none");
    expect(scoreEvalOutcome(byId("spam-junk-1"), heldWithHolding).score).toBe("wrong");
  });

  it("fragment check ignores the opt-out footer and accepts numbers and links as endings", () => {
    const c = byId("thanks-1");
    expect(scoreEvalOutcome(c, sent("We're Reply STOP to opt out.")).score).toBe("fragment");
    expect(scoreEvalOutcome(c, sent("Call or text us any time at 216-862-0005")).score).toBe("right");
    expect(scoreEvalOutcome(c, sent("You can book online at nickstire.org/tires")).score).toBe("right");
  });
});

describe("SMS reply eval · model-only fetch", () => {
  it("lets model hosts through and refuses everything else", async () => {
    const real = vi.fn(async () => "ok");
    const target: { fetch?: unknown } = { fetch: real };
    const guard = installModelOnlyFetch(target);
    const f = target.fetch as (u: string) => Promise<unknown>;
    await expect(f("https://ollama.com/v1/chat/completions")).resolves.toBe("ok");
    await expect(f("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")).resolves.toBe("ok");
    await expect(f("https://api.telegram.org/bot/sendMessage")).rejects.toThrow(/blocked/);
    await expect(f("https://ollama.com.evil.example/x")).rejects.toThrow(/blocked/);
    expect(guard.blockedHosts).toEqual(["api.telegram.org", "ollama.com.evil.example"]);
    expect(real).toHaveBeenCalledTimes(2);
    guard.restore();
    expect(target.fetch).toBe(real);
  });
});
