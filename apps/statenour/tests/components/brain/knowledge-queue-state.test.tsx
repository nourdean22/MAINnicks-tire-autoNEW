/**
 * CANARY · a governed-knowledge queue that FAILED TO READ must not render as
 * a queue that is empty.
 *
 * THE DEFECT. Both panels under /brain → Review initialised state to
 * `{ total: 0, items: [] }`; their catch fired a `toast.error` and set nothing
 * else; the render fell through to "0 pending" and "No knowledge is waiting
 * for review." (and, in the sibling, "0 awaiting outcome" / "No approved
 * actions are waiting for an outcome."). A dead read and a measured zero
 * produced identical markup — directly beneath the page whose own header
 * comment says the two must never look the same, and beside two siblings that
 * already handle it (discover-tab's "state unknown, not empty" and
 * research-pipeline-status's "unknown, not zero"). A toast is not state: it
 * expires, and it is absent entirely after a reload.
 *
 * WHAT IS ASSERTED. Rendered markup, not a flag: the failed body and the empty
 * body must not be equal, and the failed one must not contain the empty copy.
 * The panels themselves cannot be driven here — vitest runs with
 * `environment: "node"` and no DOM, so `useEffect` never fires and
 * renderToStaticMarkup would only ever reach the loading branch. So the two
 * decisions the panels make (`queueView`) and the markup they emit
 * (`QueueBody`) are exported and rendered directly, and the wiring that
 * connects them is pinned by source text with comments stripped.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

// Node has no ESM resolution for these in the test env, and neither carries
// behaviour this canary is about.
vi.mock("lucide-react", () => ({
  Check: () => null,
  RefreshCw: () => null,
  ShieldAlert: () => null,
  X: () => null,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/utils/api-fetch", () => ({ apiFetch: vi.fn() }));

import { QueueBody, queueView } from "@/components/brain/knowledge-review-tab";

const EMPTY_LABEL = "No knowledge is waiting for review.";

const render = (failed: boolean) =>
  renderToStaticMarkup(
    <QueueBody
      body={queueView({ loading: false, failed, total: 0, items: 0, noun: "pending" }).body}
      emptyLabel={EMPTY_LABEL}
      detail={failed ? "Database compute quota exhausted." : null}
    />,
  );

/** Comments stripped FIRST — otherwise these assertions fire on the very
 *  comments that describe the defect. */
function source(file: string): string {
  return readFileSync(path.resolve(__dirname, "../../../components/brain", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
}

describe("CANARY · a failed read and an empty queue are different surfaces", () => {
  it("BREAKS: the two bodies do not render the same markup", () => {
    const failed = render(true);
    const empty = render(false);

    expect(failed).not.toEqual(empty);
    // The specific lie: an unread queue claiming there is nothing to review.
    expect(failed).not.toContain(EMPTY_LABEL);
    expect(empty).toContain(EMPTY_LABEL);
    // And the failed one says which it is, in the siblings' own vocabulary.
    expect(failed).toMatch(/unknown, not empty/);
  });

  it("BREAKS: the header count is not a measured number when nothing was measured", () => {
    const failed = queueView({ loading: false, failed: true, total: 0, items: 0, noun: "pending" });
    const measured = queueView({ loading: false, failed: false, total: 0, items: 0, noun: "pending" });

    expect(failed.headline).not.toBe(measured.headline);
    expect(failed.headline).not.toMatch(/\d/); // no number at all — none was read
    expect(measured.headline).toBe("0 pending");
  });

  it("carries the server's own message through, rather than a generic line", () => {
    // apiFetch surfaces the envelope's `error` string as ApiError.message; the
    // panels stash it in state precisely so the operator can act on it.
    expect(render(true)).toContain("Database compute quota exhausted.");

    // ...and with no message at all it still reads as unknown rather than
    // going blank, which is the failure mode ("a panel rendering nothing is
    // indistinguishable from a panel that crashed") empty-state.tsx names.
    const bare = renderToStaticMarkup(
      <QueueBody body="unknown" emptyLabel={EMPTY_LABEL} detail={null} />,
    );
    expect(bare).toMatch(/unknown, not empty/);
    expect(bare).not.toContain(EMPTY_LABEL);
  });

  it("positive controls: loading is still loading, and a non-empty list is still a list", () => {
    const loading = queueView({ loading: true, failed: false, total: 0, items: 0, noun: "pending" });
    expect(loading.body).toBe("loading");
    expect(loading.headline).toBe("Loading");
    // A body of "loading" or "items" renders nothing — the panel's own list
    // does that work, and survives a failed refresh as last-known-good.
    expect(renderToStaticMarkup(<QueueBody body="loading" emptyLabel={EMPTY_LABEL} detail={null} />)).toBe("");
    expect(renderToStaticMarkup(<QueueBody body="items" emptyLabel={EMPTY_LABEL} detail={null} />)).toBe("");

    const list = queueView({ loading: false, failed: false, total: 3, items: 3, noun: "awaiting outcome" });
    expect(list.body).toBe("items");
    expect(list.headline).toBe("3 awaiting outcome");
  });

  it("BREAKS: BOTH panels are wired to it — the defect shipped twice, as a copy-paste", () => {
    for (const [file, label] of [
      ["knowledge-review-tab.tsx", EMPTY_LABEL],
      ["knowledge-action-outcomes.tsx", "No approved actions are waiting for an outcome."],
    ] as const) {
      const src = source(file);
      // The empty copy exists only as a prop handed to QueueBody, never as an
      // independently-rendered card gated on `items.length === 0`.
      expect(src).toContain(`emptyLabel="${label}"`);
      expect(src).not.toMatch(/!loading && data\.items\.length === 0/);
      // The catch records STATE. A toast alone is what made the two look alike.
      expect(src).toMatch(/catch \(error\)[\s\S]{0,300}setLoadError\(/);
      // ...and the panel's own headline comes from the shared decision.
      expect(src).toMatch(/\{view\.headline\}/);
    }
  });
});
