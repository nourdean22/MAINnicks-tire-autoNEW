/**
 * todayExceptionFeed.test.tsx · 2026-08-03
 *
 * Today's cross-domain exception strip, and the two false all-clears fixed
 * alongside it on the same screen.
 *
 * The screen already had an action queue, a Decision Inbox, a Promise Ledger
 * and a closed-loop panel — so the value of this strip is NOT another list of
 * work. It is the two things nothing on Today did:
 *   1. surface domains the action queue never reads (publishing holds, tire
 *      orders, membership warnings), and
 *   2. surface readings the system COULD NOT TAKE, ranked above readable ones,
 *      because an unreadable queue could be any size.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type AdminSignal, exceptionFeed } from "@shared/adminSignal";
import { buildAdminSignals } from "../lib/adminSignals";
import ExceptionFeed, { resolveFeedState } from "../pages/admin/today/ExceptionFeed";

afterEach(cleanup);

const OVERVIEW_SRC = readFileSync(join(process.cwd(), "client/src/pages/admin/OverviewSection.tsx"), "utf-8");
const PROMISES_SRC = readFileSync(join(process.cwd(), "client/src/pages/admin/PromisesPanel.tsx"), "utf-8");
const ADMIN_SRC = readFileSync(join(process.cwd(), "client/src/pages/Admin.tsx"), "utf-8");

const sig = (over: Partial<AdminSignal> & Pick<AdminSignal, "id" | "reading">): AdminSignal => ({
  section: "instagram",
  label: "things",
  severity: "info",
  source: "test.procedure",
  updatedAt: null,
  ...over,
});

const counted = (id: string, count: number, over: Partial<AdminSignal> = {}) =>
  sig({ id, reading: { state: "counted", count }, ...over });
const unknown = (id: string, reason = "db down", over: Partial<AdminSignal> = {}) =>
  sig({ id, reading: { state: "unknown", reason }, ...over });
const unmeasured = (id: string) => sig({ id, reading: { state: "not_measured", reason: "nothing wired" } });

// ───────────────────────────────────────────────────────────────────────
// The three empty states — an empty feed is NOT evidence of an all-clear
// ───────────────────────────────────────────────────────────────────────
describe("resolveFeedState · 'we looked' vs 'nobody reported'", () => {
  it("anything in the feed means exceptions", () => {
    const signals = [counted("a", 2)];
    expect(resolveFeedState(signals, exceptionFeed(signals))).toBe("exceptions");
  });

  it("all sources counted and all zero is a REAL all-clear", () => {
    const signals = [counted("a", 0), counted("b", 0)];
    expect(resolveFeedState(signals, exceptionFeed(signals))).toBe("nothing_outstanding");
  });

  it("nothing counted at all is NOT an all-clear", () => {
    // This is the case `return 0` used to hide: no source reported, and the
    // screen said everything was fine.
    const signals = [unmeasured("a"), unmeasured("b")];
    expect(resolveFeedState(signals, exceptionFeed(signals))).toBe("nothing_measured");
  });

  it("no signals at all is not an all-clear either", () => {
    expect(resolveFeedState([], [])).toBe("nothing_measured");
  });

  it("one reported source is NOT enough — every visible source must have reported", () => {
    // PR #1319 review, P2. A first draft used `.some(counted)`, so tire and
    // membership stats finishing before operationsSignal produced "Nothing
    // outstanding" while publishing had not been read at all.
    const signals = [counted("a", 0), unmeasured("b")];
    expect(resolveFeedState(signals, exceptionFeed(signals))).toBe("nothing_measured");
  });

  it("all visible sources counted zero IS the all-clear", () => {
    const signals = [counted("a", 0), counted("b", 0), counted("c", 0)];
    expect(resolveFeedState(signals, exceptionFeed(signals))).toBe("nothing_outstanding");
  });
});

// ───────────────────────────────────────────────────────────────────────
// Rendering
// ───────────────────────────────────────────────────────────────────────
describe("ExceptionFeed renders the distinction to the eye", () => {
  it("an unreadable signal shows '?' and its reason, not a number", () => {
    render(<ExceptionFeed signals={[unknown("ops", "operationsSignal could not be read")]} />);
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.getByText(/operationsSignal could not be read/)).toBeTruthy();
  });

  it("never prints 'clear' when nothing was measured", () => {
    render(<ExceptionFeed signals={[unmeasured("a")]} />);
    expect(screen.getByText(/not an all-clear/i)).toBeTruthy();
    expect(screen.queryByText(/nothing outstanding/i)).toBeNull();
  });

  it("says nothing outstanding only when something actually counted", () => {
    render(<ExceptionFeed signals={[counted("a", 0)]} />);
    expect(screen.getByText(/nothing outstanding/i)).toBeTruthy();
  });

  it("hides ids the action queue already renders, so Today does not repeat itself", () => {
    render(
      <ExceptionFeed
        signals={[counted("new-leads", 5, { label: "new leads" }), counted("ops", 2, { label: "publishing items held" })]}
        hideIds={["new-leads"]}
      />,
    );
    expect(screen.queryByText("new leads")).toBeNull();
    expect(screen.getByText("publishing items held")).toBeTruthy();
  });

  it("an unknown outranks a bigger readable count — it could be any size", () => {
    const { container } = render(
      <ExceptionFeed
        signals={[
          counted("big", 40, { label: "readable work", severity: "warning" }),
          unknown("dark", "timeout", { label: "unreadable work", severity: "warning" }),
        ]}
      />,
    );
    const rows = Array.from(container.querySelectorAll("li"));
    expect(rows[0].textContent).toContain("unreadable work");
  });
});

// ───────────────────────────────────────────────────────────────────────
// Anti-drift: the hide list must keep matching real signal ids
// ───────────────────────────────────────────────────────────────────────
describe("the hide list cannot silently swallow a signal", () => {
  const producedIds = buildAdminSignals({
    bundleFailed: false,
    slices: {
      stats: { available: true, error: null },
      bookings: { available: true, error: null },
      leads: { available: true, error: null },
      callbacks: { available: true, error: null },
      health: { available: true, error: null },
    },
    counts: { newBookings: 1, newLeads: 1, urgentLeads: 0, actionableLeads: 1, pendingCallbacks: 1, total: 3 },
    stats: { tires: { new: 1 }, memberships: { warning: 1 } },
    opsFailed: false,
    opsUnknown: false,
    opsTotal: 1,
    // 1, not 0: this list is an anti-drift check on the PRODUCED signal ids, and
    // a healthy provider still produces its signal (with count 0) — but keeping a
    // real problem here makes the intent obvious if the encoding ever flips.
    opsVideoProviderBlocked: 1,
  }).map((s) => s.id);

  const hiddenIdsFromSource = (constName: string) => {
    const list = OVERVIEW_SRC.match(new RegExp(`${constName} = \\[([^\\]]+)\\]`))?.[1] ?? "";
    return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };

  it.each(["QUEUE_COVERED_SIGNAL_IDS", "DUPLICATE_ALIAS_SIGNAL_IDS"])(
    "every id in %s is a signal that actually exists",
    (constName) => {
      // A rename would otherwise leave a dead entry here AND make the renamed
      // signal appear on Today unfiltered.
      const ids = hiddenIdsFromSource(constName);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(producedIds, `hidden id "${id}" no longer exists`).toContain(id);
    },
  );

  it("the duplicate publishing alias is hidden, but the Today one is kept", () => {
    // buildAdminSignals emits the SAME publishing reading twice so the sidebar
    // can badge Today and Instagram from one source. Printing both here would
    // show one problem as two — the inflation operationsSignal already
    // de-overlaps for on the server.
    expect(hiddenIdsFromSource("DUPLICATE_ALIAS_SIGNAL_IDS")).toContain("ops-instagram");
    expect(hiddenIdsFromSource("QUEUE_COVERED_SIGNAL_IDS")).not.toContain("ops-overview");
    expect(OVERVIEW_SRC).toMatch(/hideIds=\{\[\.\.\.QUEUE_COVERED_SIGNAL_IDS, \.\.\.DUPLICATE_ALIAS_SIGNAL_IDS\]\}/);
  });

  it("the feed renders publishing once, not twice", () => {
    const both = [
      counted("ops-overview", 3, { label: "publishing items held" }),
      counted("ops-instagram", 3, { label: "publishing items held" }),
    ];
    render(<ExceptionFeed signals={both} hideIds={["ops-instagram"]} />);
    expect(screen.getAllByText("publishing items held")).toHaveLength(1);
  });

  it("the publishing signal is NOT hidden — the queue does not cover it", () => {
    // ops-overview shares the "overview" section with the queue's signals but
    // the queue reads bookings/leads/callbacks/work-orders and knows nothing
    // about publishing. Excluding by SECTION would have swallowed it.
    const hideList = OVERVIEW_SRC.match(/QUEUE_COVERED_SIGNAL_IDS = \[([^\]]+)\]/)?.[1] ?? "";
    expect(hideList).not.toContain("ops-overview");
    expect(producedIds).toContain("ops-overview");
  });
});

// ───────────────────────────────────────────────────────────────────────
// The two false all-clears fixed on this screen
// ───────────────────────────────────────────────────────────────────────
describe("Today's own trust holes", () => {
  /**
   * Work orders are a SEPARATE query from the bundle, so `unavailableSlices`
   * cannot see them. When it failed, the queue silently dropped every work
   * order while queueTrustworthy still reported true — and work orders carry
   * urgency 5 when overdue or blocked, so the highest-priority items were
   * exactly the ones that vanished.
   */
  it("a failed work-order query vetoes 'All clear'", () => {
    expect(OVERVIEW_SRC).toMatch(/isError: workOrdersFailed/);
    expect(OVERVIEW_SRC).toMatch(/queueTrustworthy\s*=\s*\n?\s*!workOrdersFailed/);
  });

  it("a capped work-order page reports a lower bound, not a precise count", () => {
    expect(OVERVIEW_SRC).toMatch(/queueSaturated/);
    expect(OVERVIEW_SRC).toMatch(/\$\{queue\.length\}\+/);
  });

  /**
   * PromisesPanel's empty branch tests `!open || open.length === 0`, and a
   * failed query leaves `open` undefined — so a dead read rendered "No open
   * promises." about the ledger tracking every "we'll call you back".
   */
  it("PromisesPanel distinguishes a failed read from an empty ledger", () => {
    expect(PROMISES_SRC).toMatch(/isError/);
    expect(PROMISES_SRC).toMatch(/UNKNOWN, not zero/);
    // Anchor on strings that exist ONLY in the JSX. "No open promises" also
    // appears in the docblock explaining the bug, which is earlier in the file
    // and made a first draft of this test fail against correct code.
    const errBranch = PROMISES_SRC.indexOf("isError ? (");
    const emptyBranch = PROMISES_SRC.indexOf("!open || open.length === 0 ? (");
    expect(errBranch).toBeGreaterThan(-1);
    expect(emptyBranch).toBeGreaterThan(-1);
    // The error branch must be tested BEFORE the empty branch, or undefined
    // data falls into "No open promises" first and the fix never fires.
    expect(errBranch).toBeLessThan(emptyBranch);
  });

  it("Today's ops query matches the shell's options, so it shares the cache", () => {
    // A shorter staleTime here would double the poll rate on a procedure the
    // sidebar already runs on every page load.
    for (const src of [OVERVIEW_SRC, ADMIN_SRC]) {
      const at = src.indexOf("contentAdmin.operationsSignal.useQuery");
      expect(at).toBeGreaterThan(-1);
      const opts = src.slice(at, at + 260);
      expect(opts).toContain("staleTime: 90_000");
      expect(opts).toContain("refetchInterval: 120_000");
    }
  });
});
