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
import { render, screen, cleanup } from "@testing-library/react";

type QueryResult = { data: unknown; isLoading: boolean; isError: boolean; error: unknown };

const h = vi.hoisted(() => ({
  candidates: { data: undefined, isLoading: false, isError: false, error: null } as QueryResult,
  referrals: { data: undefined, isLoading: false, isError: false, error: null } as QueryResult,
  // Defaults to an available, empty result so the SLA banner stays out of the
  // way of the outage assertions; the tests that care set it explicitly.
  slaBreaches: { data: { available: true, rows: [] }, isLoading: false, isError: false, error: null } as QueryResult,
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
        candidates: { list: { invalidate: () => {} }, slaBreaches: { invalidate: () => {} } },
        technicianReferrals: { list: { invalidate: () => {} } },
      }),
      candidates: {
        list: { useQuery: () => h.candidates },
        slaBreaches: { useQuery: () => h.slaBreaches },
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
        disqualify: { useMutation: stub },
        markForfeited: { useMutation: stub },
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
