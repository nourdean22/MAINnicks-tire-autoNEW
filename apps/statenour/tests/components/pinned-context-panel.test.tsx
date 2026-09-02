/**
 * PinnedContextPanel · the operator surface must describe the real prompt.
 * 2026-09-02 self-audit.
 *
 * FOUR DEFECTS, all of the same family — a panel confidently reporting
 * something it had not measured:
 *
 *   1. It read `commandCenterState.brainAnchors.pinned`, a `take: 6` slice
 *      built to feed the SYSTEM PROMPT, and rendered it as the pin list.
 *      The header said "6 pinned" whether the operator had 6 pins or 60,
 *      and fresh / stale / veryStale / bySource / totalChars were every one
 *      of them computed over those same six rows.
 *   2. That slice ends in `.catch(() => [])` inside a larger fan-out
 *      (command-center-state.ts), so a FAILED pin read resolved the tRPC
 *      call with `isError: false` and an empty array — and the panel
 *      rendered "no pins yet · tap 📌 on any assistant reply" underneath a
 *      header reading "always loaded · confidence 1.0".
 *   3. `INJECTION_CAP = 5` while the renderer had no slice at all. At
 *      exactly six pins the sixth was labelled "idle" under a tooltip
 *      reading "Only the newest 5 pins ride with every request"; at 7+ no
 *      over-cap warning fired, because `pins.length > 5` was measured over
 *      a six-row array.
 *   4. `estimatedPromptTokens` summed STORED content length. Pins store up
 *      to 1200 chars, the prompt carries 200, so a long pin was billed at
 *      up to 6x its real cost — and nothing told the operator the pin was
 *      being cut at all.
 *
 * Every assertion below is on RENDERED OUTPUT, and every one was mutated:
 * the old code was put back, the test was watched go red, then restored.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: { message: string } | null;
  dataUpdatedAt: number;
}

const stubs = vi.hoisted(() => {
  const blank = (): QueryStub => ({
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    error: null,
    dataUpdatedAt: 0,
  });
  return { pinned: blank(), ccState: blank(), blank };
});

vi.mock("@/lib/trpc/client", () => {
  const mutation = {
    mutate: () => {},
    mutateAsync: async () => ({}),
    isPending: false,
  };
  const invalidate = async () => {};
  return {
    trpc: {
      useUtils: () => ({
        brain: { pinned: { invalidate } },
        operator: { commandCenterState: { invalidate } },
      }),
      brain: {
        pinned: { useQuery: () => stubs.pinned },
        createPin: { useMutation: () => mutation },
        updatePin: { useMutation: () => mutation },
        deletePin: { useMutation: () => mutation },
      },
      operator: { commandCenterState: { useQuery: () => stubs.ccState } },
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
// Chrome, and it drives a useSyncExternalStore clock that has nothing to do
// with what is under test.
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { PinnedContextPanel } from "@/components/brain/pinned-context-panel";
import {
  PINNED_PROMPT_CAP,
  PINNED_PROMPT_CHARS,
  renderPinnedLine,
} from "@/lib/ai/prompt/v2/renderer";

interface PanelPin {
  id: string;
  key: string;
  content: string;
  source: string;
  confidence: number;
  seenCount: number;
  createdAt: string;
  updatedAt: string;
  metadata: null;
}

function pin(n: number, content = `pin body ${n}`): PanelPin {
  const iso = new Date(Date.now() - n * 60_000).toISOString();
  return {
    id: `pin-${n}`,
    key: `pin_key_${n}`,
    content,
    source: "pin:manual",
    confidence: 1,
    seenCount: 1,
    createdAt: iso,
    updatedAt: iso,
    metadata: null,
  };
}

function givePins(pins: PanelPin[]): void {
  stubs.pinned.data = { pins, count: pins.length };
  stubs.pinned.isSuccess = true;
}

function render(): string {
  return renderToStaticMarkup(<PinnedContextPanel />);
}

/** HTML entities get in the way of plain-string assertions. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&middot;|&#xB7;/g, "·")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

beforeEach(() => {
  stubs.pinned = stubs.blank();
  stubs.ccState = stubs.blank();
});

describe("PinnedContextPanel · it lists the pin roster, not the prompt slice", () => {
  it("renders every pin the pin service returned, past the prompt cap", () => {
    // MUTATION RUN: point `pins` back at
    // `ccStateQuery.data?.brainAnchors?.pinned` and this goes red — the
    // count reads 6 and pin 12 is absent, which is precisely what the
    // operator saw. The command-center stub below carries DIFFERENT rows on
    // purpose: if the panel is reading the wrong source, it says so loudly
    // instead of coincidentally agreeing.
    const roster = Array.from({ length: 12 }, (_, i) => pin(i + 1));
    givePins(roster);
    stubs.ccState.data = {
      brainAnchors: {
        pinned: roster.slice(0, 6).map((p) => ({ ...p, content: "WRONG-SOURCE" })),
        rules: [],
      },
    };
    stubs.ccState.isSuccess = true;

    const body = text(render());
    expect(body).toContain("12 pinned");
    expect(body).toContain("pin body 12");
    expect(body).not.toContain("WRONG-SOURCE");
  });

  it("counts staleness over the whole roster, not over six rows", () => {
    // The derived stats were the quieter half of the same defect.
    const fresh = pin(1);
    const stale = Array.from({ length: 8 }, (_, i) => {
      const p = pin(i + 2);
      p.updatedAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
      return p;
    });
    givePins([fresh, ...stale]);

    expect(text(render())).toContain("8 very stale");
  });
});

describe("PinnedContextPanel · an empty state is a measurement, not a default", () => {
  it("a failed pin read says state unknown and never renders the empty state", () => {
    // MUTATION RUN: gate the empty state on `!error` (as the removed
    // comment claimed it already was) instead of on `pinsQuery.isSuccess`,
    // and feed the swallowed-failure shape below — red.
    stubs.pinned.isError = true;
    stubs.pinned.error = { message: "read timed out" };

    const body = text(render());
    expect(body).toContain("state unknown, not empty");
    expect(body).toContain("read timed out");
    expect(body).not.toContain("no pins yet");
    expect(render()).not.toContain('data-provenance="ZERO"');
  });

  it("the swallowed-failure shape — no data, no error flag — still renders no all-clear", () => {
    // MUTATION RUN: this reproduces production's `.catch(() => [])` exactly.
    // The pin read failed, so `brain.pinned` has no data and never reached
    // success; the command-center fan-out swallowed the SAME failure into
    // `[]` and resolved happily. Restore the old wiring — `pins` read off
    // `ccStateQuery.data.brainAnchors.pinned`, empty state gated on
    // `!error` — and this goes red with "no pins yet" printed over a failed
    // read, which is what the operator was shown.
    stubs.pinned.data = undefined;
    stubs.pinned.isSuccess = false;
    stubs.ccState.data = { brainAnchors: { pinned: [], rules: [] } };
    stubs.ccState.isSuccess = true;

    const body = text(render());
    expect(body).not.toContain("no pins yet");
  });

  it("an unsettled query holding an empty payload is not a measured zero", () => {
    // MUTATION RUN. This test exists because a mutation SURVIVED: swapping
    // the gate back from `pinsQuery.isSuccess` to `!error` left all twelve
    // other assertions green, because every state they build has `pins ===
    // null` when the read fails, and null short-circuits both gates
    // identically. A surviving mutation is no signal, so here is the state
    // that actually separates them — react-query's paused/placeholder shape:
    // data present, neither settled nor errored. `!error` calls that a
    // measured zero; `isSuccess` does not.
    //
    // What NEITHER gate can defend against is a service that swallows its
    // own failure into `[]` — that is why defect 2's real fix was moving off
    // the command-center fan-out, asserted above, and why `listPins` must
    // never grow a `.catch(() => [])`.
    stubs.pinned.data = { pins: [], count: 0 };
    stubs.pinned.isLoading = false;
    stubs.pinned.isError = false;
    stubs.pinned.isSuccess = false;

    const body = text(render());
    expect(body).not.toContain("no pins yet");
  });

  it("POSITIVE CONTROL: a genuine measured zero DOES render, and declares itself", () => {
    // Without this, a panel that deleted the empty state entirely would
    // satisfy every assertion above.
    givePins([]);
    const html = render();
    expect(text(html)).toContain("no pins yet");
    expect(html).toContain('data-provenance="ZERO"');
  });
});

describe("PinnedContextPanel · the cap it shows is the cap that ships", () => {
  it("labels the pin at the cap boundary as in-prompt, not idle", () => {
    // MUTATION RUN: `idx < 5` and this goes red. At exactly six pins the
    // sixth was drawn "idle" while the renderer was injecting it.
    givePins(Array.from({ length: PINNED_PROMPT_CAP }, (_, i) => pin(i + 1)));
    const body = text(render());
    expect(body).toContain(`${PINNED_PROMPT_CAP}/${PINNED_PROMPT_CAP} in prompt`);
    expect(body).not.toContain("idle");
    expect(body).not.toContain("over cap");
  });

  it("warns over the cap, at the count where the cap actually bites", () => {
    // MUTATION RUN: `pins.length > 5` was unreachable from a six-row slice,
    // so the warning never fired at all. With the roster read, one pin past
    // the cap must surface both the badge and an idle row.
    givePins(Array.from({ length: PINNED_PROMPT_CAP + 1 }, (_, i) => pin(i + 1)));
    const body = text(render());
    expect(body).toContain("over cap");
    expect(body).toContain("idle");
    expect(body).toContain(`${PINNED_PROMPT_CAP}/${PINNED_PROMPT_CAP} in prompt`);
  });
});

describe("PinnedContextPanel · a cut pin is visibly cut, and billed as cut", () => {
  const long = "L".repeat(1200);

  it("bills a long pin for what reaches the model, not for what is stored", () => {
    // MUTATION RUN: `Math.round(totalChars / 4)` and this goes red at 300
    // vs ~60. 1200 stored chars, PINNED_PROMPT_CHARS shipped.
    givePins([pin(1, long)]);
    const expected = Math.round(
      renderPinnedLine({ key: "pin_key_1", source: "pin:manual", content: long }).length / 4,
    );

    const body = text(render());
    expect(body).toContain(`~${expected} tokens`);
    expect(body).not.toContain(`~${Math.round(long.length / 4)} tokens`);
  });

  it("tells the operator the pin is being cut", () => {
    // MUTATION RUN: delete the truncation badge and this goes red. Before
    // it existed the panel showed the pin's full 1200 chars with no hint
    // that 1000 of them never left the database.
    givePins([pin(1, long)]);
    expect(text(render())).toContain(`cut at ${PINNED_PROMPT_CHARS} in prompt`);
  });

  it("POSITIVE CONTROL: a short pin carries no cut badge", () => {
    givePins([pin(1, "short and whole")]);
    expect(text(render())).not.toContain("cut at");
  });
});

describe("PinnedContextPanel · hot-rule confidence is not a percentage", () => {
  it("renders an attention label instead of NN%", () => {
    // MUTATION RUN: restore `confidence {Math.round(rule.confidence * 100)}%`
    // and this goes red. lib/brain/attention-label.ts (2026-08-19) exists to
    // kill that string — brain_memories.confidence is a re-sighting counter,
    // so "90%" was inventing a probability the column never held.
    givePins([]);
    stubs.ccState.data = {
      brainAnchors: {
        pinned: [],
        rules: [
          {
            category: "identity",
            key: "communication_dna",
            content: "Direct, terse, action-first.",
            confidence: 0.9,
          },
        ],
      },
    };
    stubs.ccState.isSuccess = true;

    const body = text(render());
    expect(body).toContain("communication_dna");
    expect(body).toMatch(/seen\s/);
    expect(body).not.toMatch(/\d+%/);
  });

  it("a failed hot-rule read declares itself instead of vanishing", () => {
    // The rules subsection used to disappear silently when the
    // command-center read failed — the same "declares nothing" shape.
    givePins([]);
    stubs.ccState.isError = true;
    const html = render();
    expect(html).toContain('data-provenance="ERROR"');
    expect(text(html)).toContain("Hot Rules couldn't load");
  });
});
