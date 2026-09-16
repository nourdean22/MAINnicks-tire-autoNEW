/**
 * The stored due time must be the one true AT THE CLICK, not at mount.
 *
 * Why this file exists. The first version of the business-calendar due-time fix
 * resolved the pick in a `useMemo` keyed only on `form.duePick`. That computes
 * once when PromisesPanel mounts — with the default `in_2h` — and reuses that
 * instant at submission. Two real consequences a reviewer caught:
 *
 *   1. A dashboard left open an hour stores "In 2h" as ONE hour away.
 *   2. A form open across 6 PM keeps storing "today at close" after the honest
 *      answer has become tomorrow.
 *
 * Both are the same defect as the bug the fix was for — a due time that does
 * not mean what it says — so they get a pin rather than a comment. The panel
 * now re-resolves inside the submit handler; these assert that, by moving the
 * clock AFTER the form is open and BEFORE the click.
 *
 * Sept 2026 is EDT (UTC-4); canon is Mon-Sat 08:00-18:00, Sun 09:00-16:00.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/trpc", () => {
  const listOpen = { data: [], isLoading: false, isError: false };
  return {
    trpc: {
      useUtils: () => ({ promises: { listOpen: { invalidate: () => {} } } }),
      promises: {
        listOpen: { useQuery: () => listOpen },
        create: {
          useMutation: () => ({
            mutate: (input: Record<string, unknown>) => h.created.push(input),
            isPending: false,
          }),
        },
        keep: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
        cancel: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      },
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: () => Promise.resolve(false) }));

import PromisesPanel from "@/pages/admin/PromisesPanel";

/** Open the create form and type a promise long enough to enable "Log it". */
function openFormAndType() {
  fireEvent.click(screen.getByText("Log a promise"));
  fireEvent.change(screen.getByPlaceholderText(/Exactly what was promised/i), {
    target: { value: "text when the Camry is ready" },
  });
}

describe("PromisesPanel — the stored due time is resolved at submit", () => {
  beforeEach(() => {
    h.created.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("in_2h is two hours from the CLICK, not from mount", () => {
    vi.setSystemTime(new Date("2026-09-14T13:00:00Z")); // Mon 09:00 ET
    render(<PromisesPanel />);
    openFormAndType();

    // The operator gets distracted for 90 minutes with the form open.
    vi.setSystemTime(new Date("2026-09-14T14:30:00Z")); // Mon 10:30 ET
    fireEvent.click(screen.getByText("Log it"));

    expect(h.created).toHaveLength(1);
    // 10:30 ET + 2h = 12:30 ET = 16:30Z. Resolving at mount would have stored
    // 11:00 ET (15:00Z) — only 30 minutes away by the time it was logged.
    expect(h.created[0].dueAtISO).toBe("2026-09-14T16:30:00.000Z");
  });

  it("end_of_day crossing closing time rolls to the next day that shuts", () => {
    vi.setSystemTime(new Date("2026-09-14T21:00:00Z")); // Mon 17:00 ET, still open
    render(<PromisesPanel />);
    openFormAndType();
    fireEvent.click(screen.getByText("End of day"));

    // The form sits open past 6 PM.
    vi.setSystemTime(new Date("2026-09-14T22:30:00Z")); // Mon 18:30 ET, shut
    fireEvent.click(screen.getByText("Log it"));

    expect(h.created).toHaveLength(1);
    // Tue 18:00 ET. Resolving when the pick was chosen would have stored
    // Monday's already-passed 18:00 ET (2026-09-14T22:00:00.000Z) — a promise
    // born overdue.
    expect(h.created[0].dueAtISO).toBe("2026-09-15T22:00:00.000Z");
  });

  it("next_open crossing a day boundary resolves against the new day", () => {
    vi.setSystemTime(new Date("2026-09-12T21:00:00Z")); // Sat 17:00 ET
    render(<PromisesPanel />);
    openFormAndType();
    fireEvent.click(screen.getByText("Tomorrow"));

    // Still open when Sunday arrives in Cleveland.
    vi.setSystemTime(new Date("2026-09-13T14:00:00Z")); // Sun 10:00 ET
    fireEvent.click(screen.getByText("Log it"));

    // From Sunday, the next opening is Monday 08:00 ET = 12:00Z. Resolving on
    // Saturday would have stored Sunday 09:00 ET, already in the past.
    expect(h.created[0].dueAtISO).toBe("2026-09-14T12:00:00.000Z");
  });

  it("the DISPLAYED line re-resolves while the form sits open, so it cannot drift from what gets stored", async () => {
    /**
     * Fixing only the submit path would have left the old bug visible in a new
     * place: the line under the picker would keep saying "today at close" after
     * the honest answer became tomorrow, and the operator would read one thing
     * while a different instant was written. The 30s ticker is what closes
     * that gap, and without this test nothing would notice if it stopped.
     */
    vi.setSystemTime(new Date("2026-09-14T21:59:00Z")); // Mon 17:59 ET, still open
    render(<PromisesPanel />);
    openFormAndType();
    fireEvent.click(screen.getByText("End of day"));

    expect(screen.getByText(/Comes due today at close · 6 PM/)).toBeTruthy();

    // Sit on the open form across 6 PM. The interval runs every 30s.
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });

    // Monday's close has passed, so "End of day" now honestly means Tuesday.
    expect(screen.getByText(/Comes due Tue at close · 6 PM/)).toBeTruthy();
    expect(screen.queryByText(/Comes due today at close/)).toBeNull();

    // And the stored value agrees with the line that is on screen.
    fireEvent.click(screen.getByText("Log it"));
    expect(h.created[0].dueAtISO).toBe("2026-09-15T22:00:00.000Z"); // Tue 18:00 ET
  });

  it("the resolved line the operator reads names the same day the value lands on", () => {
    vi.setSystemTime(new Date("2026-09-14T13:00:00Z")); // Mon 09:00 ET
    render(<PromisesPanel />);
    openFormAndType();
    fireEvent.click(screen.getByText("End of day"));

    expect(screen.getByText(/Comes due today at close · 6 PM/)).toBeTruthy();

    fireEvent.click(screen.getByText("Log it"));
    expect(h.created[0].dueAtISO).toBe("2026-09-14T22:00:00.000Z"); // Mon 18:00 ET
  });
});
