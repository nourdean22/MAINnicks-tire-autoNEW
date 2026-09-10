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
}));

// vi.mock is hoisted above every top-level const, so the mutation stub is
// inlined rather than referenced — a shared `noopMutation` binding here throws
// "Cannot access 'noopMutation' before initialization" at import time.
vi.mock("@/lib/trpc", () => {
  const stub = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      useUtils: () => ({
        candidates: { list: { invalidate: () => {} } },
        technicianReferrals: { list: { invalidate: () => {} } },
      }),
      candidates: {
        list: { useQuery: () => h.candidates },
        updateStatus: { useMutation: stub },
      },
      technicianReferrals: {
        list: { useQuery: () => h.referrals },
        markHired: { useMutation: stub },
        markPaid: { useMutation: stub },
        disqualify: { useMutation: stub },
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
