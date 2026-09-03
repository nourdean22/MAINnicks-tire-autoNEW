/**
 * tests/components/brain/brain-maturity-header-degraded.test.tsx · 2026-09-02.
 *
 * EMERALD IS A CLAIM. It must not be reachable from a read that failed.
 *
 * `buildBrainMaturity` used to swallow all ten of its subsystem reads and
 * still return a fully-formed payload, so this header's `if (!data)` guard
 * never fired on a total DB outage. What rendered instead was a score of
 * "7", every counter at 0, and — the worst line on the card —
 * "contradictions 0" in EMERALD, because line 203 read
 * `open > 0 ? red : emerald` and a failed read arrived as 0.
 *
 * The operator's takeaway was "almost no signal, but at least it's
 * internally consistent". The truth was "the brain could not be read".
 *
 * These render the component through `renderToStaticMarkup` (vitest env is
 * Node — same approach as tests/components/mobile-a11y.test.tsx) and assert
 * on the MARKUP, because the defect was a colour and a glyph, not a value.
 * The pair matters more than either half:
 *
 *   · degraded payload  ⇒ no emerald anywhere, "?" not "0", score withheld
 *   · measured zero     ⇒ emerald IS present (the control — otherwise
 *                         deleting the emerald branch entirely would pass)
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type MaturityPayload = ReturnType<typeof healthyPayload>;
let maturityData: MaturityPayload | null = null;
let maturityError: { message: string } | null = null;

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ brain: { exportBrain: { fetch: vi.fn() } } }),
    brain: {
      maturity: {
        useQuery: () => ({
          data: maturityData,
          error: maturityError,
          refetch: vi.fn(),
        }),
      },
      reset: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

import { BrainMaturityHeader } from "@/components/brain/brain-maturity-header";

/** A brain that was read successfully and genuinely has a clean ledger. */
function healthyPayload() {
  return {
    score: 7,
    components: {
      skills: { active: 0, graduated: 0, pending: 0 },
      identity: { axes_filled: 0, history_days: 0 },
      qualitative: { entries: 0 },
      beliefs: { active: 0, candidates: 0 },
      contradictions: { open: 0, resolved: 0, truncated: false },
      ghost: { hits: 0, surprises: 0, accuracy: null },
      chat_memory: { importance_rows: 0, distilled_sessions: 0 },
    },
    failedReads: [] as string[],
    computed_at: "2026-09-02T00:00:00.000Z",
  };
}

/** The same card after a total DB outage — every read gone. */
function degradedPayload(): MaturityPayload {
  return {
    score: null as unknown as number,
    components: {
      skills: { active: null, graduated: null, pending: null },
      identity: { axes_filled: null, history_days: null },
      qualitative: { entries: null },
      beliefs: { active: null, candidates: null },
      contradictions: { open: null, resolved: null, truncated: false },
      ghost: { hits: null, surprises: null, accuracy: null },
      chat_memory: { importance_rows: null, distilled_sessions: null },
    },
    failedReads: ["contradictions", "skills_active", "ghost_accuracy"],
    computed_at: "2026-09-02T00:00:00.000Z",
  } as unknown as MaturityPayload;
}

function render(payload: MaturityPayload | null, error: { message: string } | null = null): string {
  maturityData = payload;
  maturityError = error;
  return renderToStaticMarkup(<BrainMaturityHeader />);
}

/**
 * The markup of ONE counter cell. Scoped deliberately: FreshnessChip paints
 * its own emerald "just now" dot in this card, so a whole-document search
 * for `text-emerald-400` is green whatever the counter does — a test that
 * would have passed against the defect.
 */
function counterCell(html: string, label: string): string {
  const at = html.indexOf(`>${label}</span>`);
  expect(at, `counter "${label}" not rendered`).toBeGreaterThan(-1);
  return html.slice(at, at + 200);
}

describe("BrainMaturityHeader · a degraded read never renders as health", () => {
  it("paints NO emerald on the contradiction counter when its read failed", () => {
    const cell = counterCell(render(degradedPayload()), "contradictions");

    // The single assertion the defect turns on. `open` arrived as 0 before
    // this change and `0 > 0 ? red : emerald` chose green.
    expect(cell).not.toContain("text-emerald-400");
    expect(cell).toContain("text-amber-400");
    expect(cell).toContain(">?<");
  });

  it("CONTROL · a MEASURED zero still earns the emerald", () => {
    // Without this, deleting the emerald branch outright would satisfy the
    // test above while silently removing a true all-clear.
    const cell = counterCell(render(healthyPayload()), "contradictions");

    expect(cell).toContain("text-emerald-400");
    expect(cell).toContain(">0<");
  });

  it("withholds the score instead of printing one, and says so", () => {
    const html = render(degradedPayload());

    expect(html).toContain("maturity unknown");
    expect(html).not.toContain("brain maturity");
    expect(html).toContain("read failed — unknown, not zero");
    // Names what could not be read — an unnamed failure is not actionable.
    expect(html).toContain("contradictions, skills_active, ghost_accuracy");
    expect(html).toContain("3 subsystem reads threw");
  });

  it("renders unread counters as ? — not as a measured zero", () => {
    const degraded = render(degradedPayload());
    const healthy = render(healthyPayload());

    expect(degraded).toContain("?");
    // The identity axes counter is the clearest: "?" vs "0/8".
    expect(degraded).not.toContain("0/8");
    expect(healthy).toContain("0/8");
    // And the two renders must not be mistakable for each other, which is
    // exactly what they were before this change.
    expect(degraded).not.toEqual(healthy);
  });

  it("CONTROL · a healthy payload carries no degraded banner", () => {
    const html = render(healthyPayload());

    expect(html).not.toContain("read failed — unknown, not zero");
    expect(html).toContain("brain maturity");
  });

  /**
   * 2026-09-02 self-audit · "declares a truncated contradiction sample" was
   * deleted with the branch it tested.
   *
   * The rollup no longer reads a capped list -- countContradictionsByStatus
   * counts in SQL with no cap -- so `truncated` could never again be true, and
   * a banner behind a permanently-false flag is a dead alarm: the exact defect
   * class this wave spent its time removing. Its copy had also become false,
   * telling the operator that open/resolved "describe only the newest rows"
   * when they no longer are.
   *
   * The property that replaced it -- that the counts reach past 40 -- is
   * asserted in tests/lib/services/brain-domain-maturity-degraded.test.ts and
   * in tests/brain/contradiction-counts.test.ts.
   */
});
