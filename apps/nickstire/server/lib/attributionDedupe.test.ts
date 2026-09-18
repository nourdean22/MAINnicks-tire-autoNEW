/**
 * Attribution dedupe — pinned against the REAL production cluster.
 *
 * The fixture below is not invented. It is the shape observed on
 * nickstire.org/admin on 2026-09-18: twenty weak matches in the attribution
 * review queue, eight of which claimed invoice #5160005. The review query
 * dedupes by call_id and not by invoice_id, so confirming all eight would have
 * counted that invoice eight times.
 */
import { describe, expect, it } from "vitest";

import {
  attributionCounts,
  collapseByInvoice,
  type AttributionCandidate,
} from "./attributionDedupe";

const at = (min: number) => new Date(Date.UTC(2026, 8, 18, 12, min));

const cand = (
  callId: number,
  invoiceId: number | null,
  confidence: number | null,
  minute: number,
): AttributionCandidate => ({
  id: callId,
  callId,
  invoiceId,
  confidence,
  resolution: invoiceId == null ? "ambiguous" : "manual_review",
  createdAt: at(minute),
});

/** The observed cluster: eight calls, one invoice. */
const PROD_CLUSTER: AttributionCandidate[] = [
  cand(16440001, 5160005, 0.75, 10),
  cand(16440002, 5160005, 0.75, 11),
  cand(16440003, 5160005, 0.75, 12),
  cand(16440005, 5160005, 0.9, 13),
  cand(16350006, 5160005, 0.75, 5),
  cand(16350007, 5160005, 0.75, 6),
  cand(16260032, 5160005, 0.75, 1),
  cand(16260035, 5160005, 0.75, 2),
];

describe("the production cluster · eight calls cannot each convert one invoice", () => {
  it("collapses to exactly ONE decision", () => {
    const r = collapseByInvoice(PROD_CLUSTER);
    expect(r.primary).toHaveLength(1);
    expect(r.duplicates).toHaveLength(7);
    expect(r.contestedInvoiceIds).toEqual([5160005]);
  });

  it("the winner is the highest-confidence claim", () => {
    const r = collapseByInvoice(PROD_CLUSTER);
    expect(r.primary[0].callId).toBe(16440005);
    expect(r.primary[0].confidence).toBe(0.9);
    expect(r.primary[0].claimantCount).toBe(8);
  });

  it("duplicates are RETAINED and point at the primary — never silently dropped", () => {
    // The other seven calls are almost certainly real contacts from the same
    // customer. They stop being separate MONEY decisions; they do not stop
    // existing.
    const r = collapseByInvoice(PROD_CLUSTER);
    expect(r.duplicates).toHaveLength(7);
    for (const d of r.duplicates) expect(d.sameInvoiceAs).toBe(16440005);
  });

  it("names the over-count the old queue would have produced", () => {
    const c = attributionCounts(collapseByInvoice(PROD_CLUSTER));
    expect(c.distinctInvoices).toBe(1);
    expect(c.candidateRows).toBe(8);
    expect(c.suppressedDuplicates).toBe(7);
    expect(c.overcountFactor).toBe(8);
  });
});

describe("tie-breaking", () => {
  it("on equal confidence the EARLIEST call wins", () => {
    // The call that began the journey is the better causal claim than one that
    // happened to land closest to the payment — someone confirming directions
    // ten minutes before arriving did not cause the visit.
    const r = collapseByInvoice([
      cand(200, 900, 0.75, 30),
      cand(100, 900, 0.75, 5),
      cand(300, 900, 0.75, 45),
    ]);
    expect(r.primary[0].callId).toBe(100);
  });

  it("confidence beats recency", () => {
    const r = collapseByInvoice([cand(100, 900, 0.75, 5), cand(200, 900, 0.9, 40)]);
    expect(r.primary[0].callId).toBe(200);
  });

  it("a null confidence never outranks a real one", () => {
    const r = collapseByInvoice([cand(100, 900, null, 1), cand(200, 900, 0.75, 40)]);
    expect(r.primary[0].callId).toBe(200);
  });
});

describe("rows that assert no invoice stay visible", () => {
  it("a multiple_plausible_invoices row is a primary, not a duplicate", () => {
    // It claims no specific money, so it cannot double-count any. It is still a
    // decision worth a human.
    const r = collapseByInvoice([cand(16470007, null, 0.5, 1), ...PROD_CLUSTER]);
    expect(r.primary.map((p) => p.callId)).toContain(16470007);
    expect(r.duplicates.map((d) => d.callId)).not.toContain(16470007);
  });

  it("several null-invoice rows never collapse into each other", () => {
    const r = collapseByInvoice([cand(1, null, 0.5, 1), cand(2, null, 0.5, 2)]);
    expect(r.primary).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
  });
});

describe("the honest-count contract", () => {
  it("POSITIVE CONTROL: genuinely distinct invoices are NOT collapsed", () => {
    // Without this, a function that always returned one row would satisfy every
    // assertion above and destroy real attributions.
    const r = collapseByInvoice([
      cand(1, 901, 0.9, 1),
      cand(2, 902, 0.9, 2),
      cand(3, 903, 0.9, 3),
    ]);
    expect(r.primary).toHaveLength(3);
    expect(r.duplicates).toHaveLength(0);
    expect(r.contestedInvoiceIds).toEqual([]);
    expect(attributionCounts(r).overcountFactor).toBe(1);
  });

  it("an empty queue reports null over-count, not 1 and not 0", () => {
    const c = attributionCounts(collapseByInvoice([]));
    expect(c.distinctInvoices).toBe(0);
    expect(c.overcountFactor).toBeNull();
  });

  it("mixed traffic: two contested invoices and two clean ones", () => {
    const r = collapseByInvoice([
      cand(1, 901, 0.9, 1),
      cand(2, 901, 0.75, 2),
      cand(3, 902, 0.75, 3),
      cand(4, 902, 0.75, 4),
      cand(5, 903, 0.9, 5),
      cand(6, 904, 0.9, 6),
    ]);
    expect(r.primary).toHaveLength(4);
    expect(r.duplicates).toHaveLength(2);
    expect(r.contestedInvoiceIds).toEqual([901, 902]);
    expect(attributionCounts(r).overcountFactor).toBe(1.5);
  });

  it("is total — hostile input never throws", () => {
    for (const bad of [[], [cand(1, null, null, 0)], [cand(1, 0, 0, 0)]]) {
      expect(() => collapseByInvoice(bad)).not.toThrow();
    }
  });
});
