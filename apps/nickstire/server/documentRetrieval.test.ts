import { describe, it, expect } from "vitest";
import { extractReadableText } from "./services/documentRetrieval";
import { selectSupportingPassage, evaluateEntailment, entailAgainstPassage } from "../shared/claimEntailment";

/**
 * Offline by design — no network in the suite. The live behaviour was measured
 * against the three curated sources on 2026-08-01 and is recorded in
 * documentRetrieval.ts; these lock the parts that decide whether a retrieved
 * page can be trusted as evidence.
 */
const PAGE = `
<html><head><title>T</title><style>.a{color:red}</style></head>
<body>
  <nav>Site Builder > Global Components > IOP Desktop > Header > Head Injected Desktop Core</nav>
  <header>Skip to main content. Search. Menu. Contact Us.</header>
  <main>
    <h1>Tire Safety</h1>
    <p>Tire pressure should be checked monthly, when tires are cold.</p>
    <p>Underinflated tires can increase the risk of a blowout and reduce fuel economy.</p>
  </main>
  <footer>Copyright 2026. Privacy Policy. Accessibility. 1.800.555.0100</footer>
  <script>tracking(1234);</script>
</body></html>`;

describe("extraction keeps the argument and drops the furniture", () => {
  const text = extractReadableText(PAGE);

  it("keeps the substantive prose", () => {
    expect(text).toContain("Tire pressure should be checked monthly");
    expect(text).toContain("increase the risk of a blowout");
  });

  it("drops nav, header, footer, script and style", () => {
    // Real measured chrome from epa.ohio.gov. A claim checked against menu
    // breadcrumbs is checked against nothing.
    expect(text).not.toContain("Site Builder");
    expect(text).not.toContain("Skip to main content");
    expect(text).not.toContain("Privacy Policy");
    expect(text).not.toContain("tracking");
    expect(text).not.toContain("color:red");
  });

  it("does not leak footer phone numbers that would satisfy a number check", () => {
    // A stray "1.800.555.0100" in a footer is exactly the kind of digit run
    // that can make an unrelated numeric claim look sourced.
    expect(text).not.toContain("555.0100");
  });

  it("preserves block boundaries so passages split into sentences", () => {
    expect(text.split(".").length).toBeGreaterThan(2);
  });
});

describe("passage selection is what prevents false confidence", () => {
  const text = extractReadableText(PAGE);

  it("scopes to the sentences that bear on the claim", () => {
    const p = selectSupportingPassage(text, "Tire pressure should be checked monthly when tires are cold.");
    expect(p).not.toBeNull();
    expect(p!.passage).toContain("checked monthly");
  });

  it("REFUSES when the document is not about the claim", () => {
    // The whole point. Without scoping, a long page's vocabulary overlaps
    // almost any claim and evaluateEntailment returns `supported` for
    // statements the page never makes.
    const p = selectSupportingPassage(text, "Ohio requires E-Check emissions testing every 2 years in 7 counties.");
    expect(p).toBeNull();
  });

  it("a whole-document check IS fooled where a passage check is not", () => {
    // A claim whose every term appears in the document, but never together:
    // "brake" in one section, "30,000 miles" in another. This is the ordinary
    // shape of a long guidance page, not a contrived one.
    const doc = [
      "Brake pads wear gradually and should be inspected during routine service.",
      "Engine oil is typically changed every 30,000 miles under severe conditions.",
      "Coolant should be flushed periodically to prevent corrosion.",
    ].join(" ");
    const claim = "Brake pads should be changed every 30,000 miles.";

    // Whole document: every term and the number are present somewhere, so the
    // checker sees full coverage and blesses a claim the page never makes.
    const whole = evaluateEntailment(claim, doc);
    expect(whole.verdict).toBe("supported");

    // Scoped: no single passage carries both halves, so it refuses.
    const p = selectSupportingPassage(doc, claim);
    const scoped = p ? entailAgainstPassage(claim, p) : { verdict: "not_supported" as const };
    expect(scoped.verdict).not.toBe("supported");
  });

  it("caps a passage so a citation stays quotable", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i} about tire pressure and inflation levels.`).join(" ");
    const p = selectSupportingPassage(long, "tire pressure inflation");
    expect(p!.passage.length).toBeLessThanOrEqual(600);
  });
});

describe("a page that renders client-side is not silently treated as empty", () => {
  it("yields too little prose to judge", () => {
    const spa = `<html><body><div id="root"></div><script>render()</script></body></html>`;
    expect(extractReadableText(spa).length).toBeLessThan(200);
    // documentRetrieval turns that into fetch_failed rather than handing the
    // checker an empty document and letting it conclude "not supported" about
    // a source it never actually read.
  });
});
