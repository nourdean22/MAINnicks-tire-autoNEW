/**
 * pipeline-followups.test.tsx · 2026-10-25 (job 2026-10-25-admin-tabs-pipeline)
 *
 * Sales Pipeline opens on Today's follow-ups: the first five beside the total open, each card
 * saying why it is there before anything else. The web leads are one list with three filters, and
 * job applicants live on their own Hiring tab, never inside the sales lane. A failed read is
 * unknown, never an empty list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; isFetching: boolean };

const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  calls: [] as unknown[],
  refetch: vi.fn(),
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: h.refetch,
    ...h.queries.get(path),
  });
  const mutation = () => () => ({
    mutate: (input: unknown) => h.calls.push(input),
    mutateAsync: async () => ({}),
    isPending: false,
    reset: () => {},
  });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation();
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  const root = new Proxy({}, {
    get(_t, key) {
      if (key === "useUtils" || key === "useContext") return () => node("utils");
      return node(String(key));
    },
  });
  return { trpc: root };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() }, Toaster: () => null }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: async () => true, default: () => null }));
vi.mock("../pages/admin/leads/CandidatesPanel", () => ({
  CandidatesPanel: () => React.createElement("div", null, "candidates panel"),
}));

import LeadsSection from "../pages/admin/LeadsSection";
import OpportunitiesSection from "../pages/admin/OpportunitiesSection";
import { LEAD_STATUS_CONFIG, type LeadStatus } from "../pages/admin/shared";
import { LEAD_BUCKETS, leadBucket } from "../pages/admin/leads/leadInbox";

const RELEVANT = ["new", "assigned", "attempted", "contacted", "scheduled", "walk_in_expected", "arrived", "no_response"];

let seq = 0;
const opp = (over: Record<string, unknown> = {}) => {
  seq += 1;
  return {
    id: `11111111-2222-4333-8444-${String(seq).padStart(12, "0")}`,
    recommendedAction: `Call back 216555${String(seq).padStart(4, "0")}: tire quote, 2 hours ago`,
    reason: "The receptionist's evaluation says this is unresolved; a human call-back beats any text.",
    customerName: null,
    customerPhone: `216555${String(seq).padStart(4, "0")}`,
    expectedRevenueCents: null,
    sourceType: "missed_call",
    dataQuality: "verified",
    state: RELEVANT[seq % RELEVANT.length],
    attempts: 0,
    consentOk: true,
    receipts: [],
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    ageDays: 0,
    evidence: null as Record<string, unknown> | null,
    ...over,
  };
};

/** 23 rows: missed_call x 15 (some with the server lane's new evidence), estimates x 4, callbacks x 2, stale leads x 2. */
function fixture23() {
  const rows = [];
  for (let i = 0; i < 15; i++) {
    rows.push(opp(i % 2 === 0 ? { evidence: { evalOutcome: "unresolved", serviceMention: `brakes ${i}`, summaryExcerpt: `asked for a stock check ${i}` } } : {}));
  }
  for (let i = 0; i < 4; i++) rows.push(opp({ sourceType: "unapproved_estimate", recommendedAction: `Follow up estimate ${i}` }));
  for (let i = 0; i < 2; i++) rows.push(opp({ sourceType: "pending_callback", recommendedAction: `Return callback ${i}` }));
  for (let i = 0; i < 2; i++) rows.push(opp({ sourceType: "stale_lead", recommendedAction: `Stale lead ${i}` }));
  return rows;
}

const loadOpps = (items: unknown[], queryable = true) => h.queries.set("opportunityQueue.list", { data: { items, queryable } });

const lead = (id: number, status: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Pat${id} Surname${id}`,
  phone: `216555010${id}`,
  email: null,
  vehicle: null,
  problem: `Need ${status} work ${id}\nsecond line of the message`,
  status,
  source: "estimate",
  urgencyScore: 3,
  callbackId: null,
  createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  lastFollowUpAt: status === "new" ? null : new Date(Date.now() - 2 * 86_400_000).toISOString(),
  ...over,
});

const LEADS = [
  lead(1, "new"),
  lead(2, "contacted"),
  lead(3, "booked"),
  lead(4, "completed"),
  lead(5, "closed"),
  lead(6, "lost"),
  lead(7, "new", { source: "careers", name: "Applicant Person" }),
];

const at = (search: string) => window.history.replaceState(null, "", `/admin?tab=leads${search}`);

beforeEach(() => {
  seq = 0;
  h.queries.clear();
  h.calls.length = 0;
  h.refetch.mockClear();
  window.history.replaceState(null, "", "/admin?tab=leads");
});
afterEach(cleanup);

describe("Sales Pipeline tabs", () => {
  it("opens on Today's follow-ups by default, with the three tabs named", () => {
    loadOpps(fixture23());
    render(<LeadsSection />);
    expect(screen.getByRole("heading", { name: /Today's follow-ups/ })).toBeTruthy();
    for (const label of ["Today's follow-ups", "Leads", "Hiring"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}$`) })).toBeTruthy();
    }
  });

  it("an old ?leadsTab=opportunities link lands on the follow-ups", () => {
    at("&leadsTab=opportunities");
    loadOpps(fixture23());
    render(<LeadsSection />);
    expect(screen.getByRole("heading", { name: /Today's follow-ups/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Needs response/ })).toBeNull();
  });

  it("an old ?leadsTab=pipeline link lands on the leads list", () => {
    at("&leadsTab=pipeline");
    h.queries.set("lead.list", { data: LEADS });
    render(<LeadsSection />);
    expect(screen.getByRole("button", { name: /^Needs response/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Today's follow-ups/ })).toBeNull();
  });

  it("applicants live on Hiring only: not on the follow-ups, not on the leads", () => {
    loadOpps(fixture23());
    render(<LeadsSection />);
    expect(screen.queryByText("candidates panel")).toBeNull();
    cleanup();
    at("&leadsTab=leads");
    h.queries.set("lead.list", { data: LEADS });
    render(<LeadsSection />);
    expect(screen.queryByText("candidates panel")).toBeNull();
    cleanup();
    at("&leadsTab=hiring");
    render(<LeadsSection />);
    expect(screen.getByText("candidates panel")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Hiring · job applicants/ })).toBeTruthy();
  });

  it("says in one line what the section is and that it sends nothing", () => {
    loadOpps([]);
    render(<LeadsSection />);
    expect(screen.getByText(/Who to call back today, the web leads, and hiring\./)).toBeTruthy();
    expect(screen.getByText(/this page sends nothing/)).toBeTruthy();
  });
});

describe("Today's follow-ups", () => {
  it("shows five of the total open (a page, never a count of what is due), and Show all expands to the total", () => {
    loadOpps(fixture23());
    render(<OpportunitiesSection />);
    expect(screen.getByText("Showing 5 of 23 open")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    const all = screen.getByRole("button", { name: "Show all 23" });
    expect(all.className).toMatch(/min-h-\[(44|48)px\]/);
    fireEvent.click(all);
    expect(screen.getAllByRole("listitem")).toHaveLength(23);
    expect(screen.getByText("23 open")).toBeTruthy();
  });

  it("fewer than five shows them all, and no Show all control", () => {
    loadOpps(fixture23().slice(0, 3));
    render(<OpportunitiesSection />);
    expect(screen.getByText("3 open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("a full 500-row window says 500 or more, never exactly 500", () => {
    loadOpps(Array.from({ length: 500 }, () => opp()));
    render(<OpportunitiesSection />);
    expect(screen.getByText("Showing 5 of 500 or more open")).toBeTruthy();
  });

  it("a missed call with the receptionist's evidence shows the excerpt and the service, after the why", () => {
    loadOpps([opp({ evidence: { evalOutcome: "unresolved", serviceMention: "front brakes", summaryExcerpt: "asked for a stock check; promised callback" } })]);
    render(<OpportunitiesSection />);
    const card = screen.getByRole("listitem");
    const excerpt = within(card).getByText("Receptionist: asked for a stock check; promised callback");
    const service = within(card).getByText("Service: front brakes");
    const why = within(card).getByText(/evaluation says this is unresolved/);
    // The why comes first, then the evidence.
    expect(why.compareDocumentPosition(excerpt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(excerpt.compareDocumentPosition(service) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("an older row without the evidence prints no empty labels", () => {
    loadOpps([opp(), opp({ evidence: { summaryExcerpt: "", serviceMention: null } })]);
    render(<OpportunitiesSection />);
    expect(screen.queryByText(/^Receptionist:/)).toBeNull();
    expect(screen.queryByText(/^Service:/)).toBeNull();
  });

  it("other kinds keep their own words", () => {
    loadOpps([opp({ sourceType: "unapproved_estimate", recommendedAction: "Follow up the brake estimate", reason: "declined 9 days ago" })]);
    render(<OpportunitiesSection />);
    expect(screen.getByText("Follow up the brake estimate")).toBeTruthy();
    expect(screen.getByText("declined 9 days ago")).toBeTruthy();
  });

  it("a card carries the phone, never the customer's name", () => {
    loadOpps([opp({ customerName: "Maria Lopez", customerPhone: "2165550142", recommendedAction: "Call back 2165550142: tires, 1 hour ago" })]);
    render(<OpportunitiesSection />);
    expect(screen.queryByText(/Maria Lopez/)).toBeNull();
    expect(screen.getByRole("link", { name: "2165550142" })).toBeTruthy();
  });

  it("a failed read is unknown, not empty, and offers Retry", () => {
    h.queries.set("opportunityQueue.list", { isError: true });
    render(<OpportunitiesSection />);
    expect(screen.getByText(/Follow-ups couldn't load/)).toBeTruthy();
    expect(screen.queryByText(/Nothing open/)).toBeNull();
    expect(screen.queryByText(/ open$/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it("an unreadable queue (queryable false) is the same unknown", () => {
    loadOpps([], false);
    render(<OpportunitiesSection />);
    expect(screen.getByText(/Follow-ups couldn't load/)).toBeTruthy();
    expect(screen.queryByText(/Nothing open/)).toBeNull();
  });

  it("a queue that was read and is empty says nothing is open", () => {
    loadOpps([]);
    render(<OpportunitiesSection />);
    expect(screen.getByText("Nothing open. No follow-up is waiting.")).toBeTruthy();
    expect(screen.queryByText(/couldn't load/)).toBeNull();
  });
});

describe("the web leads are one list with three filters", () => {
  it("every lead status lands in exactly one of the three filters", () => {
    const ids = LEAD_BUCKETS.map((b) => b.id);
    expect(LEAD_BUCKETS.map((b) => b.label)).toEqual(["Needs response", "Waiting", "Closed"]);
    const statuses = Object.keys(LEAD_STATUS_CONFIG) as LeadStatus[];
    expect(statuses.length).toBe(6);
    const table = Object.fromEntries(statuses.map((s) => [s, leadBucket(s)]));
    expect(table).toEqual({ new: "needs", contacted: "waiting", booked: "waiting", completed: "closed", closed: "closed", lost: "closed" });
    for (const s of statuses) expect(ids).toContain(leadBucket(s));
  });

  it("a status this page does not know yet is shown as needing a response, never dropped", () => {
    expect(leadBucket("spam")).toBe("needs");
  });

  it("opens on Needs response; Waiting and Closed each show their own leads, with the denominator", () => {
    at("&leadsTab=leads");
    h.queries.set("lead.list", { data: LEADS });
    render(<LeadsSection />);
    const chips = ["Needs response", "Waiting", "Closed"].map((n) => screen.getByRole("button", { name: new RegExp(`^${n}`) }));
    for (const c of chips) expect(c.className).toMatch(/min-h-\[(44|48)px\]/);
    // The applicant (careers) is not a web lead: 6 web leads, not 7.
    expect(screen.getByText("1 of 6 web leads")).toBeTruthy();
    expect(screen.getByText("Pat1")).toBeTruthy();
    expect(screen.queryByText(/Applicant/)).toBeNull();
    fireEvent.click(chips[1]);
    expect(screen.getByText("2 of 6 web leads")).toBeTruthy();
    expect(screen.getByText("Pat2")).toBeTruthy();
    expect(screen.getByText("Pat3")).toBeTruthy();
    expect(screen.queryByText("Pat1")).toBeNull();
    fireEvent.click(chips[2]);
    expect(screen.getByText("3 of 6 web leads")).toBeTruthy();
    for (const n of ["Pat4", "Pat5", "Pat6"]) expect(screen.getByText(n)).toBeTruthy();
  });

  it("a row shows the first name, the first line of the request, the ages and a status control; no kanban", () => {
    at("&leadsTab=leads");
    h.queries.set("lead.list", { data: LEADS });
    render(<LeadsSection />);
    expect(screen.queryByText(/Surname1/)).toBeNull();
    expect(screen.getByText("Need new work 1")).toBeTruthy();
    expect(screen.queryByText(/second line of the message/)).toBeNull();
    expect(screen.getByText(/Received 3h ago/)).toBeTruthy();
    expect(screen.getByText(/No shop touch recorded/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /KANBAN/i })).toBeNull();
    const select = screen.getByLabelText("Change status for Pat1") as HTMLSelectElement;
    expect(select.className).toMatch(/min-h-\[(44|48)px\]/);
    fireEvent.change(select, { target: { value: "booked" } });
    expect(h.calls).toContainEqual({ id: 1, status: "booked" });
  });

  it("a waiting lead shows how long since the shop last touched it", () => {
    at("&leadsTab=leads&status=waiting");
    h.queries.set("lead.list", { data: LEADS });
    render(<LeadsSection />);
    expect(screen.getAllByText(/Last shop touch 2d ago/).length).toBe(2);
  });

  it("a failed lead read is unknown, not an empty list", () => {
    at("&leadsTab=leads");
    h.queries.set("lead.list", { isError: true, error: new Error("boom") });
    render(<LeadsSection />);
    expect(screen.getByText(/Leads could not be read/)).toBeTruthy();
    expect(screen.queryByText(/of \d+ web leads/)).toBeNull();
    expect(screen.queryByText(/No leads here/)).toBeNull();
  });
});
