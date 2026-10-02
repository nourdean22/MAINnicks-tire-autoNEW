/**
 * tests/home/recommendation-decision-wiring.test.ts · 2026-10-02 · full-circle wave 3 (Lane D)
 *
 * BUILT-TESTED-UNWIRED is the defect shape the outcome ledger has suffered
 * twice (census §5: twelve surfaces, one with a complete loop). The service
 * and the builders are unit-tested beside this file; THIS pins the wiring
 * from the two highest-frequency surfaces to the one decision mutation, and
 * from the completion rating to the resultRef closure, source-side — the
 * components are "use client" tRPC shells that cannot render in isolation
 * (same pattern as tests/components/mobile-a11y.test.tsx).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(APP, p), "utf8");

describe("recordRecommendationDecision · the one decision mutation", () => {
  const router = read("lib/trpc/routers/operator.ts");

  it("exists, is operator-gated, keys by ledger id and accepts exactly accepted|dismissed", () => {
    const start = router.indexOf("recordRecommendationDecision: operatorProcedure");
    expect(start).toBeGreaterThan(-1);
    const body = router.slice(start, router.indexOf(".mutation(", start) + 400);
    expect(body).toContain('z.enum(["accepted", "dismissed"])');
    expect(body).toContain("ledgerId: z.string()");
    expect(body).toContain("recordDecision({");
  });
});

describe("Home lead → decision", () => {
  const lead = read("components/home/brief-lead.tsx");

  it("the CTA records accepted with the task as resultRef; an alternative records dismissed", () => {
    expect(lead).toContain("trpc.operator.recordRecommendationDecision.useMutation()");
    expect(lead).toContain('recordDecision("accepted", lead.taskId ? `task:${lead.taskId}` : lead.cta?.href ?? null)');
    expect(lead).toContain('recordDecision("dismissed", alt.href)');
    expect(lead).toContain('data-lead-decision="accepted"');
    expect(lead).toContain('data-lead-decision="dismissed"');
  });

  it("no ledger id → no decision call (never a decision against a look-alike row)", () => {
    expect(lead).toContain("if (!lead?.ledgerId) return;");
  });
});

describe("Missions deck → decision", () => {
  const page = read("app/(mastery)/missions/page.tsx");

  it("Start on the hero records accepted; pick-different records dismissed; both carry task:<id>", () => {
    expect(page).toContain("trpc.operator.recordRecommendationDecision.useMutation()");
    expect(page).toContain('if (taskId === deck?.nextMove?.task.id) recordDeckDecision("accepted", taskId);');
    expect(page).toContain('recordDeckDecision("dismissed", taskId);');
    expect(page).toContain("resultRef: `task:${taskId}`");
    expect(page).toContain("if (!ledgerId) return;");
  });
});

describe("completion rating → resultRef closure", () => {
  it("checkTask closes by resultRef beside the verbatim-title bridge", () => {
    const src = read("lib/services/task-actions.ts");
    expect(src).toContain("recordOutcomeByResultRef(`task:${id}`, ratingUseful)");
  });
});

describe("the rest of the census joins (same slice)", () => {
  it("the nudge lane is no longer dismiss-only: following a nudge's link records accepted", () => {
    const router = read("lib/trpc/routers/brain.ts");
    expect(router).toContain("acceptNudge: operatorProcedure");
    expect(router).toContain('recordDecisionByContent(input.text, "accepted", `nudge:${input.source}`)');
    const panel = read("components/brain/nudge-panel.tsx");
    expect(panel).toContain("trpc.brain.acceptNudge.useMutation()");
    expect(panel).toContain("onClick={() => acceptMutation.mutate({ source: n.source, text: n.text })}");
  });

  it("the Journal next action is ledgered when the take renders and decided on promote, by the same summary", () => {
    const router = read("lib/trpc/routers/journal.ts");
    expect(router).toContain('sourceEngine: "journal:next-action"');
    expect(router).toContain("summary: journalNextActionSummary(action)");
    expect(router).toContain("if (take?.nextAction && !take.nextAction.nextActionPromoted)");
    const promote = read("lib/services/journal-promote.ts");
    expect(promote).toContain("journalNextActionSummary(title)");
    expect(promote).toContain("`task:${task.id}`");
  });

  it("the harvest odometer row has a reader on /system/fleet, by key, with no age filter, absent = said", () => {
    const health = read("lib/trpc/routers/system/health.ts");
    expect(health).toContain('key: "eval_run:corpus-odometer"');
    expect(health).not.toMatch(/corpus-odometer[\s\S]{0,400}createdAt/);
    const fleet = read("app/(mastery)/system/fleet/page.tsx");
    expect(fleet).toContain("delivery.data.odometer");
    expect(fleet).toContain("no eval_run:corpus-odometer row yet");
  });

  it("the morning brief's surface is no longer derived from the synthetic hand-off result; the backstop writes the real one", () => {
    const brief = read("lib/inngest/functions/morning-brief.ts");
    expect(brief).toContain('const surface = "handed-off-to-combine";');
    expect(brief).not.toMatch(/const surface = push\.sent > 0/);
    expect(brief).toContain('setShownSurface(push.ledgerId, push.sent > 0 ? "web-push" : "telegram-fallback")');
  });

  it("`edited` is gone from the decision vocabulary (declared for a year, never written)", () => {
    const ledger = read("lib/services/outcome-ledger.ts");
    expect(ledger).toContain('export type OutcomeDecision = "accepted" | "dismissed" | "ignored";');
    expect(read("prisma/schema.prisma")).not.toContain("set by sweep after TTL");
  });
});
