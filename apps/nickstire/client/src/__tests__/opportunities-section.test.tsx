/**
 * OpportunitiesSection, RENDERED.
 *
 * Two jobs in one file.
 *
 * 1. The honest states (unchanged contract). An unreadable queue renders as
 *    UNKNOWN and must NOT also print "genuinely clear"; a source assertion can
 *    see that each branch exists, only a render can see they are mutually
 *    exclusive. A paused query (offline PWA) has no data and no error: it is a
 *    state too, and it is not an empty list.
 *
 * 2. The working path (2026-10-23, job admin-opportunities-path). 0 of 1,621
 *    opportunities were ever attempted because the only button dismissed the
 *    row. The row now has three verbs on the existing transition mutation:
 *    Called and Texted record an attempt, Not a customer hides the row after a
 *    confirm. The mutation REPORTS a refusal as `{ ok: false, error }` in a
 *    successful response, so a failure test that only throws would miss it.
 *
 * Mutation fake: runs the real hook options (onMutate, onSuccess, onError,
 * onSettled) in the order TanStack does, against a tiny external store, so the
 * optimistic write and the rollback are both visible in the DOM.
 *
 * NOT A VISUAL REVIEW. Composition and copy are asserted, not spacing; the
 * authenticated admin cannot be rendered outside a signed-in browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import React, { useSyncExternalStore } from "react";
import {
  OPPORTUNITY_STATES,
  TERMINAL_STATES,
  canTransition,
} from "../../../server/services/opportunityQueue";

type Respond = (vars: Record<string, unknown>) => Promise<unknown>;

const h = vi.hoisted(() => {
  const store = {
    data: undefined as unknown,
    listeners: new Set<() => void>(),
    set(next: unknown) {
      store.data = next;
      store.listeners.forEach((l) => l());
    },
  };
  return {
    store,
    flags: { isLoading: false, isError: false, isFetching: false },
    queryInputs: [] as unknown[],
    mutate: vi.fn(),
    invalidate: vi.fn(),
    refetch: vi.fn(),
    toastError: vi.fn(),
    confirm: vi.fn(async () => true),
    respond: (async () => ({ ok: true })) as Respond,
    mutationOpts: null as Record<string, unknown> | null,
  };
});

// The vi.mock registry is shared by every file in the serial run (apps/nickstire/AGENTS.md, Test
// hygiene), so each mock here keeps the REAL module and replaces only what this file fakes, and the
// afterAll at the bottom drops them. A bare { toast } would leave a later file without sonner's
// Toaster (components/ui/sonner.tsx re-exports it); a bare { trpc: {...} } without the client factory.
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { error: h.toastError, success: vi.fn(), message: vi.fn() },
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirm, default: () => null }));

vi.mock("@/lib/trpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trpc")>();
  /** The real object with the fake's keys laid over it, recursively: siblings stay real. */
  const deepOverlay = (real: object, fake: Record<string, unknown>): object =>
    new Proxy(real, {
      get(target, prop) {
        if (typeof prop === "string" && prop in fake) {
          const f = fake[prop];
          return f !== null && typeof f === "object" ? deepOverlay(Reflect.get(target, prop) as object, f as Record<string, unknown>) : f;
        }
        return Reflect.get(target, prop);
      },
    });
  const fake = {
    useUtils: () => ({
      opportunityQueue: {
        list: {
          invalidate: h.invalidate,
          cancel: async () => {},
          getData: () => h.store.data,
          setData: (_input: unknown, updater: (old: unknown) => unknown) => h.store.set(updater(h.store.data)),
        },
      },
    }),
    opportunityQueue: {
      list: {
        useQuery: (input: unknown) => {
          h.queryInputs.push(input);
          const data = useSyncExternalStore(
            (cb) => {
              h.store.listeners.add(cb);
              return () => h.store.listeners.delete(cb);
            },
            () => h.store.data,
          );
          return { data, ...h.flags, refetch: h.refetch };
        },
      },
      transition: {
        useMutation: (opts: {
          onMutate?: (v: unknown) => unknown;
          onSuccess?: (r: unknown, v: unknown, c: unknown) => unknown;
          onError?: (e: unknown, v: unknown, c: unknown) => unknown;
          onSettled?: (r: unknown, e: unknown, v: unknown, c: unknown) => unknown;
        }) => ({
          // The same options object TanStack receives, so a test can read what it is told to do.
          ...(h.mutationOpts = opts as Record<string, unknown>, {}),
          mutate: (vars: Record<string, unknown>) => {
            void (async () => {
              const ctx = await opts.onMutate?.(vars);
              h.mutate(vars);
              let res: unknown;
              let err: unknown = null;
              try {
                res = await h.respond(vars);
                await opts.onSuccess?.(res, vars, ctx);
              } catch (e) {
                err = e;
                await opts.onError?.(e, vars, ctx);
              }
              await opts.onSettled?.(res, err, vars, ctx);
            })();
          },
        }),
      },
    },
  };
  return { ...actual, trpc: deepOverlay(actual.trpc, fake) };
});

import OpportunitiesSection from "../pages/admin/OpportunitiesSection";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

let seq = 0;
const row = (over: Record<string, unknown> = {}) => {
  seq += 1;
  return {
    id: `11111111-2222-4333-8444-${String(seq).padStart(12, "0")}`,
    recommendedAction: `Call back caller ${seq}`,
    reason: "missed the call, no follow-up",
    customerName: null,
    customerPhone: "2165550100",
    expectedRevenueCents: 84000,
    sourceType: "missed_call",
    dataQuality: "verified",
    state: "new",
    attempts: 0,
    consentOk: true,
    receipts: [] as Array<Record<string, unknown>>,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ageDays: 1 as number | null,
    evidence: null as Record<string, unknown> | null,
    ...over,
  };
};

const load = (items: unknown[], queryable = true) => h.store.set({ items, queryable });

beforeEach(() => {
  seq = 0;
  h.store.data = undefined;
  h.flags = { isLoading: false, isError: false, isFetching: false };
  h.queryInputs.length = 0;
  h.mutate.mockClear();
  h.invalidate.mockClear();
  h.toastError.mockClear();
  h.confirm.mockReset();
  h.confirm.mockImplementation(async () => true);
  h.respond = async () => ({ ok: true });
});
afterEach(cleanup);

describe("an unreadable queue is UNKNOWN, never 'clear'", () => {
  it("says UNKNOWN, not clear, and does NOT also claim nothing is due", () => {
    load([], false);
    render(<OpportunitiesSection />);
    expect(screen.getByText(/UNKNOWN, not clear/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing due/i)).toBeNull();
  });

  it("a network error is not an empty queue either, and names the next action", () => {
    h.flags.isError = true;
    render(<OpportunitiesSection />);
    expect(screen.getByText(/UNKNOWN, not clear/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/Nothing due/i)).toBeNull();
  });

  it("a paused query (offline PWA: no data, no error, not loading) is not an empty queue", () => {
    render(<OpportunitiesSection />);
    expect(screen.getByText(/have not loaded yet/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing due/i)).toBeNull();
  });

  it("a queue that WAS read and is empty says so", () => {
    load([]);
    render(<OpportunitiesSection />);
    expect(screen.getByText(/Nothing due/i)).toBeTruthy();
    expect(screen.queryByText(/UNKNOWN, not clear/i)).toBeNull();
    expect(screen.queryByText(/have not loaded yet/i)).toBeNull();
  });
});

describe("what the list asks the server for", () => {
  it("requests exactly the live states of the server lifecycle (client list cannot drift)", () => {
    load([]);
    render(<OpportunitiesSection />);
    const input = h.queryInputs[0] as { states: string[]; limit: number };
    const live = OPPORTUNITY_STATES.filter((s) => !TERMINAL_STATES.includes(s));
    expect([...input.states].sort()).toEqual([...live].sort());
  });

  it("asks for more than the old 100-row window, which hid 150 of 250 live rows", () => {
    load([]);
    render(<OpportunitiesSection />);
    expect((h.queryInputs[0] as { limit: number }).limit).toBeGreaterThan(250);
  });

  it('asks the server to order the window as a worklist BEFORE it is cut (untouched first, newest first)', () => {
    load([]);
    render(<OpportunitiesSection />);
    expect((h.queryInputs[0] as { order?: string }).order).toBe("worklist");
  });

  it("says so when the window is full, instead of implying the list is complete", () => {
    load([]);
    const { unmount } = render(<OpportunitiesSection />);
    const full = (h.queryInputs[0] as { limit: number }).limit;
    unmount();
    load(Array.from({ length: full }, () => row()));
    render(<OpportunitiesSection />);
    // The note belongs to the full list, so it shows once Show all opens it.
    fireEvent.click(screen.getByRole("button", { name: /^Show all/ }));
    // A full window is also what exactly `full` live rows look like, so the copy must not claim more exist.
    expect(screen.getByText(`Showing the first ${full}. Older rows may exist: work these, then press Refresh.`)).toBeTruthy();
    expect(screen.queryByText(/More exist/)).toBeNull();
  });
});

describe("a row shows what it is, how old it is and whether anyone tried", () => {
  it("shows the action, the reason, the evidence tier and dollars, not cents", () => {
    load([row({ recommendedAction: "Call Maria about the declined brake estimate", reason: "declined 9 days ago, no follow-up", customerName: "Maria", sourceType: "unapproved_estimate" })]);
    render(<OpportunitiesSection />);
    expect(screen.getByText(/Call Maria about the declined brake estimate/)).toBeTruthy();
    expect(screen.getByText(/declined 9 days ago/)).toBeTruthy();
    expect(screen.getByText(/evidence: verified/)).toBeTruthy();
    expect(screen.getByText(/\$840/)).toBeTruthy();
  });

  it("says 'value unknown' rather than $0 when the value is not known", () => {
    load([row({ expectedRevenueCents: null })]);
    render(<OpportunitiesSection />);
    expect(screen.getByText(/value unknown/)).toBeTruthy();
    expect(screen.queryByText(/\$0/)).toBeNull();
  });

  it("names the type in words and the age in days", () => {
    load([
      row({ sourceType: "missed_call", ageDays: 3 }),
      row({ sourceType: "unapproved_estimate", ageDays: 0 }),
      row({ ageDays: 1 }),
    ]);
    render(<OpportunitiesSection />);
    expect(screen.getAllByText("Missed call")).toHaveLength(2);
    expect(screen.getByText("Unapproved estimate")).toBeTruthy();
    expect(screen.getByText("3 days old")).toBeTruthy();
    expect(screen.getByText("today")).toBeTruthy();
    expect(screen.getByText("1 day old")).toBeTruthy();
  });

  it("the age is the number SQL computed, not date math on this phone: a createdAt that disagrees is ignored", () => {
    // AGENTS.md (Time): a driver-parsed DATETIME is shifted on an ET host, so ages come from SQL.
    load([row({ ageDays: 6, createdAt: new Date() })]);
    render(<OpportunitiesSection />);
    expect(screen.getByText("6 days old")).toBeTruthy();
    expect(screen.queryByText("today")).toBeNull();
  });

  it("an age SQL could not compute is 'age unknown', never today", () => {
    load([row({ ageDays: null })]);
    render(<OpportunitiesSection />);
    expect(screen.getByText("age unknown")).toBeTruthy();
    expect(screen.queryByText("today")).toBeNull();
  });

  it("an untouched row claims only what the record holds: no attempt recorded HERE", () => {
    // The source system may already have texted this customer (unapproved_estimate records
    // recoveryTouchesSent, missed-call recovery runs on its own), so "Not contacted yet" was false.
    load([row()]);
    render(<OpportunitiesSection />);
    expect(screen.getByText("No attempt recorded here")).toBeTruthy();
    expect(screen.queryByText(/Not contacted yet/)).toBeNull();
  });

  it("every state with 0 attempts says the same, and never 'not contacted'", () => {
    for (const state of ["new", "assigned", "scheduled", "arrived"]) {
      cleanup();
      load([row({ state, attempts: 0 })]);
      render(<OpportunitiesSection />);
      expect(screen.getByText("No attempt recorded here"), state).toBeTruthy();
    }
  });

  it("shows the automated texts the source system already sent, when the evidence says so", () => {
    load([row({ sourceType: "unapproved_estimate", evidence: { estimateId: 9, recoveryTouchesSent: 2 } })]);
    render(<OpportunitiesSection />);
    expect(screen.getByText("Automated texts sent: 2")).toBeTruthy();
  });

  it("says nothing about automated texts for 0, an absent key, or a value that is not a number", () => {
    for (const evidence of [{ recoveryTouchesSent: 0 }, { estimateId: 9 }, null, { recoveryTouchesSent: "2" }]) {
      cleanup();
      load([row({ evidence })]);
      render(<OpportunitiesSection />);
      expect(screen.queryByText(/Automated texts sent/), JSON.stringify(evidence)).toBeNull();
    }
  });

  it("READS BACK the recorded attempt from the server receipts: verb, time, attempt count", () => {
    // The consumer of the write: a row the server returns with an attempted
    // receipt must show it. A UI that only wrote and never read would pass every
    // mutation test and still look untouched.
    load([
      row({
        state: "attempted",
        attempts: 2,
        receipts: [
          { at: "2026-10-22T14:05:00.000Z", by: "staff", from: "new", to: "attempted", note: "texted" },
          { at: "2026-10-23T15:30:00.000Z", by: "staff", from: "attempted", to: "attempted", note: "called" },
        ],
      }),
    ]);
    render(<OpportunitiesSection />);
    expect(screen.getByText(/^Called /, { selector: "p" })).toBeTruthy();
    expect(screen.getByText(/attempt 2/)).toBeTruthy();
    expect(screen.queryByText(/No attempt recorded here/)).toBeNull();
  });

  it("an attempt with a note we did not write (machine draft) is shown as an attempt, not as a call", () => {
    load([row({ state: "attempted", attempts: 1, receipts: [{ at: "2026-10-23T15:30:00.000Z", by: "system", from: "new", to: "attempted", note: "draft sent for approval" }] })]);
    render(<OpportunitiesSection />);
    expect(screen.getByText(/Contact attempted/)).toBeTruthy();
    expect(screen.queryByText(/^Called/, { selector: "p" })).toBeNull();
  });

  it("the phone number is a tap-to-call link, so the crew can work the row", () => {
    load([row({ customerPhone: "2165550123" })]);
    render(<OpportunitiesSection />);
    const link = screen.getByRole("link", { name: /2165550123/ });
    expect(link.getAttribute("href")).toBe("tel:2165550123");
  });

  it("untouched rows come first, then newest first", () => {
    const attemptedNewest = row({ recommendedAction: "attempted newest", attempts: 1, state: "attempted", createdAt: daysAgo(0.1), receipts: [{ at: "2026-10-23T15:30:00.000Z", to: "attempted", note: "called" }] });
    const untouchedOld = row({ recommendedAction: "untouched old", createdAt: daysAgo(5) });
    const untouchedNew = row({ recommendedAction: "untouched new", createdAt: daysAgo(1) });
    load([attemptedNewest, untouchedOld, untouchedNew]);
    render(<OpportunitiesSection />);
    const order = screen.getAllByRole("listitem").map((li) => /attempted newest|untouched old|untouched new/.exec(li.textContent ?? "")?.[0]);
    expect(order).toEqual(["untouched new", "untouched old", "attempted newest"]);
  });
});

describe("the three verbs write the right status through the existing mutation", () => {
  it("Called records an attempt with the note 'called'", async () => {
    const r = row();
    load([r]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Called/ }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
    expect(h.mutate.mock.calls[0][0]).toEqual({ id: r.id, from: "new", to: "attempted", note: "called" });
  });

  it("Texted records an attempt with the note 'texted'", async () => {
    const r = row();
    load([r]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Texted/ }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
    expect(h.mutate.mock.calls[0][0]).toEqual({ id: r.id, from: "new", to: "attempted", note: "texted" });
  });

  it("Called and Texted never write lost, do_not_contact or dismissed", async () => {
    load([row()]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Called/ }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(h.mutate.mock.calls[0][0])).not.toMatch(/lost|do_not_contact|dismissed/);
  });

  it("Not a customer asks first, then writes ONLY dismissed", async () => {
    const r = row();
    load([r]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Not a customer/ }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
    expect(h.confirm).toHaveBeenCalledTimes(1);
    const arg = h.mutate.mock.calls[0][0];
    expect(arg).toEqual({ id: r.id, from: "new", to: "dismissed", note: "not a customer" });
    expect(JSON.stringify(arg)).not.toMatch(/lost|do_not_contact|stated_concern/);
  });

  it("declining the confirm writes nothing and keeps the row", async () => {
    h.confirm.mockImplementation(async () => false);
    load([row({ recommendedAction: "keep me" })]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Not a customer/ }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/keep me/)).toBeTruthy();
  });

  it("Called and Texted do not ask for a confirm (they hide nothing)", async () => {
    load([row()]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Texted/ }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("on a row whose state proves a customer the dismiss reads Not relevant and writes 'not actionable'", async () => {
    // scheduled / walk_in_expected / arrived mean the customer exists. "Not a customer" would be false.
    for (const state of ["scheduled", "walk_in_expected", "arrived"]) {
      cleanup();
      h.mutate.mockClear();
      h.confirm.mockClear();
      const r = row({ state, attempts: 1 });
      load([r]);
      render(<OpportunitiesSection />);
      expect(screen.queryByRole("button", { name: /^Not a customer/ }), state).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /^Not relevant/ }));
      await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
      expect(h.mutate.mock.calls[0][0], state).toEqual({ id: r.id, from: state, to: "dismissed", note: "not actionable" });
      // The confirm follows the label.
      const asked = h.confirm.mock.calls[0] as unknown as [{ confirmLabel: string; message: string }];
      expect(asked[0].confirmLabel).toBe("Not relevant");
      expect(asked[0].message).toMatch(/not actionable/);
      expect(asked[0].message).not.toMatch(/not a customer/i);
    }
  });

  it("on new, assigned, attempted and no_response the dismiss stays Not a customer, and its confirm says so", async () => {
    for (const state of ["new", "assigned", "attempted", "no_response"]) {
      cleanup();
      h.mutate.mockClear();
      h.confirm.mockClear();
      const r = row({ state });
      load([r]);
      render(<OpportunitiesSection />);
      expect(screen.queryByRole("button", { name: /^Not relevant/ }), state).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /^Not a customer/ }));
      await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
      expect(h.mutate.mock.calls[0][0], state).toEqual({ id: r.id, from: state, to: "dismissed", note: "not a customer" });
      const asked = h.confirm.mock.calls[0] as unknown as [{ confirmLabel: string }];
      expect(asked[0].confirmLabel).toBe("Not a customer");
    }
  });

  it("a text waiting in Messages sends the crew to Messages: no Called or Texted, a link instead", () => {
    // Called/Texted would record an attempt but leave sms_response_jobs human_pending, so the
    // Messages count would keep saying the customer waits. The send / no-reply workflow resolves it.
    const r = row({ sourceType: "human_pending_sms", customerPhone: "2165550177" });
    load([r]);
    render(<OpportunitiesSection />);
    expect(screen.queryByRole("button", { name: /^Called/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Texted/ })).toBeNull();
    const link = screen.getByRole("link", { name: "Reply from Messages" });
    expect(link.getAttribute("href")).toBe("/admin?tab=campaigns&outreachTab=sms");
    // No phone number rides in the URL.
    expect(link.getAttribute("href")).not.toMatch(/\d{7}/);
    expect(screen.getByRole("button", { name: /^Not a customer/ })).toBeTruthy();
  });

  it("the Messages link opens the Outreach section in-app", () => {
    const events: Array<{ section: string }> = [];
    const onNav = (e: Event) => events.push((e as CustomEvent<{ section: string }>).detail);
    window.addEventListener("admin:navigate-section", onNav);
    load([row({ sourceType: "human_pending_sms" })]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("link", { name: "Reply from Messages" }));
    window.removeEventListener("admin:navigate-section", onNav);
    expect(events).toEqual([{ section: "campaigns" }]);
  });

  it("never reaches for a native dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const promptSpy = vi.spyOn(window, "prompt");
    const alertSpy = vi.spyOn(window, "alert");
    load([row()]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Not a customer/ }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("the row updates at once and tells the truth when the save fails", () => {
  it("Called shows on the row before the server answers (optimistic)", async () => {
    let release: (v: unknown) => void = () => {};
    h.respond = () => new Promise((res) => { release = res; });
    load([row()]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Called/ }));
    await waitFor(() => expect(screen.getByText(/^Called /, { selector: "p" })).toBeTruthy());
    expect(screen.queryByText(/No attempt recorded here/)).toBeNull();
    release({ ok: true });
    await waitFor(() => expect(h.invalidate).toHaveBeenCalled());
  });

  it("Not a customer removes the row at once, and the list is re-read after", async () => {
    load([row({ recommendedAction: "going away" })]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Not a customer/ }));
    await waitFor(() => expect(screen.queryByText(/going away/)).toBeNull());
    await waitFor(() => expect(h.invalidate).toHaveBeenCalled());
  });

  it("a refusal reported as { ok: false } shows a toast and puts the row back untouched", async () => {
    h.respond = async () => ({ ok: false, error: "illegal transition contacted -> attempted" });
    load([row({ recommendedAction: "stay put" })]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Called/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(String(h.toastError.mock.calls[0][0])).toBe("Someone else changed this row. It has been refreshed.");
    await waitFor(() => expect(screen.getByText(/No attempt recorded here/)).toBeTruthy());
    expect(screen.queryByText(/^Called /, { selector: "p" })).toBeNull();
    expect(screen.getByText(/stay put/)).toBeTruthy();
  });

  it("a conflict or an illegal move never tells the crew to retry; any other refusal keeps its text without an em dash and says try again", async () => {
    const EM = "—";
    const cases: Array<[string, RegExp | string]> = [
      [`conflict: state changed concurrently ${EM} re-read and retry`, "Someone else changed this row. It has been refreshed."],
      ["illegal transition dismissed -> attempted", "Someone else changed this row. It has been refreshed."],
      [`table not applied ${EM} migration 0099`, "Not saved: table not applied, migration 0099. The row is unchanged, try again."],
    ];
    for (const [error, expected] of cases) {
      cleanup();
      h.toastError.mockClear();
      h.respond = async () => ({ ok: false, error });
      load([row()]);
      render(<OpportunitiesSection />);
      fireEvent.click(screen.getByRole("button", { name: /^Called/ }));
      await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
      const text = String(h.toastError.mock.calls[0][0]);
      expect(text, error).toBe(expected);
      expect(text).not.toContain(EM);
    }
  });

  it("is not paused offline: the mutation runs with networkMode always, so an offline tap fails into onError", () => {
    // TanStack v5 runs onMutate BEFORE it pauses an offline mutation, so without this the
    // optimistic row would read "Called <time>" while nothing was sent.
    load([row()]);
    render(<OpportunitiesSection />);
    expect(h.mutationOpts?.networkMode).toBe("always");
  });

  it("a thrown error (network, permission) shows a toast and keeps the row", async () => {
    h.respond = async () => { throw new Error("Failed to fetch"); };
    load([row({ recommendedAction: "still here" })]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Texted/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(String(h.toastError.mock.calls[0][0])).toMatch(/Failed to fetch/);
    expect(screen.getByText(/still here/)).toBeTruthy();
    expect(screen.getByText(/No attempt recorded here/)).toBeTruthy();
  });

  it("a refused Not a customer brings the row back, with its verbs", async () => {
    h.respond = async () => ({ ok: false, error: "conflict: state changed concurrently, re-read and retry" });
    load([row({ recommendedAction: "first" }), row({ recommendedAction: "second", createdAt: daysAgo(4) })]);
    render(<OpportunitiesSection />);
    const firstRow = screen.getAllByRole("listitem")[0];
    fireEvent.click(within(firstRow).getByRole("button", { name: /^Not a customer/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.getByText(/first/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Called/ })).toHaveLength(2);
  });

  it("the row's buttons are disabled while its save is in flight", async () => {
    h.respond = () => new Promise(() => {});
    load([row()]);
    render(<OpportunitiesSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Called/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: /^Texted/ }) as HTMLButtonElement).disabled).toBe(true));
  });
});

describe("only the verbs the server will accept are offered", () => {
  it("Called and Texted appear for a state exactly when the server allows -> attempted", () => {
    // The client must not carry its own copy of the lifecycle. Every live state is
    // rendered and compared with the server's canTransition, so a change to the
    // server rules fails here instead of producing a button that always errors.
    const live = OPPORTUNITY_STATES.filter((s) => !TERMINAL_STATES.includes(s));
    expect(live.length).toBeGreaterThan(0);
    for (const state of live) {
      cleanup();
      load([row({ state })]);
      render(<OpportunitiesSection />);
      const offered = screen.queryByRole("button", { name: /^Called/ }) !== null;
      expect(offered, `Called for state ${state}`).toBe(canTransition(state, "attempted"));
      expect(screen.queryByRole("button", { name: /^Texted/ }) !== null, `Texted for state ${state}`).toBe(offered);
      // Not a customer is always available on a live row.
      expect(screen.queryByRole("button", { name: /^(Not a customer|Not relevant)/ }), `dismiss for ${state}`).not.toBeNull();
    }
  });

  it("a flag that can mean an SMS opt-out OR do-not-contact says both, and keeps the number readable as plain text", () => {
    // consentOk is false for an estimate row when the phone has any opt-out, so it cannot
    // tell a texting opt-out from a do-not-contact row. The copy must not claim the stronger.
    load([row({ consentOk: false, customerPhone: "2165550199" })]);
    render(<OpportunitiesSection />);
    expect(screen.getByText("Opted out of texts or marked do-not-contact. Called and Texted are off for this row.")).toBeTruthy();
    expect(screen.getByText("2165550199")).toBeTruthy();
    expect(screen.queryByText(/consent is off/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Called/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Texted/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: /^Not a customer/ })).toBeTruthy();
  });
});

describe("phone use", () => {
  it("every verb meets the 48px touch target the admin uses on iOS", () => {
    load([row()]);
    render(<OpportunitiesSection />);
    for (const name of [/^Called/, /^Texted/, /^Not a customer/]) {
      expect(screen.getByRole("button", { name }).className).toMatch(/min-h-\[48px\]/);
    }
    expect(screen.getByRole("link").className).toMatch(/min-h-\[48px\]/);
  });

  it("the header names what the tab holds without narrowing it to two source types", () => {
    // The tab also lists callbacks, stale leads, abandoned forms and more.
    load([row()]);
    render(<OpportunitiesSection />);
    expect(screen.getByText(/calls, estimates, bookings and forms/)).toBeTruthy();
  });

  it("small text on the graphite card stays at 60 percent or brighter (4.5:1 needs it)", () => {
    // 50 percent of the foreground on #15171A measures 4.47:1, a fail.
    load([row()]);
    const { container } = render(<OpportunitiesSection />);
    expect(container.innerHTML).not.toMatch(/text-foreground\/(50|45|40|30)\b/);
  });

  it("long text wraps instead of being cut off at 375px", () => {
    load([row({ recommendedAction: "x".repeat(40), reason: "y".repeat(40) })]);
    render(<OpportunitiesSection />);
    expect(screen.getByText(/xxxx/).className).not.toMatch(/\btruncate\b/);
    expect(screen.getByText(/yyyy/).className).not.toMatch(/\btruncate\b/);
  });
});

describe("the mocks in this file keep the real module shape (the vi.mock registry is shared in the serial run)", () => {
  it("sonner still exports its Toaster, which components/ui/sonner.tsx re-exports", async () => {
    const sonner = await import("sonner");
    expect(sonner.Toaster).toBeDefined(); // a React component object, not necessarily a function
    expect(sonner.toast.error).toBe(h.toastError); // and only toast is replaced
  });

  it("@/lib/trpc still exposes the real client factory, not just the procedures this file fakes", async () => {
    const mod = await import("@/lib/trpc");
    expect(typeof (mod.trpc as unknown as { createClient: unknown }).createClient).toBe("function");
  });
});

afterAll(() => {
  vi.doUnmock("sonner");
  vi.doUnmock("@/lib/trpc");
  vi.doUnmock("@/components/admin/ConfirmDialog");
});
