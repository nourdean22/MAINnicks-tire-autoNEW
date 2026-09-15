// Mutation receipt (2026-09-15): evidence-mark.tsx `const showInline = inline || realityMode` -> `Boolean(inline)` (Reality Mode ignored):
// 1 failed | 3 passed; red: "Reality Mode on renders the SAME props inline" expected '<span data-evidence-mark="chip" class...' to contain 'data-evidence-mark="inline"'. Restored byte-for-byte (sha256 4b72a0eb).
/**
 * EvidenceMark: chip by default, inline under Reality Mode (2026-09-15).
 *
 * The mark is the PROOF slot for every important claim: one chip carrying
 * the evidence-class word, the full provenance in a tooltip. Reality Mode
 * (the persisted inspector-store flag) renders the SAME props as the full
 * provenance line INLINE, and the `inline` prop forces that regardless of
 * the store. A record with no provenance renders nothing at all: silence,
 * not a default.
 *
 * Asserted on RENDERED MARKUP. The vitest env is Node with no DOM, so
 * `renderToStaticMarkup` is how this repo asserts a component's output
 * (tests/components/wisdom-evolution-panel-states.test.tsx). The chip state
 * is the positive control: a mark that always rendered inline would pass
 * both Reality Mode cases and fail it. The base-ui Tooltip renders in Node
 * as-is (the trigger span carries the chip; the closed portal emits
 * nothing), so it is NOT mocked.
 *
 * WHY THE STORE IS STUBBED. `useInspectorStore` is zustand v5, whose hook
 * hands `getInitialState()` to `useSyncExternalStore` as the SERVER
 * snapshot. Under `renderToStaticMarkup` a component therefore always reads
 * the state the store was created with: `setState({ realityMode: true })`
 * on the real store is invisible to the render (observed 2026-09-15: the
 * chip rendered with the flag set). The stub below is the smallest thing
 * that lets a static render read the current flag: a selector over one
 * mutable object, with the `setState` / `getState` surface the tests use.
 * The real store's own behaviour is pinned by tests/state/inspector-store.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const store = vi.hoisted(() => {
  const state = { realityMode: false };
  const useInspectorStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    setState: (patch: Partial<typeof state>) => {
      Object.assign(state, patch);
    },
    getState: () => state,
  });
  return { state, useInspectorStore };
});

vi.mock("@/lib/state/inspector-store", () => ({ useInspectorStore: store.useInspectorStore }));

import { EvidenceMark } from "@/components/ui/evidence-mark";
import { useInspectorStore } from "@/lib/state/inspector-store";

const PROVENANCE = { evidence: "supported_inference", source: "journal_brain", seenCount: 3 };

/** HTML entities get in the way of plain-string assertions. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  useInspectorStore.setState({ realityMode: false });
});

describe("EvidenceMark / chip vs inline", () => {
  it("POSITIVE CONTROL: Reality Mode off renders the chip with the evidence-class word", () => {
    const html = renderToStaticMarkup(<EvidenceMark provenance={PROVENANCE} />);
    expect(html).toContain('data-evidence-mark="chip"');
    expect(html).not.toContain('data-evidence-mark="inline"');
    expect(text(html)).toContain("inferred");
  });

  it("Reality Mode on renders the SAME props inline with the full provenance", () => {
    useInspectorStore.setState({ realityMode: true });
    const html = renderToStaticMarkup(<EvidenceMark provenance={PROVENANCE} />);
    expect(html).toContain('data-evidence-mark="inline"');
    expect(html).not.toContain('data-evidence-mark="chip"');
    const body = text(html);
    expect(body).toContain("inferred");
    expect(body).toContain("source: journal_brain");
    expect(body).toContain("seen 3\u00d7");
  });

  it("the `inline` prop forces the inline form while Reality Mode is off", () => {
    const html = renderToStaticMarkup(<EvidenceMark provenance={PROVENANCE} inline />);
    expect(html).toContain('data-evidence-mark="inline"');
    expect(html).not.toContain('data-evidence-mark="chip"');
    const body = text(html);
    expect(body).toContain("source: journal_brain");
    expect(body).toContain("seen 3\u00d7");
  });

  it("an empty provenance renders nothing, in either mode", () => {
    expect(renderToStaticMarkup(<EvidenceMark provenance={{}} />)).toBe("");
    useInspectorStore.setState({ realityMode: true });
    expect(renderToStaticMarkup(<EvidenceMark provenance={{}} />)).toBe("");
    expect(renderToStaticMarkup(<EvidenceMark provenance={{}} inline />)).toBe("");
  });
});
