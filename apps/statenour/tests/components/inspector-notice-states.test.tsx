// Mutation receipt (2026-09-15): inspector-notice.tsx `if (state === "not-found")` -> `&& false` (not-found fell through to unknown-kind):
// 2 failed | 5 passed; red: expected '<div data-inspector-state="unknown-ki...' to contain 'data-inspector-state="not-found"', and the pairwise "to not deeply equal". Restored byte-for-byte (sha256 de390351).
/**
 * InspectorNotice: four non-content states that must never look alike
 * (2026-09-15).
 *
 * A kind with no renderer, a read that failed, an id that resolved to
 * nothing, and a read in flight are four different facts. The "empty is not
 * error" house rule (components/ui/empty-state.tsx) says each must declare
 * which it is, and the provenance chip is what tells the operator. So every
 * state is asserted on RENDERED MARKUP for its own `data-inspector-state`
 * and its own provenance text, and then the four are asserted pairwise
 * different, which is the whole point.
 *
 * Node env, no DOM: `renderToStaticMarkup` is the house pattern
 * (tests/components/wisdom-evolution-panel-states.test.tsx). The negative
 * assertions (not-found does NOT say "read failed", loading claims NO
 * provenance) are the control: a notice hard-wired to the error copy would
 * pass the error case and fail them.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { InspectorNotice, type InspectorNoticeState } from "@/components/inspector/inspector-notice";
import { PROVENANCE_LABEL } from "@/components/ui/empty-state";

function render(state: InspectorNoticeState, kind = "task", code?: string): string {
  return renderToStaticMarkup(<InspectorNotice state={state} kind={kind} code={code} />);
}

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

describe("InspectorNotice / each state declares itself", () => {
  it("error: the read failed, the compact code, and 'unknown' - never a measured zero", () => {
    const html = render("error", "task", "P2024");
    expect(html).toContain('data-inspector-state="error"');
    expect(html).toContain('data-provenance="ERROR"');
    expect(html).toContain(PROVENANCE_LABEL.ERROR);
    const body = text(html);
    expect(body).toContain("Could not read this task");
    expect(body).toContain("The read failed (P2024)");
    expect(body).toContain("unknown");
    expect(body).not.toContain(PROVENANCE_LABEL.ZERO);
    expect(body).not.toContain(PROVENANCE_LABEL.UNMEASURED);
  });

  it("error without a code still says the read failed, with no empty parenthesis", () => {
    const body = text(render("error", "memory"));
    expect(body).toContain("Could not read this memory");
    expect(body).toContain("The read failed. Its state is unknown");
    expect(body).not.toContain("()");
  });

  it("not-found: a measured zero for this id, and no error copy", () => {
    const html = render("not-found", "task");
    expect(html).toContain('data-inspector-state="not-found"');
    expect(html).toContain('data-provenance="ZERO"');
    expect(html).toContain(PROVENANCE_LABEL.ZERO);
    const body = text(html);
    expect(body).toContain("No task with this id");
    expect(body).not.toContain("read failed");
    expect(body).not.toContain(PROVENANCE_LABEL.UNMEASURED);
  });

  it("unknown-kind: unmeasured, and names the kind it has no renderer for", () => {
    const html = render("unknown-kind", "cron");
    expect(html).toContain('data-inspector-state="unknown-kind"');
    expect(html).toContain('data-provenance="UNMEASURED"');
    expect(html).toContain(PROVENANCE_LABEL.UNMEASURED);
    const body = text(html);
    expect(body).toContain('No inspector for "cron" yet');
    expect(body).not.toContain("read failed");
    expect(body).not.toContain(PROVENANCE_LABEL.ZERO);
  });

  it("unknown-kind: a kind outside the registry is echoed verbatim, not relabelled", () => {
    expect(text(render("unknown-kind", "widget"))).toContain('No inspector for "widget" yet');
  });

  it("loading: busy, with no provenance claim at all", () => {
    const html = render("loading", "task");
    expect(html).toContain('data-inspector-state="loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("data-provenance");
    expect(text(html)).not.toContain("read failed");
  });
});

describe("InspectorNotice / the four states are pairwise different", () => {
  it("no two states share markup, and each carries its own state attribute", () => {
    const states: InspectorNoticeState[] = ["unknown-kind", "error", "not-found", "loading"];
    const rendered = states.map((s) => render(s, "task"));
    for (let i = 0; i < rendered.length; i++) {
      for (let j = i + 1; j < rendered.length; j++) {
        expect(rendered[i]).not.toEqual(rendered[j]);
      }
    }
    const attrs = rendered.map((h) => h.match(/data-inspector-state="([^"]+)"/)?.[1]);
    expect(attrs).toEqual(states);
    expect(new Set(attrs).size).toBe(4);
  });
});
