/**
 * Shop eyes and ears (job 2026-10-21-shop-eyes-ears-pro, contract eyes-ears v1).
 *
 * C1: the owner can open the words behind a conversation card; a manager sees no button. A failed or
 * refused read says so and never reads as "nothing was said".
 * C2: when lot.now's counterTrust says UNDERCOUNTING, the header, the counters and the floor board say
 * the camera is missing cars; OK, UNKNOWN or an older server without counterTrust change nothing. The
 * sign chip says when the camera software keeps restarting (producersLast60m, a lower bound).
 *
 * Mounts the real LotSection with "@/lib/trpc" replaced by the proxy the other Lot tests use, plus a
 * record of each query's input and options. lotDataConfidence is the real helper here, so the
 * counterTrust pass-through is pinned end to end.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isPending: boolean; isError: boolean; error: unknown; fetchStatus: string };
const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q> | ((input: unknown) => Partial<Q>)>(),
  calls: new Map<string, { input: unknown; opts: unknown }>(),
  Null: () => null,
}));
vi.mock("@/lib/trpc", () => {
  const query = (path: string) => (input: unknown, opts: unknown) => {
    h.calls.set(path, { input, opts });
    const set = h.queries.get(path);
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

function visit(id: string, plate: string, mins: number) {
  return {
    visitId: id, camera: "lot-east", state: "WAITING", arrivedAt: iso(mins), waitStartedAt: iso(mins), bayEnteredAt: null,
    bayExitedAt: null, departedAt: null, bay: null, preexisting: false, entryEvidence: "camera", plateStatus: "CONFIRMED",
    plateText: plate, customerMatch: "NONE", estimatedFields: [], cameraPose: null, dataClass: "PRODUCTION", commissioningRunId: null,
    onPropertyMinutes: mins, sinceFirstSeenMinutes: mins, waitMinutes: mins, bayMinutes: null, open: true, marks: null, markHistory: [],
  };
}

const camera = (name: string, role: string, extra: Record<string, unknown> = {}) => ({
  camera: name, label: name, role, healthProfile: "always_on", state: "HEALTHY", stateForSeconds: 600, ageSeconds: 12, reason: null, commissioned: true, registered: true,
  facets: { producer: "alive", source: "connected", frames: "fresh", pose: "ok", calibration: "valid", vision: "seeing", auth: "ok", events: "ok", control: "ok", media: "ok", home: "ok", cloud: "ok" },
  vision: { detectionsLast10m: 2 }, stability: { dropsToday: 0, transitionsToday: 0 }, conversation: null, mode: "PRODUCTION", commissioningRunId: null,
  producer: null, source: null, transport: null, cloud: null, openVisits: 2, timeline: null,
  ...extra,
});

const UNDER = {
  level: "UNDERCOUNTING", arrivals: 9, billed: 30, days: 7, fromDay: "2026-10-14", toDay: "2026-10-20",
  reason: "The camera counted 9 arrivals in the last 7 days while 30 jobs were billed. Every billed job is a car that came in, so the counter is missing cars.",
};

function convo(id: string, extra: Record<string, unknown> = {}) {
  return {
    episodeId: id, source: "office", cameraSerial: null, captureHost: null, triggerType: null, triggeredAtMs: null,
    startedAtMs: Date.now(), durationSeconds: 40, meanVolumeDb: null, transcriptStatus: "DONE", transcriptError: null,
    sttEngine: null, sttModel: null, sttLatencyMs: null, speakerCount: null, coverage: 0.9, factCount: 0, summary: null,
    candidateVehicleVisitId: null, candidateWorkOrderId: null, linkConfidence: null, gist: "Small talk, not about a vehicle.",
    visual: null, segmentCount: 3, ...extra,
  };
}

const SEGMENTS = [
  { start: 4.2, end: 6, text: "customer asked about tires" },
  { start: 65.4, end: 70, text: "we can look at it today" },
  { start: 71, end: 72, text: "<b>thanks</b>" },
];

function setLot({ counterTrust, staleSeconds = 40, sign = {}, wordsVisible = true, rows = [convo("e-1")], officeConversation = {}, health = {} }: {
  counterTrust?: unknown; staleSeconds?: number; sign?: Record<string, unknown>; wordsVisible?: boolean | "absent"; rows?: unknown[];
  officeConversation?: Record<string, unknown>; health?: Record<string, unknown>;
} = {}) {
  h.queries.set("lot.now", {
    data: {
      ok: true, neverIngested: false, commissioningVisits: 0, truncated: false, staleSeconds,
      counts: { onProperty: 2, onLotNotInBay: 2, waitingForBay: 1, inBays: 0, bayUnknown: 0, postService: 0, preexisting: 0, preexistingWaiting: 0, arrivalsToday: 3, passThroughsToday: 1, departuresToday: 1, leftWithoutBay: 0, arrivalTimeUnknown: 0 },
      waits: { oldestWaitMinutes: 12, medianMinutes: 10, p90Minutes: 12, sampleSize: 2 },
      bays: [], identity: { plateConfirmed: 0, plateAmbiguous: 0, customerExact: 0, customerConfusable: 0, customerAmbiguous: 0 },
      marks: null,
      ...(counterTrust === undefined ? {} : { counterTrust }),
    },
  });
  h.queries.set("lot.visits", { data: { ok: true, marksAvailable: false, rows: [visit("v-1", "FIX 1001", 20), visit("v-2", "FIX 1002", 8)] } });
  const office = {
    ...camera("office", "conversation"),
    conversation: { workerOk: true, state: "READY", workerAgeSeconds: 10, listeningCoverage60m: 0.9, capturesLast60m: 3, captureFailuresLast60m: 0, wakeTriggersLast60m: 2, transcribeBacklog: 0, ...officeConversation },
  };
  h.queries.set("lot.health", {
    data: { ok: true, cameras: [camera("sign", "vehicle_truth", sign), office], transitions: [], thresholds: { staleAfterSeconds: 60, offlineAfterSeconds: 120 }, windowColumnsStored: true, shopOpen: true, coverage: null, ...health },
  });
  h.queries.set("lot.activity", {
    data: {
      ok: true,
      hours: Array.from({ length: 24 }, (_, hour) => ({ hour, arrivals: 0, passThroughs: 0, baselineArrivals: 0 })),
      totals: { arrivals: 3, passThroughs: 1, crossings: 4, passThroughShare: 0.25 },
      history: { priorDaysWithData: 7, days: [1, 2, 3, 4, 5, 6, 7].map((dayOffset) => ({ dayOffset, arrivals: 2, passThroughs: 0 })) },
    },
  });
  h.queries.set("lot.conversations", {
    data: { ok: true, conversations: rows, visualAvailable: false, ...(wordsVisible === "absent" ? {} : { wordsVisible }) },
  });
  h.queries.set("lot.conversationTranscript", { data: { ok: true, episodeId: "e-1", durationSeconds: 80, segments: SEGMENTS, truncated: false } });
}

afterEach(() => {
  h.queries.clear();
  h.calls.clear();
  window.localStorage.clear();
});

const wordsButton = () => screen.queryByRole("button", { name: /what was said/ });

describe("a worker stuck in one recording says so (2026-10-22 17:51Z to 10-26)", () => {
  const STUCK = { state: "CAPTURING", captureAgeSeconds: 95 * 3600, listeningCoverage60m: null, capturesLast60m: 0, wakeTriggersLast60m: 0 };

  it("the 10-26 production shape: red STUCK badge, the fix in words, and the chip says not listening", () => {
    setLot({ officeConversation: STUCK });
    render(<LotSection />);
    expect(screen.getByText("stuck")).toBeTruthy();
    expect(screen.getByText(/Stuck in one recording for 95h; not listening\./).className).toContain("text-red-300");
    expect(screen.getByText("not listening · stuck 95h")).toBeTruthy();
  });

  it("CONTROL: CAPTURING for 2 minutes is a recording in progress, nothing is flagged", () => {
    setLot({ officeConversation: { ...STUCK, captureAgeSeconds: 120 } });
    render(<LotSection />);
    expect(screen.getByText("capturing")).toBeTruthy();
    expect(screen.queryByText(/Stuck in one recording/)).toBeNull();
    expect(screen.queryByText(/not listening · stuck/)).toBeNull();
  });
});

describe("C1 the owner can read what was said", () => {
  it("a closed card asks for nothing; the 48 px button opens the timed lines under the gist", () => {
    setLot();
    render(<LotSection />);
    const button = wordsButton()!;
    expect(button.textContent).toBe("Show what was said");
    expect(button.className).toContain("min-h-12");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "What was said" })).toBeNull();
    expect((h.calls.get("lot.conversationTranscript")?.opts as { enabled?: boolean }).enabled).toBe(false);
    const gist = screen.getByText("Small talk, not about a vehicle.");
    expect(Boolean(gist.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    fireEvent.click(button);
    expect(button.textContent).toBe("Hide what was said");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const call = h.calls.get("lot.conversationTranscript")!;
    expect(call.input).toEqual({ episodeId: "e-1" });
    expect(call.opts).toMatchObject({ enabled: true, staleTime: Infinity, refetchOnWindowFocus: false });
    const lines = within(screen.getByRole("list", { name: "What was said" })).getAllByRole("listitem");
    expect(lines).toHaveLength(3);
    expect(lines[0].textContent).toBe("0:04 customer asked about tires");
    expect(lines[1].textContent).toBe("1:05 we can look at it today");
    expect(screen.getByText("Machine transcript. Words can be misheard.")).toBeTruthy();
    expect(screen.queryByText(/Showing the first/)).toBeNull();

    fireEvent.click(button);
    expect(screen.queryByRole("list", { name: "What was said" })).toBeNull();
  });

  it("renders the words as text, never as markup", () => {
    setLot();
    render(<LotSection />);
    fireEvent.click(wordsButton()!);
    const last = within(screen.getByRole("list", { name: "What was said" })).getAllByRole("listitem")[2];
    expect(last.textContent).toBe("1:11 <b>thanks</b>");
    expect(last.querySelector("b")).toBeNull();
  });

  it("the owner's subtitle says the words can be read", () => {
    setLot();
    render(<LotSection />);
    expect(screen.getByText("Raw audio is never kept. Tap a conversation to read what was said; self-tests are hidden.")).toBeTruthy();
    expect(screen.queryByText(/full transcripts stay off/)).toBeNull();
  });

  const noButton: Array<[string, Parameters<typeof setLot>[0]]> = [
    ["a manager (wordsVisible false)", { wordsVisible: false }],
    ["an older server (no wordsVisible)", { wordsVisible: "absent" }],
    ["a clip transcribed silent (segmentCount 0)", { rows: [convo("e-1", { segmentCount: 0 })] }],
    ["a clip with no transcript stored (segmentCount null)", { rows: [convo("e-1", { segmentCount: null })] }],
  ];
  for (const [name, opts] of noButton) {
    it(`${name} gets no button`, () => {
      setLot(opts);
      render(<LotSection />);
      expect(screen.getByText("Small talk, not about a vehicle.")).toBeTruthy();
      expect(wordsButton()).toBeNull();
    });
  }

  it("a manager's subtitle says the words are owner-only", () => {
    setLot({ wordsVisible: false });
    render(<LotSection />);
    expect(screen.getByText("Summaries only: raw audio is never kept and the words are owner-only; self-tests are hidden.")).toBeTruthy();
  });

  it("an ok:false answer shows its reason, never no words", () => {
    setLot();
    h.queries.set("lot.conversationTranscript", { data: { ok: false, reason: "The stored transcript could not be read." } });
    render(<LotSection />);
    fireEvent.click(wordsButton()!);
    expect(screen.getByText("The stored transcript could not be read.")).toBeTruthy();
    expect(screen.queryByText(/No words were transcribed/)).toBeNull();
    expect(screen.queryByRole("list", { name: "What was said" })).toBeNull();
  });

  it("a failed read says it could not be read, never no words", () => {
    setLot();
    h.queries.set("lot.conversationTranscript", { data: undefined, isError: true, error: { message: "boom" } });
    render(<LotSection />);
    fireEvent.click(wordsButton()!);
    expect(screen.getByText("What was said could not be read: boom")).toBeTruthy();
    expect(screen.queryByText(/No words were transcribed/)).toBeNull();
  });

  it("a paused (offline) read says offline, not loading", () => {
    setLot();
    h.queries.set("lot.conversationTranscript", { data: undefined, isPending: true, fetchStatus: "paused" });
    render(<LotSection />);
    fireEvent.click(wordsButton()!);
    expect(screen.getByText("What was said could not be read: Offline, not checked")).toBeTruthy();
    expect(screen.queryByText(/Loading what was said/)).toBeNull();
  });

  it("says loading while the read is in flight", () => {
    setLot();
    h.queries.set("lot.conversationTranscript", { data: undefined, isPending: true, fetchStatus: "fetching" });
    render(<LotSection />);
    fireEvent.click(wordsButton()!);
    expect(screen.getByText(/Loading what was said/)).toBeTruthy();
  });

  it("a transcript with no lines says no words were transcribed", () => {
    setLot();
    h.queries.set("lot.conversationTranscript", { data: { ok: true, episodeId: "e-1", durationSeconds: 5, segments: [], truncated: false } });
    render(<LotSection />);
    fireEvent.click(wordsButton()!);
    expect(screen.getByText("No words were transcribed in this clip.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "What was said" })).toBeNull();
  });

  it("a truncated transcript says how many lines it shows", () => {
    setLot();
    h.queries.set("lot.conversationTranscript", { data: { ok: true, episodeId: "e-1", durationSeconds: 80, segments: SEGMENTS.slice(0, 2), truncated: true } });
    render(<LotSection />);
    fireEvent.click(wordsButton()!);
    expect(screen.getByText("Showing the first 2 lines.")).toBeTruthy();
  });
});

describe("C2 the counter says when it is missing cars", () => {
  const counters = () => screen.getByRole("region", { name: "Lot counters" });

  it("UNDERCOUNTING: header, notice, every car count, the floor board and the confidence chip say so", () => {
    setLot({ counterTrust: UNDER });
    render(<LotSection />);
    expect(screen.getByText("Undercounting cars")).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
    const notice = screen.getByText(/Counts below are what the camera saw, not every car\./);
    expect(notice.textContent).toContain(UNDER.reason);
    expect(Boolean(notice.compareDocumentPosition(counters()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    for (const label of ["On property", "On lot, not in a bay", "In a bay", "Pulled out, still here"]) {
      expect(within(counters()).getByText(`${label} (camera saw)`)).toBeTruthy();
    }
    for (const label of ["Arrivals today", "Departures today", "Left without a bay", "Arrival time unknown"]) {
      expect(screen.getAllByText(`${label} (camera saw)`).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/1 drive-by not counted \(camera saw\)/)).toBeTruthy();
    expect(screen.getByText("The camera is missing cars right now; this list is what it saw.")).toBeTruthy();
    // The cars it saw stay on the board.
    expect(within(screen.getByRole("list", { name: "Vehicles on the lot" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/Counts are not trustworthy/)).toBeTruthy();
  });

  it("UNDERCOUNTING outranks a stale feed but not a sign camera that is not watching", () => {
    setLot({ counterTrust: UNDER, staleSeconds: 900 });
    render(<LotSection />);
    expect(screen.getByText("Undercounting cars")).toBeTruthy();
  });

  it("a sign camera that is not watching keeps its own badge", () => {
    setLot({ counterTrust: UNDER, sign: { state: "CAMERA_OFFLINE" } });
    render(<LotSection />);
    expect(screen.getByText("Not watching · sign camera offline")).toBeTruthy();
    expect(screen.queryByText("Undercounting cars")).toBeNull();
  });

  const unchanged: Array<[string, unknown]> = [
    ["absent (older server)", undefined],
    ["OK", { ...UNDER, level: "OK", reason: "The camera counted 40 arrivals in the last 7 days against 30 billed jobs." }],
    ["UNKNOWN", { ...UNDER, level: "UNKNOWN", arrivals: null, billed: null, reason: "Could not read billed jobs for the last 7 days, so the counter cannot be judged." }],
  ];
  for (const [name, counterTrust] of unchanged) {
    it(`${name}: badge and counters exactly as before`, () => {
      setLot({ counterTrust });
      render(<LotSection />);
      expect(screen.getByText("Live")).toBeTruthy();
      expect(screen.queryByText("Undercounting cars")).toBeNull();
      expect(screen.queryByText(/camera saw/)).toBeNull();
      expect(screen.queryByText(/missing cars/)).toBeNull();
      expect(within(counters()).getByText("On property")).toBeTruthy();
      expect(screen.getAllByText("Arrivals today").length).toBeGreaterThan(0);
      expect(screen.queryByText(/Counts are not trustworthy/)).toBeNull();
    });
  }
});

describe("C2 the sign chip says when the camera software keeps restarting", () => {
  const signChip = () => screen.getByText("Sign camera").parentElement!;
  const summary = () => screen.getByText("Checks").closest("summary")!.textContent;

  it("5 producers in the last hour: warn, and at least 4 restarts in words", () => {
    setLot({ sign: { producersLast60m: 5 } });
    render(<LotSection />);
    expect(signChip().className).toContain("text-amber-300");
    expect(signChip().textContent).toContain(
      "camera software restarted at least 4 times in the last hour; each restart drops the cars it was tracking",
    );
    expect(signChip().textContent).toContain("2 detections in the last 10 min");
    expect(summary()).toMatch(/^Checks1 not healthy/);
  });

  it("3 is the first that counts (at least 2)", () => {
    setLot({ sign: { producersLast60m: 3 } });
    render(<LotSection />);
    expect(signChip().textContent).toContain("restarted at least 2 times");
  });

  for (const producers of [2, 0, null]) {
    it(`${producers} leaves the chip as it was`, () => {
      setLot({ sign: { producersLast60m: producers } });
      render(<LotSection />);
      expect(signChip().className).toContain("text-emerald-300");
      expect(signChip().textContent).not.toContain("restarted");
      expect(summary()).not.toMatch(/not healthy/);
    });
  }
});


describe("the headline says what the counter is doing, not only the camera (job 2026-10-26-lot-vision-v2)", () => {
  const ELEVEN_AM = Date.UTC(2026, 9, 8, 15, 0, 0); // 11:00 EDT

  it("the 10-24 silent zero: healthy, seeing, none counted. The headline says not counting, never Live", () => {
    setLot({ health: { signCounting: { state: "NOT_COUNTING", reason: "x", watchedSinceMs: ELEVEN_AM } } });
    render(<LotSection />);
    expect(screen.getByText("Not counting · sees cars, none counted since 11:00 AM")).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
  });

  for (const [name, signCounting] of [
    ["COUNTING", { state: "COUNTING", reason: "2 car(s) counted since 11:00", watchedSinceMs: ELEVEN_AM }],
    ["NOT_JUDGED", { state: "NOT_JUDGED", reason: "under 3 hours watched", watchedSinceMs: ELEVEN_AM }],
    ["absent (older server)", undefined],
  ] as const) {
    it(`${name}: Live as before`, () => {
      setLot({ health: signCounting === undefined ? {} : { signCounting } });
      render(<LotSection />);
      expect(screen.getByText("Live")).toBeTruthy();
      expect(screen.queryByText(/Not counting/)).toBeNull();
    });
  }

  it("a failed arrivals read is counting unknown, never Live (Codex on #3318)", () => {
    setLot({ health: { signCounting: { state: "NOT_JUDGED", reason: "arrivals read failed: timeout", watchedSinceMs: null, readFailed: true } } });
    render(<LotSection />);
    expect(screen.getByText("Counting unknown · arrivals could not be read")).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("never ingested but healthy and seeing for 3 h: not counting wins over awaiting first event (Codex on #3318)", () => {
    setLot({ health: { signCounting: { state: "NOT_COUNTING", reason: "x", watchedSinceMs: ELEVEN_AM, readFailed: false } } });
    const now = h.queries.get("lot.now") as { data: Record<string, unknown> };
    h.queries.set("lot.now", { data: { ...now.data, neverIngested: true } });
    render(<LotSection />);
    expect(screen.getByText("Not counting · sees cars, none counted since 11:00 AM")).toBeTruthy();
    expect(screen.queryByText("Awaiting first event")).toBeNull();
  });

  it("the solar camera at night: asleep until about its wake time, never a zero", () => {
    const WAKE = Date.UTC(2026, 9, 8, 14, 5, 0); // 10:05 EDT
    setLot({
      sign: { state: "EXPECTED_SOLAR_OFFLINE", facets: { ...camera("sign", "vehicle_truth").facets, frames: "stale" } },
      health: { shopOpen: false, signSolar: { expectedOffline: true, untilMs: WAKE } },
    });
    render(<LotSection />);
    expect(screen.getByText("Not watching · camera asleep until about 10:05 AM")).toBeTruthy();
  });

  it("an older server with no wake time keeps the old solar words", () => {
    setLot({ sign: { state: "EXPECTED_SOLAR_OFFLINE" }, health: { shopOpen: false } });
    render(<LotSection />);
    expect(screen.getByText("Not watching · sign dark (solar night)")).toBeTruthy();
  });

  it("the detector figure is detections, not cars: a parked car is detected again in every frame", () => {
    setLot({ sign: { vision: { ...camera("sign", "vehicle_truth").vision, detectionsLast10m: 96 } } });
    render(<LotSection />);
    const chip = screen.getByText("Sign camera").parentElement!;
    expect(chip.textContent).toContain("96 detections in the last 10 min");
    expect(chip.textContent).toContain("not a car count");
    expect(chip.textContent).not.toMatch(/saw \d+ vehicle/);
    // The camera card says the same thing in its own words.
    expect(document.body.textContent).toContain("96 detections in 10m");
    expect(document.body.textContent).not.toMatch(/saw \d+ vehicles? in 10m/);
  });
});
