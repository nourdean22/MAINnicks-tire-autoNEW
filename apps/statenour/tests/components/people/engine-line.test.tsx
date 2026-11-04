/**
 * W8b · the /people header says what is waiting for his yes and what the engine's last run did.
 * Each state has its own words; `unknown` never reads as ok; a count of 0 renders nothing (no "0 waiting" noise).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EngineLine, SuggestionsWaiting } from "@/components/people/engine-line";

describe("EngineLine · a partial run (Codex round, finding 2)", () => {
  it("says how far it got, and never says nothing to propose", () => {
    const html = renderToStaticMarkup(<EngineLine engine={{ state: "partial", at: null, reason: "checked 5, 3 still to check" }} />);
    expect(html).toContain("no changes yet (checked 5, 3 still to check)");
    expect(html).not.toContain("nothing to propose");
  });
});

describe("EngineLine · an old row (manager round 1, item 7b)", () => {
  it("says the run happened and its result was not recorded", () => {
    const html = renderToStaticMarkup(<EngineLine engine={{ state: "ran", at: null, reason: null }} />);
    expect(html).toContain("result not recorded (old format)");
    expect(html).not.toContain("proposed something");
  });
});

describe("SuggestionsWaiting", () => {
  it("renders the count with the verb only when something waits", () => {
    expect(renderToStaticMarkup(<SuggestionsWaiting count={18} />)).toContain("18 waiting for your yes");
    expect(renderToStaticMarkup(<SuggestionsWaiting count={1} />)).toContain("1 waiting for your yes");
    expect(renderToStaticMarkup(<SuggestionsWaiting count={0} />)).toBe("");
    expect(renderToStaticMarkup(<SuggestionsWaiting count={undefined} />)).toBe("");
  });
});

describe("EngineLine", () => {
  const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
  it("ok, nothing to propose, failed with reason, running", () => {
    expect(renderToStaticMarkup(<EngineLine engine={{ state: "ok", at, reason: null }} />)).toMatch(/Engine ran .*: proposed something/);
    expect(renderToStaticMarkup(<EngineLine engine={{ state: "nothing_to_propose", at, reason: null }} />)).toContain("nothing to propose");
    const failed = renderToStaticMarkup(<EngineLine engine={{ state: "failed", at, reason: "chat_read_failed" }} />);
    expect(failed).toContain("failed");
    expect(failed).toContain("chat_read_failed");
    expect(renderToStaticMarkup(<EngineLine engine={{ state: "running", at, reason: null }} />)).toContain("running now");
  });

  it("never and unknown are their own words, and unknown is not ok", () => {
    expect(renderToStaticMarkup(<EngineLine engine={{ state: "never", at: null, reason: null }} />)).toContain("has never run");
    const unknown = renderToStaticMarkup(<EngineLine engine={{ state: "unknown", at: null, reason: null }} />);
    expect(unknown).toContain("unknown");
    expect(unknown).not.toMatch(/\bok\b/);
    // An old client payload without the field: say unknown, not nothing.
    expect(renderToStaticMarkup(<EngineLine engine={undefined} />)).toContain("unknown");
  });
});
