/**
 * A read that could not run must not PAINT as "none yet".
 *
 * server/adminReadsDontFabricateZero.test.ts proves the two halves separately:
 * that getCandidates()/getTechnicianReferrals() report `available: false` when
 * getDb() returns null, and that both panel FILES contain an
 * `available === false` branch ahead of their empty state. Neither of those is
 * a render. A branch can be present in the source, correctly ordered, typecheck
 * clean, and still never paint — a wrong truthiness test, a sibling branch
 * shadowing it, a crash inside the block. That is the gap this file closes: it
 * mounts the real components and asserts what the operator's screen says.
 *
 * WHY IT IS NOT AN END-TO-END BROWSER CHECK. Reaching these panels in a browser
 * needs an admin session, and an admin session needs the database — the exact
 * thing the scenario under test removes. The outage state is therefore
 * unreachable through the admin UI by construction, and jsdom is the honest
 * instrument for it. (Separately, this harness worktree carries no .env at all,
 * so its dev server cannot boot: it exits with "FATAL: Missing required env
 * vars: DATABASE_URL, JWT_SECRET, OWNER_OPEN_ID, ADMIN_API_KEY,
 * STATENOUR_SYNC_KEY".)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

type QueryResult = { data: unknown; isLoading: boolean; isError: boolean; error: unknown };

const h = vi.hoisted(() => ({
  candidates: { data: undefined, isLoading: false, isError: false, error: null } as QueryResult,
  referrals: { data: undefined, isLoading: false, isError: false, error: null } as QueryResult,
  // Defaults to an available, empty result so the SLA banner stays out of the
  // way of the outage assertions; the tests that care set it explicitly.
  slaBreaches: { data: { available: true, rows: [] }, isLoading: false, isError: false, error: null } as QueryResult,
  history: { data: { available: true, rows: [] }, isLoading: false, isError: false, error: null } as QueryResult,
  followUpsDue: { data: { available: true, reason: null, rows: [] }, isLoading: false, isError: false, error: null } as QueryResult,
  disqualifyCalls: [] as Array<{ id: number; reason: string }>,
}));

// vi.mock is hoisted above every top-level const, so the mutation stub is
// inlined rather than referenced — a shared `noopMutation` binding here throws
// "Cannot access 'noopMutation' before initialization" at import time.
vi.mock("@/lib/trpc", () => {
  const stub = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      // This mock is a hand-rolled SECOND REGISTRY of the procedures these
      // panels call, and it drifts silently: a panel that reaches for a
      // procedure absent here reads `undefined.useMutation` and every test in
      // the file dies at render with an error that names the mutation's
      // onError line, not the missing key. Add the entry whenever a panel
      // gains a call.
      useUtils: () => ({
        candidates: { list: { invalidate: () => {} }, slaBreaches: { invalidate: () => {} }, followUpsDue: { invalidate: () => {} } },
        technicianReferrals: { list: { invalidate: () => {} } },
      }),
      candidates: {
        list: { useQuery: () => h.candidates },
        slaBreaches: { useQuery: () => h.slaBreaches },
        followUpsDue: { useQuery: () => h.followUpsDue },
        updateStatus: { useMutation: stub },
      },
      technicianReferrals: {
        list: { useQuery: () => h.referrals },
        // Reconciliation exceptions. Defaults to an empty, available result so
        // these tests assert the OUTAGE branches without the orphan banner
        // interfering; its own behaviour is covered separately.
        orphans: { useQuery: () => ({ data: { available: true, rows: [] } }) },
        markHired: { useMutation: stub },
        markPaid: { useMutation: stub },
        disqualify: {
          useMutation: () => ({
            mutate: (v: { id: number; reason: string }) => h.disqualifyCalls.push(v),
            isPending: false,
          }),
        },
        markForfeited: { useMutation: stub },
        // Per-row audit history. Its query is `enabled` only once a row is
        // expanded, so it never fires in these tests - but the panel still
        // READS trpc.technicianReferrals.history.useQuery at render, and a
        // missing key here is `undefined.useQuery`, which kills every test in
        // the file with an error naming an unrelated line.
        history: { useQuery: () => h.history },
      },
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { CandidatesPanel } from "../pages/admin/leads/CandidatesPanel";
import { TechnicianReferralsPanel } from "../pages/admin/leads/TechnicianReferralsPanel";

const ok = (rows: unknown[]) => ({ available: true, migrationPending: false, rows });
const down = () => ({ available: false, migrationPending: false, rows: [] });

afterEach(cleanup);
beforeEach(() => {
  h.candidates = { data: undefined, isLoading: false, isError: false, error: null };
  h.referrals = { data: undefined, isLoading: false, isError: false, error: null };
  h.slaBreaches = { data: { available: true, rows: [] }, isLoading: false, isError: false, error: null };
  h.history = { data: { available: true, rows: [] }, isLoading: false, isError: false, error: null };
  h.followUpsDue = { data: { available: true, reason: null, rows: [] }, isLoading: false, isError: false, error: null };
  h.disqualifyCalls = [];
});

describe("CandidatesPanel", () => {
  it("paints the outage state, NOT the empty state, when available is false", () => {
    h.candidates = { data: down(), isLoading: false, isError: false, error: null };
    render(<CandidatesPanel />);

    expect(screen.getByText(/Database unavailable/i)).toBeTruthy();
    // The whole point: the operator must NOT be told nobody applied.
    expect(screen.queryByText(/No candidates yet/i)).toBeNull();
  });

  it("paints the read-failure state when the query errors", () => {
    // This branch did not exist at all before 2026-09-10 — the panel
    // destructured only { data, isLoading }, so a failed query rendered
    // "No candidates yet." Its sibling had branched on this for longer.
    h.candidates = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: "UNAUTHORIZED" },
    };
    render(<CandidatesPanel />);

    expect(screen.getByText(/Couldn't load candidates/i)).toBeTruthy();
    expect(screen.getByText(/UNAUTHORIZED/)).toBeTruthy();
    expect(screen.queryByText(/No candidates yet/i)).toBeNull();
  });

  it("still paints the empty state when the read genuinely succeeded and found nothing", () => {
    // The positive control. Without this, a panel that rendered the outage
    // banner unconditionally would pass both tests above and be badly broken.
    h.candidates = { data: ok([]), isLoading: false, isError: false, error: null };
    render(<CandidatesPanel />);

    expect(screen.getByText(/No candidates yet/i)).toBeTruthy();
    expect(screen.queryByText(/Database unavailable/i)).toBeNull();
  });
});

describe("TechnicianReferralsPanel", () => {
  it("paints the outage state, NOT the empty state, when available is false", () => {
    h.referrals = { data: down(), isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);

    expect(screen.getByText(/Database unavailable/i)).toBeTruthy();
    // $300 per referral rides on this not reading as "nobody referred anyone".
    expect(screen.queryByText(/No technician referrals recorded yet/i)).toBeNull();
  });

  it("still paints the empty state when the read genuinely succeeded and found nothing", () => {
    h.referrals = { data: ok([]), isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);

    expect(screen.getByText(/No technician referrals recorded yet/i)).toBeTruthy();
    expect(screen.queryByText(/Database unavailable/i)).toBeNull();
  });
});

/**
 * The 48-hour careers promise, on screen. server/candidateSla.test.ts asserts
 * the query is not gated on `open` and that the header references the count —
 * both source assertions, which pass for markup that never paints. This mounts
 * it.
 */
describe("CandidatesPanel · the SLA alarm actually paints", () => {
  const waiting = (rows: unknown[]) => ({ available: true, rows });

  it("shows the waiting count", () => {
    h.candidates = { data: ok([]), isLoading: false, isError: false, error: null };
    h.slaBreaches = {
      data: waiting([{ id: 1, name: "Dana Reyes", createdAt: null, hoursWaiting: 51, band: "breached" }]),
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<CandidatesPanel />);

    expect(screen.getByText(/1 awaiting reply/i)).toBeTruthy();
    expect(screen.getByText(/still\s+waiting on a first reply/i)).toBeTruthy();
    expect(screen.getByText(/51h/)).toBeTruthy();
  });

  it("says the age is unknown rather than printing a fabricated number", () => {
    h.candidates = { data: ok([]), isLoading: false, isError: false, error: null };
    h.slaBreaches = {
      data: waiting([{ id: 2, name: "Sam Okafor", createdAt: null, hoursWaiting: null, band: "breached" }]),
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<CandidatesPanel />);

    // `Number(null)` is 0, so the naive version rendered "0h" — a confident,
    // wrong, and maximally reassuring number for the row we know least about.
    expect(screen.getByText(/age unknown/i)).toBeTruthy();
    expect(screen.queryByText(/^0h$/)).toBeNull();
  });

  it("paints SLA UNKNOWN when the breach read itself failed", () => {
    h.candidates = { data: ok([]), isLoading: false, isError: false, error: null };
    h.slaBreaches = { data: { available: false, rows: [] }, isLoading: false, isError: false, error: null };
    render(<CandidatesPanel />);

    // Silence here is indistinguishable from "nobody is waiting" — the exact
    // fabricated zero the rest of this file exists to catch.
    expect(screen.getByText(/SLA unknown/i)).toBeTruthy();
  });

  it("stays quiet when nobody is actually waiting — the positive control", () => {
    // Without this, a badge hardcoded to render would satisfy every assertion
    // above and alarm permanently, which trains the operator to ignore it.
    h.candidates = { data: ok([]), isLoading: false, isError: false, error: null };
    h.slaBreaches = { data: waiting([]), isLoading: false, isError: false, error: null };
    render(<CandidatesPanel />);

    expect(screen.queryByText(/awaiting reply/i)).toBeNull();
    expect(screen.queryByText(/SLA unknown/i)).toBeNull();
    expect(screen.queryByText(/waiting on a first reply/i)).toBeNull();
  });
});

/**
 * WHY, not just who and when.
 *
 * The first cut of this history list rendered action + actor + timestamp and
 * dropped `changes` on the floor - so the single most useful field in a
 * contested $300, the RECORDED REASON, was the one thing it did not show.
 */
describe("TechnicianReferralsPanel - referral history shows the reason", () => {
  const oneReferral = () =>
    ok([
      {
        id: 7,
        status: "disqualified",
        referrerName: "Pat Lang",
        referrerPhone: null,
        candidateName: "Alex Kim",
        candidatePhone: null,
        positionTitle: null,
        bonusAmountCents: 30000,
        hiredAt: null,
        eligibleAt: null,
        paidAt: null,
        createdAt: new Date("2026-08-01").toISOString(),
        unlinked: false,
      },
    ]);

  it("renders the recorded reason, not just the actor and timestamp", () => {
    h.referrals = { data: oneReferral(), isLoading: false, isError: false, error: null };
    h.history = {
      data: {
        available: true,
        rows: [
          {
            id: "a1",
            actor: "nick@nickstire.org",
            action: "technician_referral.disqualified",
            changes: { detail: { old: null, new: "Referral #7 disqualified: referrer was the applicant" } },
            createdAt: new Date("2026-09-01T15:04:00Z").toISOString(),
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<TechnicianReferralsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));

    expect(screen.getByText(/nick@nickstire\.org/)).toBeTruthy();
    expect(screen.getByText(/referrer was the applicant/)).toBeTruthy();
  });

  it("a failed audit read is not an empty history", () => {
    h.referrals = { data: oneReferral(), isLoading: false, isError: false, error: null };
    h.history = { data: { available: false, rows: [] }, isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));

    // "Nobody touched this record" is the most exonerating thing an audit
    // trail can say, so a read that did not run must never be able to say it.
    expect(screen.getByText(/Couldn.t read the audit trail/i)).toBeTruthy();
    expect(screen.queryByText(/No recorded actions yet/i)).toBeNull();
  });

  it("still says so when there genuinely is no history - the positive control", () => {
    // Without this, a panel that rendered the failure banner unconditionally
    // would satisfy the test above and be badly broken.
    h.referrals = { data: oneReferral(), isLoading: false, isError: false, error: null };
    h.history = { data: { available: true, rows: [] }, isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));

    expect(screen.getByText(/No recorded actions yet/i)).toBeTruthy();
    expect(screen.queryByText(/Couldn.t read the audit trail/i)).toBeNull();
  });
});

/**
 * The reason a $300 refusal records is CAPTURED, and no native primitive is used.
 *
 * iOS PWA standalone silently suppresses window.prompt/alert/confirm - they
 * return null with no UI - which is the most-recurring bug class in this
 * codebase (5+ waves). Disqualify and Forfeit used to send a CANNED string, so
 * the audit row answered who and when and restated the question; the fix must
 * not trade that for a primitive that does nothing on the operator's phone.
 */
describe("TechnicianReferralsPanel - refusal reasons are captured, not templated", () => {
  const eligibleRow = () =>
    ok([
      {
        id: 9,
        status: "eligible",
        referrerName: "Pat Lang",
        referrerPhone: null,
        candidateName: "Alex Kim",
        candidatePhone: null,
        positionTitle: null,
        bonusAmountCents: 30000,
        hiredAt: new Date("2026-07-01").toISOString(),
        // Clock still running, so Forfeit is offered.
        eligibleAt: new Date(Date.now() + 30 * 864e5).toISOString(),
        paidAt: null,
        createdAt: new Date("2026-07-01").toISOString(),
        unlinked: false,
      },
    ]);

  it("never calls window.prompt - it expands an in-DOM chip list", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    h.referrals = { data: eligibleRow(), isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /disqualify/i }));

    expect(promptSpy, "window.prompt is suppressed in iOS PWA standalone").not.toHaveBeenCalled();
    expect(screen.getByText(/WHY IS THE CLAIM INVALID/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Self-referral$/ })).toBeTruthy();
    promptSpy.mockRestore();
  });

  it("forfeit offers its OWN vocabulary, not the disqualify one", () => {
    // The whole point of two terminal states is that they answer different
    // questions. One shared reason list would collapse that back.
    h.referrals = { data: eligibleRow(), isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /forfeit/i }));

    expect(screen.getByText(/WHY IS NO BONUS OWED/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Quit before 90 days$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Self-referral$/ })).toBeNull();
  });

  it("the chosen reason reaches the mutation, with the linkage fact kept", () => {
    // The old canned string carried exactly two facts - whether the referral was
    // linked to a candidate, and who it named. Keeping them means this strictly
    // ADDS information rather than trading one thin record for another.
    h.referrals = { data: eligibleRow(), isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /disqualify/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Self-referral$/ }));

    expect(h.disqualifyCalls.length).toBe(1);
    expect(h.disqualifyCalls[0].id).toBe(9);
    expect(h.disqualifyCalls[0].reason).toContain("Self-referral");
    expect(h.disqualifyCalls[0].reason).toContain("Alex Kim");
  });

  it("collapsed by default - the list is not open until asked", () => {
    // The positive control. Without it, a component that rendered its chips
    // unconditionally would satisfy every assertion above.
    h.referrals = { data: eligibleRow(), isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);

    expect(screen.queryByText(/WHY IS THE CLAIM INVALID/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Self-referral$/ })).toBeNull();
  });
});

/**
 * Every control that COMMITS a $300 refusal is thumb-sized.
 *
 * The admin runs as an installed iOS PWA - a phone - and this app documents a
 * 48x48px minimum touch target. The chip list inherited px-2 py-1 sizing from
 * LostReasonButton and rendered ~24px tall, half that, with adjacent chips a
 * thumb-width apart. A mis-tap does not merely annoy: it records the WRONG
 * REASON against a contested payout, asserting something false where the old
 * canned string merely said nothing. Nothing enforces the 48px rule, so this
 * does.
 */
describe("TechnicianReferralsPanel - the reason chips are actually tappable", () => {
  const eligibleRow = () =>
    ok([
      {
        id: 11,
        status: "eligible",
        referrerName: "Pat Lang",
        referrerPhone: null,
        candidateName: "Alex Kim",
        candidatePhone: null,
        positionTitle: null,
        bonusAmountCents: 30000,
        hiredAt: new Date("2026-07-01").toISOString(),
        eligibleAt: new Date(Date.now() + 30 * 864e5).toISOString(),
        paidAt: null,
        createdAt: new Date("2026-07-01").toISOString(),
        unlinked: false,
      },
    ]);

  it("every committing chip carries the 48px minimum, and so does cancel", () => {
    h.referrals = { data: eligibleRow(), isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /disqualify/i }));

    const chips = ["Self-referral", "Referrer not an employee", "Duplicate claim", "Other"];
    for (const label of chips) {
      const el = screen.getByRole("button", { name: new RegExp(`^${label}$`) });
      expect(el.className, `${label} chip is below the 48px touch minimum`).toContain("min-h-[48px]");
      expect(el.className, `${label} chip is below the 48px touch minimum`).toContain("min-w-[48px]");
    }
    // The thumb that misses cancel lands on a chip, and the chip commits.
    const cancel = screen.getByRole("button", { name: /cancel/i });
    expect(cancel.className).toContain("min-h-[48px]");
    expect(cancel.className).toContain("min-w-[48px]");
  });

  it("the forfeit list is held to the same minimum", () => {
    // Asserting only the disqualify list would leave the sibling free to drift -
    // they are separate JSX branches sharing one className expression today, and
    // nothing guarantees they stay shared.
    h.referrals = { data: eligibleRow(), isLoading: false, isError: false, error: null };
    render(<TechnicianReferralsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /forfeit/i }));

    const el = screen.getByRole("button", { name: /^Quit before 90 days$/ });
    expect(el.className).toContain("min-h-[48px]");
  });
});

describe("CandidatesPanel · follow-ups due actually paint (nextFollowUpAt consumer)", () => {
  const due = (rows: unknown[]) => ({ available: true, reason: null, rows });

  it("shows a due talent-network tech with the discreet-contact instruction and a snooze", () => {
    h.candidates = { data: ok([]), isLoading: false, isError: false, error: null };
    h.followUpsDue = {
      data: due([{ id: 4, name: "Lee Park", phone: "2165550199", status: "talent_network", intent: "confidential", positionTitle: "Automotive Technician", daysOverdue: 3 }]),
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<CandidatesPanel />);

    expect(screen.getByText(/1 follow-up due/i)).toBeTruthy();
    expect(screen.getByText(/due a check-in/i)).toBeTruthy();
    expect(screen.getByText(/3d overdue/)).toBeTruthy();
    expect(screen.getByText(/contact DISCREETLY/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Snooze 30d/ }).className).toContain("min-h-[48px]");
  });

  it("stays quiet when nobody is due — the positive control", () => {
    h.candidates = { data: ok([]), isLoading: false, isError: false, error: null };
    h.followUpsDue = { data: due([]), isLoading: false, isError: false, error: null };
    render(<CandidatesPanel />);
    expect(screen.queryByText(/follow-up(s)? due/i)).toBeNull();
  });

  it("says follow-ups need 0129 instead of implying nobody is due when the column is missing", () => {
    h.candidates = { data: ok([]), isLoading: false, isError: false, error: null };
    h.followUpsDue = { data: { available: false, reason: "migration_0129_pending", rows: [] }, isLoading: false, isError: false, error: null };
    render(<CandidatesPanel />);
    expect(screen.getByText(/Follow-up dates need drizzle\/0129/)).toBeTruthy();
  });
});
