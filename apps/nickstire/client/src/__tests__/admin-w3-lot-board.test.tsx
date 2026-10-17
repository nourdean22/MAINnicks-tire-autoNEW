/**
 * Admin UI v1 Wave 3: Lot opens on who is on the lot (apps/nickstire/docs/design/admin-ui-v1/PLAN.md
 * section 3, W3).
 *
 * The floor board is the page's first object after the header, as ruled rows longest first with one
 * verb ("Quote", the walk-in drawer); the four counters sit in one strip below it; the trust chips and
 * every evidence panel live under one collapsed "Checks" rail whose summary counts what is not
 * healthy. Nothing on Lot is deleted. Each test mounts the real LotSection with "@/lib/trpc" replaced
 * by the same proxy admin-w2-today-board.test.tsx uses, except a query value may be a function of the
 * input, because lot.visits is read twice (the floor board asks for open visits only).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isPending: boolean; isError: boolean; error: unknown; refetch: () => void; dataUpdatedAt: number };
const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q> | ((input: unknown) => Partial<Q>)>(),
  Null: () => null,
  // lotDataConfidence is a pure helper with its own tests; pinning its verdict here isolates the
  // rail summary's counting from the baseline arithmetic.
  confidence: { level: "OK", headline: "14 arrivals so far", reasons: [] as string[] } as { level: string; headline: string; reasons: string[] },
}));
vi.mock("@shared/lotDataConfidence", () => ({ lotDataConfidence: () => h.confidence }));
vi.mock("@/lib/trpc", () => {
  const query = (path: string) => (input: unknown) => {
    const set = h.queries.get(path);
    return {
      data: undefined,
      isPending: false,
      isLoading: false,
      isError: false,
      error: null,
      refetch: async () => {},
      isFetching: false,
      dataUpdatedAt: Date.now(),
      ...(typeof set === "function" ? set(input) : set),
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

const MIN = 60_000;
const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * MIN).toISOString();

function visit(id: string, plate: string | null, mins: number, extra: Record<string, unknown> = {}) {
  return {
    visitId: id, camera: "lot-east", state: "WAITING", arrivedAt: iso(mins), waitStartedAt: iso(mins), bayEnteredAt: null,
    bayExitedAt: null, departedAt: null, bay: null, preexisting: false, entryEvidence: "camera", plateStatus: plate ? "CONFIRMED" : "UNREAD",
    plateText: plate, customerMatch: "NONE", estimatedFields: [], cameraPose: null, dataClass: "PRODUCTION", commissioningRunId: null,
    onPropertyMinutes: mins, sinceFirstSeenMinutes: mins, waitMinutes: mins, bayMinutes: null, open: true, marks: null, markHistory: [],
    ...extra,
  };
}
const ON_LOT = [visit("v-3", "FIX 1003", 38), visit("v-1", "FIX 1001", 125, { customerMatch: "EXACT" }), visit("v-5", null, 9)];

const camera = (name: string, role: string, state = "HEALTHY") => ({
  // The shape admin-v1 fixtures/data.ts healthyCamera() builds, so CameraCard renders as it does in prod.
  camera: name, label: name, role, healthProfile: "always_on", state, stateForSeconds: 600, ageSeconds: 12, reason: null, commissioned: true, registered: true,
  facets: { producer: "alive", source: "connected", frames: "fresh", pose: "ok", calibration: "valid", vision: "seeing", auth: "ok", events: "ok", control: "ok", media: "ok", home: "ok", cloud: "ok" },
  vision: null, stability: { dropsToday: 0, transitionsToday: 0 }, conversation: null, mode: "PRODUCTION", commissioningRunId: null,
  producer: null, source: null, transport: null, cloud: null, openVisits: 3, timeline: null,
});

function setLot({ sign = "HEALTHY", floor }: { sign?: string; floor?: Partial<Q> } = {}) {
  h.queries.set("lot.now", {
    data: {
      ok: true, neverIngested: false, commissioningVisits: 0, truncated: false, staleSeconds: 40,
      counts: { onProperty: 3, onLotNotInBay: 3, waitingForBay: 3, inBays: 0, bayUnknown: 0, postService: 0, preexisting: 0, preexistingWaiting: 0, arrivalsToday: 14, passThroughsToday: 3, departuresToday: 9, leftWithoutBay: 1, arrivalTimeUnknown: 0 },
      waits: { oldestWaitMinutes: 36, medianMinutes: 19, p90Minutes: 34, sampleSize: 11 },
      bays: [], identity: { plateConfirmed: 0, plateAmbiguous: 0, customerExact: 0, customerConfusable: 0, customerAmbiguous: 0 },
      marks: null,
    },
  });
  h.queries.set("lot.visits", (input) =>
    (input as { openOnly?: boolean }).openOnly && floor ? floor : { data: { ok: true, marksAvailable: false, rows: ON_LOT } },
  );
  const office = {
    ...camera("office", "conversation"),
    conversation: { workerOk: true, state: "READY", workerAgeSeconds: 10, listeningCoverage60m: 0.9, capturesLast60m: 3, captureFailuresLast60m: 0, wakeTriggersLast60m: 2, transcribeBacklog: 0 },
  };
  h.queries.set("lot.health", {
    data: { ok: true, cameras: [camera("sign", "vehicle_truth", sign), office], transitions: [], thresholds: { staleAfterSeconds: 60, offlineAfterSeconds: 120 }, windowColumnsStored: true, shopOpen: true, coverage: null },
  });
  h.queries.set("lot.activity", {
    data: {
      ok: true,
      // The admin-v1 fixture's shape: 24 hours and seven prior days (ActivityPanel indexes both).
      hours: Array.from({ length: 24 }, (_, hour) => ({ hour, arrivals: hour >= 8 && hour <= 14 ? 2 : 0, passThroughs: 0, baselineArrivals: hour >= 8 && hour <= 17 ? 2 : 0 })),
      totals: { arrivals: 14, passThroughs: 0, crossings: 14, passThroughShare: 0 },
      history: { priorDaysWithData: 7, days: [1, 2, 3, 4, 5, 6, 7].map((dayOffset) => ({ dayOffset, arrivals: 18, passThroughs: 2 })) },
    },
  });
  h.queries.set("lot.conversations", { data: { ok: true, conversations: [] } });
}

afterEach(() => {
  h.queries.clear();
  h.confidence = { level: "OK", headline: "14 arrivals so far", reasons: [] };
  window.localStorage.clear();
});

const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("Lot board order", () => {
  it("puts the floor board right after the header, the counters below it and the evidence under the rail", () => {
    setLot();
    render(<LotSection />);
    const board = screen.getByRole("heading", { name: "On the lot right now" });
    const counters = screen.getByRole("region", { name: "Lot counters" });
    const evidence = screen.getByText("What these numbers rest on");
    expect(before(board, counters)).toBe(true);
    expect(before(counters, evidence)).toBe(true);
    expect(evidence.closest("details"), "the trust chips live inside the collapsed rail").not.toBeNull();
    expect(screen.getByText("Recent visits").closest("details"), "every other evidence panel too").not.toBeNull();
  });

  it("rows run longest first, car by plate, and say so when a plate was not read", () => {
    setLot();
    render(<LotSection />);
    const rows = within(screen.getByRole("list", { name: "Vehicles on the lot" })).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("h3")?.textContent)).toEqual(["FIX 1001", "FIX 1003", "Plate not read"]);
    expect(rows[0].textContent).toContain("customer matched");
    // admin-v1-fixtures.spec.ts counts one exact "on the property" per observed arrival.
    expect(screen.getAllByText("on the property", { exact: true })).toHaveLength(3);
  });
});

describe("walk-in quote", () => {
  it("is one tap from the header and one tap from every row, both opening the drawer", () => {
    setLot();
    const opened = vi.fn();
    window.addEventListener("admin:open-walkin-quote", opened);
    render(<LotSection />);
    // The drawer opens empty (the calculator takes no vehicle), so no button may promise a car.
    const [header, ...rowVerbs] = screen.getAllByRole("button", { name: "Quote a walk-in" });
    expect(header.className).toContain("min-h-12");
    expect(screen.queryAllByRole("button", { name: /^Quote FIX/ })).toHaveLength(0);
    fireEvent.click(header);
    expect(rowVerbs).toHaveLength(3);
    expect(rowVerbs.every((b) => b.closest("li"))).toBe(true);
    fireEvent.click(rowVerbs[0]);
    expect(opened).toHaveBeenCalledTimes(2);
    window.removeEventListener("admin:open-walkin-quote", opened);
  });
});

describe("Lot Checks rail", () => {
  it("counts a sign camera that is not watching as not healthy", () => {
    setLot({ sign: "CAMERA_OFFLINE" });
    render(<LotSection />);
    const summary = screen.getByText("Checks").closest("summary")!;
    expect(summary.textContent).toMatch(/\d+ not healthy/);
    const healthy = summary.textContent!.match(/(\d+) not healthy/)![1];
    expect(Number(healthy)).toBeGreaterThanOrEqual(1);
  });

  it("says unknown, not healthy, when camera health could not be read", () => {
    setLot();
    h.queries.set("lot.health", { data: undefined, isError: true, error: { message: "boom" } });
    render(<LotSection />);
    const summary = screen.getByText("Checks").closest("summary")!;
    expect(summary.textContent).toMatch(/unknown/i);
    expect(summary.textContent).not.toMatch(/all healthy/i);
  });

  it("is collapsed on a phone by default", () => {
    setLot();
    render(<LotSection />);
    expect(screen.getByText("Checks").closest("details")!.open).toBe(false);
  });
});

describe("honest board states survive the move", () => {
  it("a failed floor-board read is unavailable, never an empty lot", () => {
    setLot({ floor: { data: undefined, isError: true, error: { message: "timeout" } } });
    render(<LotSection />);
    expect(screen.getByText("Floor board unavailable")).toBeTruthy();
    expect(screen.queryByText("Nothing on the lot right now.")).toBeNull();
  });

  it("a car whose arrival was never observed says so on its row, not a confident clock", () => {
    setLot({ floor: { data: { ok: true, marksAvailable: false, rows: [visit("v-9", "FIX 1009", 0, { onPropertyMinutes: null, sinceFirstSeenMinutes: 40 })] } } });
    render(<LotSection />);
    const row = within(screen.getByRole("list", { name: "Vehicles on the lot" })).getByRole("listitem");
    expect(row.textContent).toContain("since first seen · arrival not observed");
    expect(row.textContent).not.toContain("on the property");
  });

  it("an empty board under a camera that is not watching says the lot is not being watched", () => {
    setLot({ sign: "CAMERA_OFFLINE", floor: { data: { ok: true, marksAvailable: false, rows: [] } } });
    render(<LotSection />);
    expect(screen.getByText(/Not being watched: the sign camera is camera offline/)).toBeTruthy();
  });
});

// ── Review round 1 ──

const summaryText = () => screen.getByText("Checks").closest("summary")!.textContent ?? "";
const PAUSED = { data: undefined, isPending: true, isError: false, fetchStatus: "paused" } as Partial<Q>;

describe("Checks summary counts every input that did not answer", () => {
  it("says all healthy only when every input answered (the positive control)", () => {
    setLot();
    render(<LotSection />);
    expect(summaryText()).toMatch(/all healthy/);
  });

  const cases: Array<[string, () => void]> = [
    ["a failed floor-board read", () => h.queries.set("lot.visits", (input) => ((input as { openOnly?: boolean }).openOnly ? { data: undefined, isError: true, error: { message: "x" } } : { data: { ok: true, rows: ON_LOT } }))],
    ["a failed hourly-activity read", () => h.queries.set("lot.activity", { data: undefined, isError: true, error: { message: "x" } })],
    ["a confidence that cannot judge", () => { h.confidence = { level: "UNKNOWN", headline: "cannot judge", reasons: [] }; }],
    ["office coverage nobody reported", () => {
      const health = h.queries.get("lot.health") as { data: { cameras: Array<{ camera: string; conversation: unknown }> } };
      health.data.cameras = health.data.cameras.map((c) => (c.camera === "office" ? { ...c, conversation: { workerOk: true, state: "READY", workerAgeSeconds: 10 } } : c));
    }],
    ["a paused (offline) counter read", () => h.queries.set("lot.now", PAUSED)],
    ["a failed camera-health read", () => h.queries.set("lot.health", { data: undefined, isError: true, error: { message: "x" } })],
  ];
  for (const [name, breakIt] of cases) {
    it(`counts ${name} as unknown, never all healthy`, () => {
      setLot();
      breakIt();
      render(<LotSection />);
      expect(summaryText()).toMatch(/1 unknown/);
      expect(summaryText()).not.toMatch(/all healthy/);
    });
  }
});

describe("the floor board stands on its own read", () => {
  it("still lists the cars when the counter read fails, and only the counters say unknown", () => {
    setLot();
    h.queries.set("lot.now", { data: undefined, isError: true, error: { message: "counters down" } });
    render(<LotSection />);
    expect(within(screen.getByRole("list", { name: "Vehicles on the lot" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Lot counters unavailable")).toBeTruthy();
  });
});

describe("a paused (offline) read is unknown, not loading", () => {
  it("counters", () => {
    setLot();
    h.queries.set("lot.now", PAUSED);
    render(<LotSection />);
    expect(screen.getByText("Lot counters unavailable")).toBeTruthy();
    expect(screen.getAllByText("Offline, not checked").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Loading lot state/)).toBeNull();
  });

  it("floor board", () => {
    setLot({ floor: PAUSED });
    render(<LotSection />);
    expect(screen.getByText("Floor board unavailable")).toBeTruthy();
    expect(screen.queryByText(/Loading vehicles on the lot/)).toBeNull();
  });
});

describe("a row never loses its warning to truncation", () => {
  it("puts needs-staff-confirm first in the detail line and keeps it behind More", () => {
    setLot({ floor: { data: { ok: true, rows: [visit("v-7", "FIX 1007", 12, { customerMatch: "CONFUSABLE_UNIQUE" })] } } });
    render(<LotSection />);
    const row = within(screen.getByRole("list", { name: "Vehicles on the lot" })).getByRole("listitem");
    expect(row.querySelector("p")!.textContent!.startsWith("needs staff confirm")).toBe(true);
    fireEvent.click(within(row).getByRole("button", { name: /More about/ }));
    const more = row.querySelector("[data-row-more]")!;
    expect(more.textContent).toContain("needs staff confirm");
    expect(more.textContent).toContain("On lot");
  });
});

describe("copy", () => {
  it("points at Checks for the commissioning toggle", () => {
    setLot();
    const now = h.queries.get("lot.now") as { data: Record<string, unknown> };
    now.data = { ...now.data, neverIngested: true, commissioningVisits: 2 };
    render(<LotSection />);
    expect(screen.getByText(/Use "Show commissioning runs" in Checks/)).toBeTruthy();
  });

  it("says marking is not set up, in plain words", () => {
    setLot();
    const now = h.queries.get("lot.now") as { data: Record<string, unknown> };
    now.data = { ...now.data, marks: { available: false, openMarked: 0, customerWaiting: 0, serviceStarted: 0, serviceDone: 0, notAJob: 0, markedShare: null } };
    render(<LotSection />);
    expect(screen.getByText("Marking cars is not set up yet.")).toBeTruthy();
    expect(screen.queryByText(/migration 0145/)).toBeNull();
  });
});
