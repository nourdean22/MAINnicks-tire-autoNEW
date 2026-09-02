/**
 * The pinned-context injection contract · 2026-09-02 self-audit.
 *
 * THE DEFECT. Two numbers — how many pins ride with every request, and how
 * much of each one — were written down in four modules, and three of the
 * four were wrong:
 *
 *   lib/ai/prompt/v2/renderer.ts        no cap at all (`for (const p of
 *                                       pinned)`), content cut at 200
 *   lib/ai/context/command-center-state `take: 6` — the REAL cap, because
 *                                       the renderer only ever saw what
 *                                       this query returned
 *   components/brain/pinned-context-panel `INJECTION_CAP = 5`, so at
 *                                       exactly six pins it labelled the
 *                                       sixth "idle" under a tooltip
 *                                       reading "Only the newest 5 pins
 *                                       ride with every request" — both
 *                                       statements false, and at 7+ pins
 *                                       no over-cap warning fired at all
 *                                       because `pins.length > 5` was
 *                                       measured over a 6-row slice
 *   lib/services/pins.ts                `Math.min(pins.length, 5)` and a
 *                                       260-char preview, printed on the
 *                                       /pins page header
 *
 * These tests assert BEHAVIOUR, per "Ship the canary, not just the
 * control": each one is written so that restoring the old code turns it
 * red, and the mutations were run. The one source-text assertion below
 * strips comments first — otherwise it fires on this file's own
 * explanation of the bug it is guarding.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findMany: vi.fn() } },
}));
vi.mock("@/lib/brain/embedding-utils", () => ({
  storeMemoryEmbedding: async () => {},
}));
vi.mock("@/lib/db/soft-delete", () => ({ softDelete: async () => ({ ok: true, noop: false }) }));
vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: () => {},
  logUpdate: () => {},
  stripNoise: (x: unknown) => x,
}));

import {
  renderPromptV2,
  renderPinnedLine,
  PINNED_PROMPT_CAP,
  PINNED_PROMPT_CHARS,
} from "@/lib/ai/prompt/v2/renderer";
import type { NickPrimeContext } from "@/lib/ai/context/nick-prime-context";
import { prisma } from "@/lib/prisma";
import { listPins } from "@/lib/services/pins";

const APP_ROOT = path.resolve(__dirname, "..", "..");

/** Comments are prose ABOUT the defect; a scan of them proves nothing. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

function readSource(rel: string): string {
  return stripComments(readFileSync(path.join(APP_ROOT, rel), "utf8"));
}

/**
 * Brace-matched body of one top-level function, so a source guard can be
 * aimed at the block that owns the defect instead of at a whole module.
 * Throws rather than returning "" — an empty haystack is a green that
 * measured nothing.
 */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found — guard has no subject`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`function ${name} never closed`);
}

interface PinFixture {
  id: string;
  key: string;
  content: string;
  source: string;
  seenCount: number;
  updatedAt: Date;
  metadata: null;
}

function pin(n: number, contentLength = 40): PinFixture {
  return {
    id: `pin-${n}`,
    key: `pin_key_${n}`,
    content: `pin ${n} `.padEnd(contentLength, "x"),
    source: "pin:manual",
    seenCount: 1,
    updatedAt: new Date(Date.now() - n * 60_000),
    metadata: null,
  };
}

/** Minimal-but-complete context; only `pinnedContext` / `brainRules` vary. */
function contextWith(
  overrides: Partial<Pick<NickPrimeContext, "pinnedContext" | "brainRules">>,
): NickPrimeContext {
  return {
    operatorState: { timeOfDay: "midday", todayScore: null },
    activeCommand: null,
    openCommands: [],
    activeCommitments: [],
    scheduledActions: [],
    activeMissions: [],
    activeGoals: [],
    recentBrainDumps: [],
    recentReflections: [],
    pinnedContext: [],
    brainRules: [],
    domainSnapshot: {
      business: {
        monthlyRevenueTarget: 20000,
        latestRevenue: null,
        asOf: null,
        savingsRatePct: null,
        netWorthEstimate: null,
        moneyScore: null,
      },
      mastery: [],
    },
    temporal: {
      dayName: "Tue",
      dayNameLong: "Tuesday",
      todayISO: "2026-04-28",
      currentHour: 11,
      bucket: "midday",
      isWeekend: false,
      weekKey: "2026-04-27",
      weeklyTargets: null,
      weeklyTargetsRaw: null,
    },
    todayProof: {
      tasksDone: 0,
      tasksDoneWithProof: 0,
      autonomousActionsOk: 0,
      cronRunsOk: 0,
      cronRunsFailed: 0,
    },
    activeRisks: {
      drift: [],
      brain: [],
      stale: [],
      noProofDay: { fired: false, tasksDone: 0, withProof: 0, reason: "" },
    },
    recentDecisions: [],
    decisionsNeedingReview: [],
    systemHealth: {
      crons: { active: 34, silent: 0, failures24h: 0 },
      ai: { recentCallCount: 0, recentErrorRate: 0 },
      memory: { lastBrainCycleAt: null, embeddingCoveragePct: 0 },
    },
    followUps: [],
    anticipatedQuestions: [],
    agendaItems: [],
    agendaItemsTotal: 0,
    ...overrides,
  } as unknown as NickPrimeContext;
}

function pinnedBullets(anchors: string): string[] {
  const body = anchors.split("## Hot Rules")[0];
  return body.split("\n").filter((l) => l.startsWith("- "));
}

beforeEach(() => {
  vi.mocked(prisma.brainMemory.findMany).mockReset();
});

describe("pinned injection · the cap lives in the injector", () => {
  it("injects at most PINNED_PROMPT_CAP pins even when handed more", () => {
    // MUTATION RUN: delete `.slice(0, PINNED_PROMPT_CAP)` from renderAnchors
    // and this goes red at 9 !== 6. That bare `for (const p of pinned)` is
    // exactly what shipped, and it is why the panel's "newest 5" tooltip
    // was fiction in both directions.
    const anchors = renderPromptV2(
      contextWith({
        pinnedContext: Array.from({ length: 9 }, (_, i) =>
          pin(i + 1),
        ) as unknown as NickPrimeContext["pinnedContext"],
      }),
    ).anchors;

    expect(pinnedBullets(anchors)).toHaveLength(PINNED_PROMPT_CAP);
    // Ordering matters: the roster arrives newest-first, so the pins that
    // ride are the FIRST N, not an arbitrary N.
    expect(anchors).toContain("pin_key_1");
    expect(anchors).not.toContain(`pin_key_${PINNED_PROMPT_CAP + 1}`);
  });

  it("injects every pin when the roster is under the cap", () => {
    // POSITIVE CONTROL. Without this, a renderer that dropped ALL pins
    // would satisfy the assertion above while deleting the feature.
    const anchors = renderPromptV2(
      contextWith({
        pinnedContext: [pin(1), pin(2)] as unknown as NickPrimeContext["pinnedContext"],
      }),
    ).anchors;
    expect(pinnedBullets(anchors)).toHaveLength(2);
    expect(anchors).toContain("Pinned by Nour");
  });

  it("the upstream query's take is the injector's constant, not a literal", () => {
    // MUTATION RUN: `take: PINNED_PROMPT_CAP` -> `take: 6` and this goes
    // red, even though 6 is currently the right number. That is the point:
    // a second hand-written copy of the number is the defect, and it stays
    // the defect while the two copies happen to agree.
    const src = readSource("lib/ai/context/command-center-state.ts");
    const m = /category:\s*BRAIN_CATEGORIES\.PINNED_USER[\s\S]{0,400}?take:\s*([A-Za-z0-9_.]+)/.exec(
      src,
    );
    expect(m, "the pinned_user query lost its take: — the cap is now unbounded").not.toBeNull();
    expect(m?.[1]).toBe("PINNED_PROMPT_CAP");
  });

  it("listPins reports the injector's cap and the injector's token cost", async () => {
    // MUTATION RUN: restore `injectedCount: Math.min(pins.length, 5)` and
    // `top5Chars` (5 pins x 260-char preview) and both assertions go red.
    // This is the /pins page header (app/(mastery)/pins/page.tsx:285-292),
    // the SECOND surface that published a fabricated cap.
    const rows = Array.from({ length: 9 }, (_, i) => pin(i + 1, 1200));
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue(
      rows as unknown as never,
    );

    const payload = (await listPins({ withStats: true })) as {
      stats: { injectedCount: number; estimatedPromptTokens: number; totalChars: number };
    };

    expect(payload.stats.injectedCount).toBe(PINNED_PROMPT_CAP);

    const expectedTokens = Math.round(
      rows
        .slice(0, PINNED_PROMPT_CAP)
        .reduce((sum, p) => sum + renderPinnedLine(p).length, 0) / 4,
    );
    expect(payload.stats.estimatedPromptTokens).toBe(expectedTokens);
    // And it is nowhere near the stored-length number the panel used to
    // publish: 9 pins x 1200 chars / 4 = 2700 tokens for ~330 real ones.
    expect(payload.stats.estimatedPromptTokens).toBeLessThan(
      Math.round(payload.stats.totalChars / 4) / 4,
    );
  });
});

describe("pinned injection · a long pin is cut, and the cut is measurable", () => {
  it("carries only the first PINNED_PROMPT_CHARS of a stored pin", () => {
    // MUTATION RUN: `safe(p.content, PINNED_PROMPT_CHARS)` ->
    // `safe(p.content, 1200)` and the tail assertion goes red. Pins store
    // up to 1200 chars (lib/services/pins.ts) and the panel's counter says
    // /1200, but this is what actually reaches the model.
    const head = "H".repeat(PINNED_PROMPT_CHARS);
    const tail = "TAILTHATNEVERSHIPS";
    const long = { key: "long_pin", source: "pin:manual", content: head + tail };

    const line = renderPinnedLine(long);
    expect(line).toContain(head.slice(0, 50));
    expect(line).not.toContain(tail);
    // The ellipsis is sanitizeForPrompt's truncation marker — its presence
    // is how a reader knows the line was cut rather than authored short.
    expect(line.endsWith("…")).toBe(true);
  });

  it("leaves a short pin whole", () => {
    // POSITIVE CONTROL: a renderer that truncated everything to nothing
    // would pass the test above.
    const line = renderPinnedLine({
      key: "short_pin",
      source: null,
      content: "keep every word of this",
    });
    expect(line).toBe("- short_pin: keep every word of this");
  });
});

describe("pinned injection · confidence is never a percentage", () => {
  it("renders hot rules as an attention label, not as NN%", () => {
    // MUTATION RUN: restore ``const conf = `${Math.round(r.confidence *
    // 100)}%`;`` in renderAnchors and this goes red. lib/brain/
    // attention-label.ts was written 2026-08-19 to kill this exact string
    // and says "One helper, so this cannot drift back" — it had drifted
    // back into the system prompt itself, telling the model "95%" about a
    // re-sighting counter.
    const anchors = renderPromptV2(
      contextWith({
        brainRules: [
          {
            category: "identity",
            key: "communication_dna",
            content: "Direct, terse, action-first.",
            confidence: 0.95,
          },
        ] as unknown as NickPrimeContext["brainRules"],
      }),
    ).anchors;

    expect(anchors).toContain("Hot Rules");
    expect(anchors).toContain("[identity]");
    expect(anchors).not.toMatch(/\d+%/);
    expect(anchors).toMatch(/seen\s/);
  });

  it("neither brain-memory surface reconstructs the percentage by hand", () => {
    // Drift guard across BOTH files that carried it. Comments are stripped
    // first: each of these files now EXPLAINS the retired percentage in
    // prose, and without the strip this assertion would fire on its own
    // documentation — which is the fastest way to get a gate deleted.
    //
    // SCOPE, and why it is not the whole renderer. This guard is about
    // `brain_memories.confidence`, which attention-label.ts proved is a
    // re-sighting counter. `Reflection.confidence` is a different column on
    // a different table — a stated confidence on an insight, defaulting to
    // 0.7 (prisma/schema.prisma:1916) — and renderRecentThinking prints it
    // as a percentage in three places. A file-wide regex fires on those
    // three, which is a false positive: attention-label.ts scopes itself to
    // brain_memories in its own header. Whether a reflection's stated
    // confidence should be rendered as NN% is a real question and is
    // FLAGGED, not silently rewritten here.
    const rendererAnchors = functionBody(
      readSource("lib/ai/prompt/v2/renderer.ts"),
      "renderAnchors",
    );
    expect(
      rendererAnchors,
      "renderAnchors lost its brain-rule loop — this guard now has no subject",
    ).toMatch(/for \(const r of rules\)/);
    expect(rendererAnchors, "renderAnchors re-derives confidence as a percentage").not.toMatch(
      /confidence\s*\*\s*100/,
    );

    // The panel renders only BrainMemory rows (pins + hot rules), so the
    // whole file is in scope there.
    expect(
      readSource("components/brain/pinned-context-panel.tsx"),
      "pinned-context-panel re-derives confidence as a percentage",
    ).not.toMatch(/confidence\s*\*\s*100/);
  });
});
