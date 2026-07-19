/**
 * contentRunAttribution — what a piece of content actually earned.
 *
 * The rules these tests defend are all about REFUSING to invent a number:
 *   - an invoice claimed by two runs is counted for NEITHER (no evidence
 *     supports any split, and counting it twice reports revenue that
 *     does not exist)
 *   - only PAID invoices count; work in progress is not revenue
 *   - leads with no utm_content are counted as a NAMED blind spot, not
 *     silently dropped
 *
 * The failure mode being prevented: a report that looks precise, is trusted, and
 * quietly double-counts. This codebase has already shipped fabricated precision
 * twice today.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateContentRunRevenue, applyTrackingToCaption, buildTrackedUrl,
  CONTENT_RUN_UTM_PARAM, isContentRunId,
  type ContentLeadRow,
} from "./services/contentRunAttribution";

/** A real run id shape: `run_` + uuid, as createContentRun mints them. */
const RUN_A = "run_11111111-2222-4333-8444-555555555555";
const RUN_B = "run_66666666-7777-4888-8999-aaaaaaaaaaaa";

const lead = (over: Partial<ContentLeadRow> = {}): ContentLeadRow => ({
  leadId: 1, utmContent: RUN_A, invoiceId: null, invoiceStatus: null, invoiceAmountCents: null, ...over,
});

describe("revenue is only counted when it is real", () => {
  it("credits a run for a uniquely-linked PAID invoice", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: RUN_A, invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 48600 }),
    ]);
    expect(s.runs[0]).toMatchObject({ runId: RUN_A, leadCount: 1, uniquelyLinkedPaidInvoices: 1, verifiedRevenueCents: 48600 });
  });

  it("does NOT count an unpaid invoice as revenue", () => {
    const s = aggregateContentRunRevenue([
      lead({ invoiceId: 10, invoiceStatus: "open", invoiceAmountCents: 90000 }),
    ]);
    expect(s.runs[0].verifiedRevenueCents).toBe(0);
    expect(s.totals.verifiedRevenueCents).toBe(0);
  });

  it.each(["pending", "partial", "refunded"])("does not count a '%s' invoice as revenue", (status) => {
    // Each exclusion is a decision: pending is not money yet, counting a PARTIAL
    // at full value would overstate, and a refund is money that came back.
    const s = aggregateContentRunRevenue([
      lead({ invoiceId: 10, invoiceStatus: status, invoiceAmountCents: 50000 }),
    ]);
    expect(s.totals.verifiedRevenueCents).toBe(0);
  });

  it("counts a lead with no invoice at all as a lead, not as revenue", () => {
    const s = aggregateContentRunRevenue([lead()]);
    expect(s.runs[0].leadCount).toBe(1);
    expect(s.runs[0].verifiedRevenueCents).toBe(0);
  });
});

describe("an invoice two runs both claim", () => {
  it("is counted for NEITHER — a split would be invented, and both would double-count", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: RUN_A, invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 50000 }),
      lead({ leadId: 2, utmContent: RUN_B, invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 50000 }),
    ]);
    expect(s.totals.verifiedRevenueCents).toBe(0);
    expect(s.totals.ambiguousInvoiceCount).toBe(1);
    for (const r of s.runs) expect(r.uniquelyLinkedPaidInvoices).toBe(0);
    // Both runs still show their lead — the CONTACT happened even though the
    // revenue cannot be assigned.
    expect(s.runs.map((r) => r.leadCount)).toEqual([1, 1]);
  });

  it("still credits an invoice two leads from the SAME run share", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: RUN_A, invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 30000 }),
      lead({ leadId: 2, utmContent: RUN_A, invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 30000 }),
    ]);
    expect(s.totals.ambiguousInvoiceCount).toBe(0);
    // One invoice, counted once, despite two leads pointing at it.
    expect(s.runs[0].uniquelyLinkedPaidInvoices).toBe(1);
    expect(s.runs[0].verifiedRevenueCents).toBe(30000);
  });
});

describe("the blind spot is named, not hidden", () => {
  it("counts untracked leads separately and says how many", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: RUN_A }),
      lead({ leadId: 2, utmContent: null }),
      lead({ leadId: 3, utmContent: "   " }),
    ]);
    expect(s.totals.unattributedLeadCount).toBe(2);
    expect(s.totals.attributedLeadCount).toBe(1);
    expect(s.limitations.join(" ")).toMatch(/2 lead\(s\) had no utm_content/);
  });

  it("always states its limits, even on a clean dataset", () => {
    const s = aggregateContentRunRevenue([lead()]);
    expect(s.limitations.length).toBeGreaterThanOrEqual(4);
    expect(s.limitations.join(" ")).toMatch(/walk-in or a direct call is invisible/);
  });
});

describe("cost sits beside revenue", () => {
  it("attaches generation cost so the ratio is honest", () => {
    const s = aggregateContentRunRevenue(
      [lead({ invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 48600 })],
      { [RUN_A]: 1800 },
    );
    expect(s.runs[0].generationCostCents).toBe(1800);
    expect(s.totals.generationCostCents).toBe(1800);
  });

  it("defaults an unknown cost to zero rather than guessing", () => {
    const s = aggregateContentRunRevenue([lead()]);
    expect(s.runs[0].generationCostCents).toBe(0);
  });
});

describe("ranking", () => {
  it("puts the highest-earning run first — the question the operator is asking", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: "run_aaaaaaaa-1111-4111-8111-111111111111", invoiceId: 1, invoiceStatus: "paid", invoiceAmountCents: 5000 }),
      lead({ leadId: 2, utmContent: "run_bbbbbbbb-2222-4222-8222-222222222222", invoiceId: 2, invoiceStatus: "paid", invoiceAmountCents: 90000 }),
    ]);
    expect(s.runs[0].runId).toBe("run_bbbbbbbb-2222-4222-8222-222222222222");
  });
});

describe("the tracked link", () => {
  it("carries the run id as utm_content — the run IS the tracking id", () => {
    const url = buildTrackedUrl({ baseUrl: "https://nickstire.org/book", runId: "run_847" });
    expect(url).toContain(`${CONTENT_RUN_UTM_PARAM}=run_847`);
    expect(url).toContain("utm_source=instagram");
    expect(url).toContain("utm_medium=organic");
  });

  it("preserves an existing path and query on the destination", () => {
    const url = buildTrackedUrl({ baseUrl: "https://nickstire.org/services/brakes?ref=x", runId: "run_1" });
    expect(url).toContain("/services/brakes");
    expect(url).toContain("ref=x");
  });

  it("labels a boosted post differently so paid and organic never merge", () => {
    const url = buildTrackedUrl({ baseUrl: "https://nickstire.org/book", runId: "run_1", medium: "paid_reel", campaign: "pothole_spring_2026" });
    expect(url).toContain("utm_medium=paid_reel");
    expect(url).toContain("utm_campaign=pothole_spring_2026");
  });
});

/**
 * `utm_content` is a SHARED, PUBLIC field — a standard UTM parameter any campaign
 * can set. The GBP publisher already writes archetype names into it. Treating
 * every value as a content run id put Google Business Profile revenue on an
 * Instagram screen, under a made-up run whose id was an archetype name.
 */
describe("only a real content run id is a content run", () => {
  it("recognises the shape createContentRun actually mints", () => {
    expect(isContentRunId(RUN_A)).toBe(true);
  });

  it.each([
    "seasonal_authority",       // a GBP archetype — the measured collision
    "run_a",                    // truncated / hand-typed
    "spring_promo",
    "run_not-a-uuid",
    "",
    null,
    undefined,
  ])("rejects %p", (value) => {
    expect(isContentRunId(value as string)).toBe(false);
  });

  it("counts a foreign tracking id in its OWN bucket — not as a run, not as untracked", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: RUN_A, invoiceId: 1, invoiceStatus: "paid", invoiceAmountCents: 20000 }),
      lead({ leadId: 2, utmContent: "seasonal_authority", invoiceId: 2, invoiceStatus: "paid", invoiceAmountCents: 90000 }),
      lead({ leadId: 3, utmContent: null }),
    ]);
    expect(s.totals.foreignTrackingLeadCount).toBe(1);
    expect(s.totals.unattributedLeadCount).toBe(1);
    // The GBP money must NOT appear as Instagram content revenue.
    expect(s.runs.map((r) => r.runId)).toEqual([RUN_A]);
    expect(s.totals.verifiedRevenueCents).toBe(20000);
    expect(s.limitations.join(" ")).toMatch(/foreign tracking id|another campaign system/i);
  });
});

/**
 * A zero cost is ambiguous: it means either "generation was free" or "nothing
 * recorded a cost". Nothing wrote costCents at all, so every run reported a
 * revenue figure beside a zero — which reads as pure profit.
 */
describe("an unmeasured cost is not a zero cost", () => {
  it("says cost is UNMEASURED when no run in the window recorded one", () => {
    const s = aggregateContentRunRevenue([
      lead({ invoiceId: 1, invoiceStatus: "paid", invoiceAmountCents: 48600 }),
    ]);
    expect(s.totals.generationCostCents).toBe(0);
    expect(s.limitations.join(" ")).toMatch(/UNMEASURED/);
    expect(s.limitations.join(" ")).toMatch(/not read the revenue as pure profit/i);
  });

  it("stops warning once a real cost is recorded", () => {
    const s = aggregateContentRunRevenue([lead()], { [RUN_A]: 1800 });
    expect(s.limitations.join(" ")).not.toMatch(/UNMEASURED/);
  });
});

/**
 * buildTrackedUrl existed with ZERO callers. No published link ever carried a run
 * id, so leads.utmContent never contained one, so this whole report could only
 * ever be empty — and an empty report reads as "the content earned nothing"
 * rather than "nothing was ever measurable".
 */
describe("applyTrackingToCaption — the step that makes attribution possible", () => {
  it("rewrites a bare shop link so it carries the run id", () => {
    const r = applyTrackingToCaption({
      caption: "Potholes are back. Book at nickstire.org/book before the rush.",
      runId: RUN_A,
    });
    expect(r.rewritten).toBe(1);
    expect(r.caption).toContain(`${CONTENT_RUN_UTM_PARAM}=${RUN_A}`);
    expect(r.caption).toContain("utm_source=instagram");
    // The surrounding copy is untouched — this is instrumentation, not editing.
    expect(r.caption).toMatch(/^Potholes are back\. Book at https:\/\/nickstire\.org\/book\?/);
    expect(r.caption).toContain(" before the rush.");
  });

  it.each([
    "nickstire.org",
    "www.nickstire.org/tires",
    "https://nickstire.org/services/brakes",
    "HTTP://WWW.NICKSTIRE.ORG/book",
  ])("handles the link form '%s' a model actually writes", (link) => {
    const r = applyTrackingToCaption({ caption: `Call us — ${link}`, runId: RUN_A });
    expect(r.rewritten).toBe(1);
    expect(r.trackedUrls[0]).toContain(`${CONTENT_RUN_UTM_PARAM}=${RUN_A}`);
  });

  it("NEVER invents a link — a caption with no CTA stays exactly as written", () => {
    // Adding a link the operator did not write would change the post. This
    // function's job is to make an existing link measurable, not to do marketing.
    const caption = "Winter tires matter. Come see us.";
    const r = applyTrackingToCaption({ caption, runId: RUN_A });
    expect(r.caption).toBe(caption);
    expect(r.rewritten).toBe(0);
  });

  it("does not reassign a link that already carries someone else's run id", () => {
    const caption = `Book at https://nickstire.org/book?${CONTENT_RUN_UTM_PARAM}=${RUN_B}`;
    const r = applyTrackingToCaption({ caption, runId: RUN_A });
    expect(r.caption).toContain(RUN_B);
    expect(r.caption).not.toContain(RUN_A);
    expect(r.rewritten).toBe(0);
  });

  it("refuses to tag with something that is not a run id", () => {
    const r = applyTrackingToCaption({ caption: "Book at nickstire.org/book", runId: "seasonal_authority" });
    expect(r.rewritten).toBe(0);
    expect(r.caption).toBe("Book at nickstire.org/book");
  });

  it("tags every shop link in a caption, not just the first", () => {
    const r = applyTrackingToCaption({
      caption: "Tires: nickstire.org/tires · Brakes: nickstire.org/brakes",
      runId: RUN_A,
    });
    expect(r.rewritten).toBe(2);
  });

  it("leaves other domains alone", () => {
    const r = applyTrackingToCaption({ caption: "Not us: example.com/book", runId: RUN_A });
    expect(r.rewritten).toBe(0);
  });
});
