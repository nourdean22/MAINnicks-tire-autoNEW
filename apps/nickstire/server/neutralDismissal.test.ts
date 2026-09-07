/**
 * Neutral dismissal, complaint identity, and who said what.
 *
 * THE PROBLEM THIS PINS. Before 2026-09-07 an operator hiding an irrelevant row
 * had to assert something false to do it:
 *   · `lost`            claims a sale was lost
 *   · `do_not_contact`  zeroes consent for that PHONE, from any UI, forever
 *   · the concern chips wrote `alg_estimates.stated_concern` as though the
 *     CUSTOMER had said "fixed elsewhere / sold the car / not interested",
 *     which then ended that customer's real recovery SMS sequence
 *
 * Three separate falsehoods available as tidy-up buttons. `dismissed` replaces
 * all three with the only claim that was ever true: a human looked and judged
 * this not actionable.
 *
 * WHAT MUST NOT REGRESS, and why each is asserted rather than assumed:
 *   1. dismissal is neutral        — no lost, no consent change, no concern
 *   2. dismissal is durable        — collectors must not resurrect it
 *   3. a NEW complaint still opens — durability must not silence a customer
 *   4. only the CUSTOMER can close a customer-facing rail
 *
 * (2) and (3) pull in opposite directions and that tension is the actual design
 * problem: key too narrowly and the same complaint returns daily; key too
 * broadly and a second, genuine complaint lands silently on a closed row. Both
 * directions are asserted here because satisfying either alone looks like
 * success.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canTransition,
  TERMINAL_STATES,
  OPPORTUNITY_STATES,
  type OpportunityState,
} from "./services/opportunityQueue";
import {
  isCustomerClosedSignal,
  CUSTOMER_SOURCED_CONCERN,
  RECOVERY_CLOSED_SIGNALS,
} from "./services/declinedRecoverySequence";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const service = read("server/services/opportunityQueue.ts");

const LIVE: OpportunityState[] = [
  "new", "assigned", "attempted", "contacted", "scheduled", "walk_in_expected", "arrived", "no_response",
];

describe("1 · dismissal exists and is reachable from anywhere live", () => {
  it("is a real state and a terminal one", () => {
    expect(OPPORTUNITY_STATES).toContain("dismissed");
    expect(TERMINAL_STATES).toContain("dismissed");
  });

  it("is reachable from every live state — an operator can always say 'not actionable'", () => {
    for (const from of LIVE) {
      expect(canTransition(from, "dismissed"), `${from} -> dismissed`).toBe(true);
    }
  });

  it("is final: a dismissed row cannot be walked into any other state", () => {
    for (const to of OPPORTUNITY_STATES) {
      expect(canTransition("dismissed", to), `dismissed -> ${to}`).toBe(false);
    }
  });

  it("fits the column without a migration", () => {
    // revenue_opportunities.state is VARCHAR(24) (drizzle/0099:34) and TiDB runs
    // STRICT_TRANS_TABLES — an over-width write is REJECTED and the row is LOST.
    // Assert the property, not the constant, so a future longer state is caught.
    for (const s of OPPORTUNITY_STATES) {
      expect(s.length, `state '${s}' exceeds VARCHAR(24)`).toBeLessThanOrEqual(24);
    }
  });
});

describe("2 · dismissal is NEUTRAL — it asserts nothing about the customer", () => {
  it("does not zero consent (only do_not_contact may)", () => {
    // The single write that could falsify consent is gated on the literal.
    expect(service).toMatch(/consent_ok = \$\{params\.to === "do_not_contact" \? 0 :/);
  });

  it("does not trigger the phone-wide suppression sweep", () => {
    expect(service).toMatch(/if \(params\.to === "do_not_contact" && current\.customerPhone\)/);
  });

  it("is excluded from LIVE_STATES, so it leaves the worklist without being 'lost'", () => {
    const live = service.match(/const LIVE_STATES[\s\S]*?\];/)?.[0] ?? "";
    expect(live).not.toMatch(/dismissed/);
    expect(live).toMatch(/"no_response"/); // sanity: we matched the right block
  });

  it("the UI dismiss action writes 'dismissed' and nothing else", () => {
    const tab = read("client/src/pages/admin/OpportunitiesSection.tsx");
    expect(tab).toMatch(/to: "dismissed"/);
    expect(tab).not.toMatch(/"lost"/);
    expect(tab).not.toMatch(/do_not_contact/);
    expect(tab).not.toMatch(/captureStatedConcern/);
  });
});

describe("3 · complaint identity — the same one stops, a new one gets through", () => {
  it("no longer mints a new row per calendar day", () => {
    // The old key was phone-plus-UTC-date, so a dismissed complaint returned
    // every morning (and the 'day' rolled at 20:00 ET).
    //
    // Assert against CODE, not prose: the first draft of this test matched the
    // explanatory comment describing the old key and failed on its own
    // documentation. A `const dayKey` declaration is the thing that cannot come
    // back; the words describing it are allowed to stay.
    expect(service).not.toMatch(/^\s*const dayKey\b/m);
    expect(service).toMatch(/sourceType: "review_recovery",\s*\n\s*sourceId: phone10,/);
  });

  it("upsert never overwrites state, which is what makes dismissal durable", () => {
    // Anchored on the first SQL column so the match starts at the statement and
    // not at a docstring that happens to name the clause.
    const onDup = service.match(/ON DUPLICATE KEY UPDATE\s*\n\s*expected_revenue_cents[\s\S]*?updated_at = CURRENT_TIMESTAMP/)?.[0] ?? "";
    expect(onDup, "the ON DUPLICATE KEY UPDATE statement was not found").not.toBe("");
    expect(onDup).not.toMatch(/\bstate\b/);
    expect(onDup).not.toMatch(/receipts_json/);
    expect(onDup).toMatch(/urgency = VALUES\(urgency\)/); // sanity
  });

  it("BUT a genuinely new complaint reopens a closed row", () => {
    // Durability must not become a gag. reopenIfTerminal is opt-in and set only
    // by captureComplaintOpportunity, which fires on a real inbound SMS.
    expect(service).toMatch(/reopenIfTerminal: true/);
    const reopen = service.match(/if \(input\.reopenIfTerminal[\s\S]*?\n    \}/)?.[0] ?? "";
    expect(reopen).toMatch(/SET state = 'new'/);
    // Only these three close-states reopen. Asserted on the allowlist itself so
    // adding a fourth is a deliberate edit here, not a silent widening.
    expect(reopen).toMatch(/\["lost", "duplicate", "dismissed"\]\.includes\(currentState\)/);
  });

  it("the reopen cannot lose a concurrent transition", () => {
    // Read-then-write, so the state guard must ALSO be in the WHERE clause —
    // a JS check alone would let a transition landing between the two
    // statements be overwritten. Losing the race means no reopen, which is safe.
    const reopen = service.match(/if \(input\.reopenIfTerminal[\s\S]*?\n    \}/)?.[0] ?? "";
    expect(reopen).toMatch(/WHERE id = \$\{row\.id\}\s*\n\s*AND state = \$\{currentState\}/);
  });

  it("uses the house receipts idiom, not a novel SQL one", () => {
    // transitionOpportunity builds receipts in JS and writes them whole; that
    // is proven against TiDB. An earlier draft appended SQL-side with
    // JSON_ARRAY_APPEND — used nowhere else here, unproven on TiDB, and in a
    // path whose only failure signal is a log line, so a silent no-op.
    //
    // Asserted POSITIVELY only. A whole-file `not.toMatch(/JSON_ARRAY_APPEND/)`
    // fails on the comment above explaining why the idiom was dropped — the
    // third time in this wave that a negative source assertion matched its own
    // documentation. Prose is not code; assert what the code DOES.
    const reopen = service.match(/if \(input\.reopenIfTerminal[\s\S]*?\n    \}/)?.[0] ?? "";
    expect(reopen).toMatch(/receipts_json = \$\{JSON\.stringify\(receipts\)\}/);
    expect(reopen).not.toMatch(/JSON_ARRAY_APPEND\(/); // the CALL, not the word
  });

  it("reopening never overrides consent — do_not_contact is not in the reopen set", () => {
    const reopen = service.match(/if \(input\.reopenIfTerminal[\s\S]*?\n    \}/)?.[0] ?? "";
    expect(reopen).not.toMatch(/do_not_contact/);
  });

  it("reopen is OFF by default, so standing-fact collectors cannot undo a dismissal", () => {
    // A collector that re-derives the same fact every run (a stale lead is still
    // stale) must not set this, or dismissal becomes a no-op.
    const occurrences = service.match(/reopenIfTerminal: true/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("4 · only the customer can close a customer-facing rail", () => {
  it("a customer's own SMS closes recovery", () => {
    expect(isCustomerClosedSignal("not_interested", "sms_reply")).toBe(true);
  });

  it("an operator ATTESTING what the customer said also closes it", () => {
    // Front desk hears this on the phone constantly. Recording it is legitimate
    // evidence — the endpoint now requires an explicit heardFrom attestation.
    expect(isCustomerClosedSignal("repaired_elsewhere", "operator_relayed")).toBe(true);
  });

  it("the retired hide-button source does NOT close it", () => {
    // Legacy rows written by the concern chips are indistinguishable from
    // genuine captures after the fact, so they no longer end a sequence.
    expect(isCustomerClosedSignal("not_interested", "operator")).toBe(false);
  });

  it("an unsourced concern does not close it", () => {
    expect(isCustomerClosedSignal("not_interested", null)).toBe(false);
    expect(isCustomerClosedSignal(null, "sms_reply")).toBe(false);
  });

  it("a routing signal is not a closing signal, whoever said it", () => {
    expect(isCustomerClosedSignal("price", "sms_reply")).toBe(false);
    for (const c of RECOVERY_CLOSED_SIGNALS) {
      expect(isCustomerClosedSignal(c, "sms_reply")).toBe(true);
    }
  });

  it("the legacy bare 'operator' source is deliberately absent from the allowlist", () => {
    expect(CUSTOMER_SOURCED_CONCERN).not.toContain("operator");
    expect(CUSTOMER_SOURCED_CONCERN).toContain("sms_reply");
    expect(CUSTOMER_SOURCED_CONCERN).toContain("operator_relayed");
  });

  it("recording a customer statement requires an explicit attestation", () => {
    // Structural, not advisory: `heardFrom: z.literal("customer")` means a
    // future 'hide this' feature cannot satisfy it with a default. This is what
    // made the old panel's call site a compile error.
    const router = read("server/routers/opportunityQueue.ts");
    expect(router).toMatch(/heardFrom: z\.literal\("customer"\)/);
    expect(router).toMatch(/statedConcernSource: "operator_relayed"/);
  });

  it("the recovery cron checks WHO said it, not only WHAT was said", () => {
    const cron = read("server/cron/jobs/declinedWorkRecovery.ts");
    expect(cron).toMatch(/isCustomerClosedSignal\(est\.statedConcern, est\.statedConcernSource\)/);
    // ...and the track routing is gated the same way, or an operator inference
    // sends the customer a message asserting they raised price.
    expect(cron).toMatch(/CUSTOMER_SOURCED_CONCERN\.includes\(est\.statedConcernSource \?\? ""\)/);
  });
});
