/**
 * Office intelligence: the "Last 6 hours" digest block and each conversation's facts
 * (job 2026-10-17-office-detail-hourly-digest, contract office-digest v1).
 *
 * Mounts the real LotSection with "@/lib/trpc" replaced by the proxy admin-w3-lot-board.test.tsx
 * uses, plus a record of each query's input and options so the poll interval is pinned.
 * TZ is set to Honolulu before anything loads: the hour labels must read in shop time
 * (America/New_York) whatever the phone's own timezone is.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isPending: boolean; isError: boolean; error: unknown; fetchStatus: string; refetch: () => void };
const h = vi.hoisted(() => {
  process.env.TZ = "Pacific/Honolulu";
  return {
    queries: new Map<string, Partial<Q>>(),
    calls: new Map<string, { input: unknown; opts: unknown }>(),
    Null: () => null,
  };
});
vi.mock("@/lib/trpc", () => {
  const query = (path: string) => (input: unknown, opts: unknown) => {
    h.calls.set(path, { input, opts });
    return {
      data: undefined,
      isPending: false,
      isLoading: false,
      isError: false,
      error: null,
      fetchStatus: "idle",
      refetch: async () => {},
      isFetching: false,
      dataUpdatedAt: Date.now(),
      ...h.queries.get(path),
    };
  };
  const mutation = () => () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isSuccess: false, reset: () => {} });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery") return query(path);
        if (key === "useMutation") return mutation();
        if (key === "invalidate") return async () => {};
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
vi.mock("@/pages/admin/CommissioningPanel", () => ({ default: h.Null }));
import LotSection from "@/pages/admin/LotSection";

const HOUR = 3_600_000;
// 2026-10-17 18:00 UTC is 2 PM in Cleveland (EDT) and 8 AM in Honolulu.
const TWO_PM_ET = Date.UTC(2026, 9, 17, 18);

function hour(startMs: number, extra: Record<string, unknown> = {}) {
  return {
    hourStartMs: startMs, hourEndMs: startMs + HOUR, isCurrent: false, episodes: 0, talkSeconds: 0, factCount: 0,
    status: "NO_ACTIVITY", digest: null, topics: [], error: null, ...extra,
  };
}

const DIGEST = {
  ok: true,
  generatedAtMs: TWO_PM_ET + 20 * 60_000,
  hours: [
    hour(TWO_PM_ET, {
      isCurrent: true, episodes: 3, talkSeconds: 720, factCount: 4, status: "DONE",
      digest: "Two tire quotes and one pickup question.",
      topics: ["tire quote", "pickup time", "alignment", "brakes", "price check", "warranty"],
    }),
    hour(TWO_PM_ET - HOUR, { episodes: 1, talkSeconds: 40, status: "THIN" }),
    hour(TWO_PM_ET - 2 * HOUR),
    hour(TWO_PM_ET - 3 * HOUR, { episodes: 2, talkSeconds: 300, status: "FAILED", error: "model timeout" }),
  ],
};

function convo(id: string, extra: Record<string, unknown> = {}) {
  return {
    episodeId: id, source: "office", cameraSerial: null, captureHost: null, triggerType: null, triggeredAtMs: null,
    startedAtMs: TWO_PM_ET, durationSeconds: 90, meanVolumeDb: null, transcriptStatus: "DONE", transcriptError: null,
    sttEngine: null, sttModel: null, sttLatencyMs: null, speakerCount: null, coverage: 0.9, factCount: 0, summary: "Quote given.",
    candidateVehicleVisitId: null, candidateWorkOrderId: null, linkConfidence: null, gist: `Gist for ${id}`, visual: null,
    ...extra,
  };
}

const fact = (kind: string, value: string, evidenceText: string) => ({ kind, value, evidenceText, confidence: 0.9 });
const FIVE_FACTS = [
  fact("TIRE_SIZE", "225/65R17", "it's a 225 65 17"),
  fact("vehicle_make", "Honda", "my Honda"),
  fact("requested_service", "alignment", "pulls to the right"),
  fact("pickup_time", "4 PM", "can I get it by four"),
  fact("price_quoted", "$480", "four eighty out the door"),
];

function setOffice({ digest = { data: DIGEST } as Partial<Q>, conversations = [convo("c-1")] as unknown[] } = {}) {
  h.queries.set("lot.officeDigest", digest);
  h.queries.set("lot.conversations", { data: { ok: true, conversations } });
}

const block = () => screen.getByRole("region", { name: "Last 6 hours" });
const hourRows = () => within(block()).getAllByRole("listitem");

afterEach(() => {
  h.queries.clear();
  h.calls.clear();
});

describe("Last 6 hours digest", () => {
  it("asks for six hours and polls every minute", () => {
    setOffice();
    render(<LotSection />);
    const call = h.calls.get("lot.officeDigest");
    expect(call?.input).toEqual({ hours: 6 });
    expect((call?.opts as { refetchInterval?: number })?.refetchInterval).toBe(60_000);
  });

  it("sits at the top of the Office intelligence panel, before the camera cards", () => {
    setOffice();
    render(<LotSection />);
    const camera = screen.getByText("NICKS EUCLID · office camera");
    expect(Boolean(block().compareDocumentPosition(camera) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("labels each hour in shop time, newest first, and only the current one says so far", () => {
    setOffice();
    render(<LotSection />);
    const rows = hourRows();
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("2 PM to 3 PM");
    expect(rows[0].textContent).toContain("so far");
    expect(rows[1].textContent).toContain("1 PM to 2 PM");
    expect(rows[1].textContent).not.toContain("so far");
  });

  it("a DONE hour shows counts, the digest and at most five topics", () => {
    setOffice();
    render(<LotSection />);
    const row = hourRows()[0];
    expect(row.textContent).toContain("3 conversations · 12 min talk");
    expect(row.textContent).toContain("Two tire quotes and one pickup question.");
    expect(within(row).getByText("price check")).toBeTruthy();
    expect(within(row).queryByText("warranty")).toBeNull();
  });

  it("says what each other state means, in its own words", () => {
    setOffice();
    render(<LotSection />);
    const [, thin, quiet, failed] = hourRows();
    expect(thin.textContent).toContain("Too little clear audio to summarize");
    expect(thin.textContent).toContain("1 conversation · under 1 min talk");
    expect(thin.textContent).not.toContain("No conversations");
    expect(quiet.textContent).toContain("No conversations");
    expect(quiet.textContent).not.toContain("Too little clear audio");
    expect(failed.textContent).toContain("Summary failed, retrying");
    expect(failed.textContent).not.toContain("No conversations");
  });

  const broken: Array<[string, Partial<Q>]> = [
    ["a failed read", { data: undefined, isError: true, error: { message: "NOT_FOUND" } }],
    ["a paused (offline) read", { data: undefined, isPending: true, fetchStatus: "paused" }],
    ["an ok:false answer", { data: { ok: false, reason: "digest table missing" } }],
    // react-query keeps the last answer when a background poll fails; isError still means unknown now.
    ["a failed poll over an earlier answer", { data: DIGEST, isError: true, error: { message: "timeout" } }],
  ];
  for (const [name, q] of broken) {
    it(`${name} says unavailable with a 48 px Retry, never No conversations`, () => {
      const refetch = vi.fn();
      setOffice({ digest: { ...q, refetch } });
      render(<LotSection />);
      expect(within(block()).getByText("Hourly summary unavailable")).toBeTruthy();
      expect(within(block()).queryByText("No conversations")).toBeNull();
      expect(within(block()).queryByText(/Loading/)).toBeNull();
      const retry = within(block()).getByRole("button", { name: "Retry" });
      expect(retry.className).toContain("min-h-12");
      fireEvent.click(retry);
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  }

  it("says loading while the first read is in flight", () => {
    setOffice({ digest: { data: undefined, isPending: true, fetchStatus: "fetching" } });
    render(<LotSection />);
    expect(within(block()).getByText(/Loading hourly summary/)).toBeTruthy();
    expect(within(block()).queryByText("Hourly summary unavailable")).toBeNull();
  });
});

describe("conversation facts", () => {
  const factList = () => screen.getByRole("list", { name: "Facts heard" });

  it("shows the first three under the gist, then a 48 px Show all N that reveals the rest", () => {
    setOffice({ conversations: [convo("c-1", { factCount: 5, facts: FIVE_FACTS })] });
    render(<LotSection />);
    const gist = screen.getByText("Gist for c-1");
    expect(Boolean(gist.compareDocumentPosition(factList()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(within(factList()).getAllByRole("listitem")).toHaveLength(3);
    const first = within(factList()).getAllByRole("listitem")[0];
    expect(first.textContent).toContain("Tire size");
    expect(first.textContent).toContain("225/65R17");
    expect(first.textContent).toContain("it's a 225 65 17");
    const more = screen.getByRole("button", { name: "Show all 5" });
    expect(more.className).toContain("min-h-12");
    fireEvent.click(more);
    expect(within(factList()).getAllByRole("listitem")).toHaveLength(5);
    expect(within(factList()).getAllByRole("listitem")[1].textContent).toContain("Vehicle make");
  });

  it("three or fewer facts need no toggle", () => {
    setOffice({ conversations: [convo("c-1", { factCount: 2, facts: FIVE_FACTS.slice(0, 2) })] });
    render(<LotSection />);
    expect(within(factList()).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("an older server without facts adds nothing to the row", () => {
    setOffice({ conversations: [convo("c-1", { factCount: 3 })] });
    render(<LotSection />);
    expect(screen.getByText("Gist for c-1")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Facts heard" })).toBeNull();
  });
});
