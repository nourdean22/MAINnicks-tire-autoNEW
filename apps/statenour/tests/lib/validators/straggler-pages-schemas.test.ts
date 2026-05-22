/**
 * Straggler-pages slice contract tests · (2026-05-22 · legacy-modernizer
 * REST→tRPC · 7 straggler page files slice).
 *
 * This slice migrated the leftover `authedFetch` / `useAuthedFetch`
 * call-sites in 7 page files (/system/features · /system/migrations ·
 * /system/ghost-nour · /system/judge-eval · /knowledge · /pins ·
 * /voice) onto tRPC.
 *
 * It added 6 procedures across `system` / `operator`. Three are
 * no-input reads — nothing to pin:
 *
 *   · system.featureStatus       · ()  → feature registry
 *   · system.migrationsTracker   · ()  → migration tracker
 *   · operator.morningBrief      · ()  → today's brief
 *
 * The three procedures with a structured `.input()` are pinned here:
 *
 *   · system.ghostNourPredict    · { situation, limit }
 *   · system.judgeEvalRun        · { prompt, v1Reply, v2Reply, … }
 *   · operator.knowledgeRefresh  · { only? }
 *
 * The `/pins` page's prompt-cache hot-flush reuses the pre-existing
 * `system.flushPromptCache` procedure — its `{ reason? }` input was
 * already covered when that procedure shipped, so it is not re-pinned.
 *
 * The risk a migration introduces is the typed-payload-mismatch class: a
 * client payload TypeScript accepts but the server Zod `.input()` rejects
 * at runtime, surfacing as a generic failure toast.
 *
 * The schemas below are the literal `.input(...)` objects from
 * lib/trpc/routers/{system,operator}.ts — re-declared here verbatim so a
 * tightened bound fails CI before it breaks a real call-site. Pure
 * schema parse, no Prisma. Mirrors tests/lib/validators/
 * scattered-components-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── system.ghostNourPredict ────────────────
//
// /system/ghost-nour fires ghostNourPredict.mutateAsync({ situation })
// from its "summon past-Nour" button (and from the pending-decision
// one-click cards). `limit` defaults to 5.

describe("system.ghostNourPredict · ghost-nour prediction payload", () => {
  const ghostNourPredictInput = z.object({
    situation: z.string().min(3).max(2000),
    limit: z.number().int().min(1).max(20).default(5),
  });

  it("accepts the bare { situation } payload the page sends", () => {
    const parsed = ghostNourPredictInput.parse({
      situation: "should I drop full-brake-job pricing to compete",
    });
    expect(parsed.limit).toBe(5);
  });

  it("accepts an explicit limit inside the 1-20 range", () => {
    expect(() =>
      ghostNourPredictInput.parse({
        situation: "whether to hire a second tech",
        limit: 10,
      }),
    ).not.toThrow();
  });

  it("rejects a situation under the 3-char floor", () => {
    expect(() =>
      ghostNourPredictInput.parse({ situation: "ab" }),
    ).toThrow();
  });

  it("rejects a situation past the 2000-char ceiling", () => {
    expect(() =>
      ghostNourPredictInput.parse({ situation: "x".repeat(2001) }),
    ).toThrow();
  });

  it("rejects a limit above the 20-row ceiling", () => {
    expect(() =>
      ghostNourPredictInput.parse({
        situation: "a valid situation string",
        limit: 21,
      }),
    ).toThrow();
  });

  it("rejects a non-integer limit", () => {
    expect(() =>
      ghostNourPredictInput.parse({
        situation: "a valid situation string",
        limit: 4.5,
      }),
    ).toThrow();
  });
});

// ──────────────── system.judgeEvalRun ────────────────
//
// /system/judge-eval's AdHocCompareForm fires judgeEvalRun.mutateAsync({
// prompt, v1Reply, v2Reply, intentClass?, sourceMessageId? }).

describe("system.judgeEvalRun · judge-eval comparison payload", () => {
  const judgeEvalRunInput = z.object({
    prompt: z.string().min(1).max(4000),
    v1Reply: z.string().min(1).max(8000),
    v2Reply: z.string().min(1).max(8000),
    intentClass: z.string().max(80).optional(),
    sourceMessageId: z.string().max(64).optional(),
  });

  it("accepts the three-required-field payload the form sends", () => {
    expect(() =>
      judgeEvalRunInput.parse({
        prompt: "What's the labor rate change rollout plan?",
        v1Reply: "Legacy V1 reply text.",
        v2Reply: "V2 Mastra-agent reply text.",
      }),
    ).not.toThrow();
  });

  it("accepts the optional intentClass + sourceMessageId", () => {
    expect(() =>
      judgeEvalRunInput.parse({
        prompt: "Draft a follow-up text for declined work.",
        v1Reply: "v1.",
        v2Reply: "v2.",
        intentClass: "compose",
        sourceMessageId: "msg_abc123",
      }),
    ).not.toThrow();
  });

  it("rejects an empty prompt", () => {
    expect(() =>
      judgeEvalRunInput.parse({
        prompt: "",
        v1Reply: "v1.",
        v2Reply: "v2.",
      }),
    ).toThrow();
  });

  it("rejects an empty v1Reply / v2Reply", () => {
    expect(() =>
      judgeEvalRunInput.parse({
        prompt: "a prompt",
        v1Reply: "",
        v2Reply: "v2.",
      }),
    ).toThrow();
    expect(() =>
      judgeEvalRunInput.parse({
        prompt: "a prompt",
        v1Reply: "v1.",
        v2Reply: "",
      }),
    ).toThrow();
  });

  it("rejects a prompt past the 4000-char ceiling", () => {
    expect(() =>
      judgeEvalRunInput.parse({
        prompt: "x".repeat(4001),
        v1Reply: "v1.",
        v2Reply: "v2.",
      }),
    ).toThrow();
  });

  it("rejects a reply past the 8000-char ceiling", () => {
    expect(() =>
      judgeEvalRunInput.parse({
        prompt: "a prompt",
        v1Reply: "x".repeat(8001),
        v2Reply: "v2.",
      }),
    ).toThrow();
  });

  it("rejects an intentClass past the 80-char ceiling", () => {
    expect(() =>
      judgeEvalRunInput.parse({
        prompt: "a prompt",
        v1Reply: "v1.",
        v2Reply: "v2.",
        intentClass: "x".repeat(81),
      }),
    ).toThrow();
  });

  it("rejects a sourceMessageId past the 64-char ceiling", () => {
    expect(() =>
      judgeEvalRunInput.parse({
        prompt: "a prompt",
        v1Reply: "v1.",
        v2Reply: "v2.",
        sourceMessageId: "x".repeat(65),
      }),
    ).toThrow();
  });
});

// ──────────────── operator.knowledgeRefresh ────────────────
//
// /knowledge's KnowledgeRefreshPanel fires knowledgeRefresh.mutateAsync()
// with no argument (the whole-input object is optional). The optional
// `only` filter narrows the subsystem fan-out set.

describe("operator.knowledgeRefresh · knowledge-corpus refresh payload", () => {
  const knowledgeRefreshInput = z
    .object({ only: z.array(z.string().max(40)).max(20).optional() })
    .optional();

  it("accepts a fully-absent payload (whole-input optional)", () => {
    expect(() => knowledgeRefreshInput.parse(undefined)).not.toThrow();
  });

  it("accepts a bare {} payload — the page's no-arg call", () => {
    expect(() => knowledgeRefreshInput.parse({})).not.toThrow();
  });

  it("accepts an explicit subsystem filter list", () => {
    expect(() =>
      knowledgeRefreshInput.parse({ only: ["industry", "drive"] }),
    ).not.toThrow();
  });

  it("rejects a subsystem id past the 40-char ceiling", () => {
    expect(() =>
      knowledgeRefreshInput.parse({ only: ["x".repeat(41)] }),
    ).toThrow();
  });

  it("rejects an only-list past the 20-entry ceiling", () => {
    expect(() =>
      knowledgeRefreshInput.parse({
        only: Array.from({ length: 21 }, (_, i) => `sub${i}`),
      }),
    ).toThrow();
  });

  it("rejects a non-string entry in the only-list", () => {
    expect(() =>
      knowledgeRefreshInput.parse({
        only: [42 as unknown as string],
      }),
    ).toThrow();
  });
});
