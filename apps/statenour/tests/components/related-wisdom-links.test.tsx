/**
 * The see-also list says why it is empty, and its rows are real links.
 *
 * DEFECT #2 (2026-09-02 self-audit). The API distinguishes "this anchor
 * has no embedding" from "nothing cleared the similarity floor" — the
 * route returns `reason` for both — and the client declared
 * `reason?: string`, then did `setRelated(data.related ?? [])` and never
 * read it. Every empty result rendered "no related wisdoms above 0.40
 * similarity", so a row whose similarity was NEVER COMPUTED read exactly
 * like a semantically isolated one. The `0.40` was hardcoded too, and
 * the pool's `confidence >= 0.5` narrowing went unmentioned entirely.
 *
 * DEFECT #3. The file header promised "each links back to
 * /brain?tab=wisdom&focus=<key> so the operator can jump between
 * related wisdoms without leaving the page". The render was an <li>
 * holding three <span>s: no <a>, no href, no onClick. The `focus` param
 * and its scroll handler already existed and worked
 * (components/brain/wisdom-tab.tsx) — nothing emitted a link to them.
 *
 * DEFECT #5. `ORIGIN_BADGE` here omitted `chat-scrape`, so a row the
 * main list labelled "Chat scrape" fell through to the raw origin key
 * in this list on the same screen.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

// `scroll` is consumed by the real next/link; drop it here rather than
// letting React warn about a non-boolean DOM attribute.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll: _scroll,
    ...rest
  }: {
    href: unknown;
    children: React.ReactNode;
    scroll?: boolean;
  }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

import {
  RelatedWisdomRow,
  relatedEmptyMessage,
  wisdomFocusHref,
} from "@/components/brain/related-wisdom-links";

const FLOORS = { similarity: 0.4, poolConfidence: 0.5 };

const row = {
  id: "w1",
  // 2026-09-02 · the suffix here used to be a cuid-shaped fragment, whose
  // entropy tripped gitleaks' generic-api-key rule and hard-failed CI. Only
  // the `nick_advice_` PREFIX carries meaning — it is what wisdom-origins
  // resolves to `chat-scrape`. A plain-word suffix keeps the test identical
  // and stops a fixture from reading as a credential. Do not quote the old
  // value in a comment either; that re-trips the same scanner.
  key: "nick_advice_example",
  content: "Charge for the diagnosis, not the guess.",
  origin: "chat-scrape",
  similarity: 0.87,
  topics: ["money"],
  topicLabels: ["Money"],
};

describe("relatedEmptyMessage · an unembedded row is not an isolated row", () => {
  it("says similarity was never computed when the anchor has no embedding", () => {
    const msg = relatedEmptyMessage("no_embedding_for_anchor", FLOORS);
    expect(msg).toContain("no embedding");
    expect(msg).toContain("never computed");
    // The precise regression: this case must NOT be describable with the
    // similarity-threshold sentence, which asserts a computation that
    // did not happen.
    expect(msg).not.toContain("40%");
    expect(msg).not.toMatch(/above .* similarity/);
  });

  it("says the same for an unparseable stored embedding", () => {
    const msg = relatedEmptyMessage("anchor_parse_failed", FLOORS);
    expect(msg).toContain("never computed");
    expect(msg).not.toContain("40%");
  });

  it("names BOTH floors when similarity really was computed and nothing cleared it", () => {
    const msg = relatedEmptyMessage("no_match_above_threshold", FLOORS);
    expect(msg).toContain("40%");
    // The confidence narrowing the old copy never mentioned.
    expect(msg).toContain("50%");
  });

  it("names the confidence floor when the candidate pool was empty", () => {
    const msg = relatedEmptyMessage("empty_pool", FLOORS);
    expect(msg).toContain("50%");
    expect(msg).not.toContain("40%");
  });

  it("reads the floors from the response rather than hardcoding them", () => {
    // Retuning the route must move the operator-visible copy with it.
    const msg = relatedEmptyMessage("no_match_above_threshold", {
      similarity: 0.55,
      poolConfidence: 0.7,
    });
    expect(msg).toContain("55%");
    expect(msg).toContain("70%");
    expect(msg).not.toContain("40%");
  });

  it("admits it does not know when the API sent no reason", () => {
    const msg = relatedEmptyMessage(undefined, FLOORS);
    expect(msg).toContain("did not say why");
  });

  it("the four reasons produce four distinct sentences", () => {
    // Control: a helper returning one string for everything would pass
    // several assertions above by accident.
    const msgs = [
      "no_embedding_for_anchor",
      "anchor_parse_failed",
      "empty_pool",
      "no_match_above_threshold",
    ].map((r) => relatedEmptyMessage(r, FLOORS));
    expect(new Set(msgs).size).toBe(4);
  });
});

describe("wisdomFocusHref · the deep link the header promises", () => {
  it("targets the wisdom tab's focus param", () => {
    expect(wisdomFocusHref("wisdom_greene_law_1")).toBe(
      "/brain?tab=wisdom&focus=wisdom_greene_law_1",
    );
  });

  it("encodes a key that would otherwise break the query string", () => {
    expect(wisdomFocusHref("a&b=c d")).toBe("/brain?tab=wisdom&focus=a%26b%3Dc%20d");
  });
});

describe("RelatedWisdomRow · rendered markup", () => {
  const html = renderToStaticMarkup(<RelatedWisdomRow r={row} />);

  it("renders an anchor carrying the focus href", () => {
    // An <a href> is keyboard-focusable and Enter-activatable by
    // construction — asserted on output, not on an onClick prop name.
    expect(html).toContain("<a");
    expect(html).toContain('href="/brain?tab=wisdom&amp;focus=nick_advice_example"');
  });

  it("declares a visible focus state", () => {
    expect(html).toContain("focus-visible:ring");
  });

  it("labels chat-scrape from the shared registry", () => {
    // The origin ORIGIN_BADGE omitted. Pre-fix this rendered the raw
    // key while the main list said "Chat scrape".
    expect(html).toContain("Chat");
    expect(html).not.toContain("chat-scrape");
  });

  it("still shows the excerpt and the similarity percentage", () => {
    expect(html).toContain("Charge for the diagnosis");
    expect(html).toContain("87%");
  });
});
