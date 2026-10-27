/**
 * Lot page diagnostics in plain words (job 2026-10-25-admin-tabs-lot, lane nickstire-client).
 *
 * Owner surface rule: the state and the action are said in words; engine names, latency, serials and
 * command lines sit one tap deeper in a "Technical details" fold; a plane nobody has measured says
 * "not known", never a raw enum. Two things may NOT leave sight: a fault word (queue above 0, a stale or
 * stuck worker, a camera that is not working) and anything in the counting blocks (the lot-vision job
 * owns those; the control at the bottom pins today's text).
 *
 * Mounts the real LotSection with "@/lib/trpc" replaced by the proxy the other Lot tests use. jsdom
 * renders the children of a closed <details>, so "outside the fold" means "has no <details> ancestor".
 * Fixtures are synthetic: the serial below is a made-up marker, never a real camera.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isPending: boolean; isError: boolean; error: unknown; fetchStatus: string };
const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  Null: () => null,
}));
vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
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
  });
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

const ENGINE = "whisper-cli.exe --suppress-nst --no-speech-thold 0.6";
const MODEL = "ggml-base.en.bin";
const SERIAL = "T0000TEST0000";
const HOST = "MECHANICS";

const UNMEASURED = { producer: "alive", source: "connected", frames: "fresh", pose: "ok", calibration: "valid", vision: "quiet", auth: "ok", events: "unknown", control: "unknown", media: "unknown", home: "unknown", cloud: "ok" };
const ALL_OK = { ...UNMEASURED, events: "ok", control: "ok", media: "ok", home: "ok" };

const camera = (name: string, role: string, extra: Record<string, unknown> = {}) => ({
  camera: name, label: name, role, healthProfile: "always_on", state: "HEALTHY", stateForSeconds: 600, ageSeconds: 12, reason: "all planes proven", commissioned: true, registered: true,
  facets: ALL_OK, vision: { detectionsLast10m: 2 }, stability: { dropsToday: 0, transitionsToday: 0 }, conversation: null, mode: "PRODUCTION", commissioningRunId: null,
  producer: null, source: null, transport: null, cloud: null, openVisits: 2, timeline: null,
  ...extra,
});

const WORKER = {
  workerOk: true, state: "READY", workerAgeSeconds: 10, audioSource: "rtsp", captureHost: HOST, sttEngine: ENGINE, queueDepth: 0, lastTrigger: "wake_word",
  eventAgeSeconds: 120, captureAgeSeconds: 180, sttAgeSeconds: 240, postAgeSeconds: 240, summaryAgeSeconds: 300, lastCoverage: 0.86, failuresToday: 0, lastError: null,
  listeningCoverage60m: 0.9, captureSecondsLast60m: 300, capturesLast60m: 3, captureFailuresLast60m: 0, wakeTriggersLast60m: 2, transcribeBacklog: 0,
};

function visit(id: string, extra: Record<string, unknown> = {}) {
  return {
    visitId: id, camera: "lot-east", state: "WAITING", arrivedAt: iso(20), waitStartedAt: iso(20), bayEnteredAt: null,
    bayExitedAt: null, departedAt: null, bay: null, preexisting: false, entryEvidence: "visitd ENTERED_ZONE", plateStatus: "NONE",
    plateText: null, customerMatch: "NONE", estimatedFields: [], cameraPose: null, dataClass: "PRODUCTION", commissioningRunId: null,
    onPropertyMinutes: 20, sinceFirstSeenMinutes: 20, waitMinutes: 20, bayMinutes: null, open: true, marks: null, markHistory: [],
    ...extra,
  };
}

function convo(id: string, extra: Record<string, unknown> = {}) {
  return {
    episodeId: id, source: "office", cameraSerial: SERIAL, captureHost: HOST, triggerType: null, triggeredAtMs: null,
    startedAtMs: Date.now(), durationSeconds: 40, meanVolumeDb: -38.4, transcriptStatus: "DONE", transcriptError: null,
    sttEngine: ENGINE, sttModel: MODEL, sttLatencyMs: 4086, speakerCount: 2, coverage: 0.86, factCount: 1, summary: "Quote given.",
    candidateVehicleVisitId: null, candidateWorkOrderId: null, linkConfidence: null, gist: "Asked about a tire quote.",
    visual: { status: "DONE", summary: "One person at the counter.", peopleCount: 1, onBoxPeople: 1, frameCount: 3, waitingUnattended: false, review: null },
    segmentCount: 0, flagKinds: [], facts: [{ kind: "TIRE_SIZE", value: "225/65R17", evidenceText: "it's a 225 65 17", confidence: 0.9 }],
    ...extra,
  };
}

function setLot({
  office = {},
  conversation = {},
  visits = [visit("v-1")],
  rows = [convo("e-1")],
  counterTrust,
}: { office?: Record<string, unknown>; conversation?: Record<string, unknown> | null; visits?: unknown[]; rows?: unknown[]; counterTrust?: unknown } = {}) {
  h.queries.set("lot.now", {
    data: {
      ok: true, neverIngested: false, commissioningVisits: 0, truncated: false, staleSeconds: 40,
      counts: { onProperty: 2, onLotNotInBay: 2, waitingForBay: 1, inBays: 0, bayUnknown: 0, postService: 0, preexisting: 0, preexistingWaiting: 0, arrivalsToday: 3, passThroughsToday: 1, departuresToday: 1, leftWithoutBay: 0, arrivalTimeUnknown: 0 },
      waits: { oldestWaitMinutes: 12, medianMinutes: 10, p90Minutes: 12, sampleSize: 2 },
      bays: [], identity: { plateConfirmed: 0, plateAmbiguous: 0, customerExact: 0, customerConfusable: 0, customerAmbiguous: 0 },
      marks: null,
      ...(counterTrust === undefined ? {} : { counterTrust }),
    },
  });
  h.queries.set("lot.visits", { data: { ok: true, marksAvailable: false, rows: visits } });
  h.queries.set("lot.health", {
    data: {
      ok: true,
      cameras: [camera("sign", "vehicle_truth"), camera("office", "conversation", { facets: UNMEASURED, state: "UNVERIFIED_CAPABILITIES", reason: "one or more required interaction-camera planes have not been physically proven yet", conversation: conversation === null ? null : { ...WORKER, ...conversation }, ...office })],
      transitions: [], thresholds: { staleAfterSeconds: 60, offlineAfterSeconds: 120 }, windowColumnsStored: true, shopOpen: true, coverage: null,
    },
  });
  h.queries.set("lot.activity", {
    data: {
      ok: true,
      hours: Array.from({ length: 24 }, (_, hour) => ({ hour, arrivals: 0, passThroughs: 0, baselineArrivals: 0 })),
      totals: { arrivals: 3, passThroughs: 1, crossings: 4, passThroughShare: 0.25 },
      history: { priorDaysWithData: 7, days: [1, 2, 3, 4, 5, 6, 7].map((dayOffset) => ({ dayOffset, arrivals: 2, passThroughs: 0 })) },
    },
  });
  h.queries.set("lot.conversations", { data: { ok: true, conversations: rows, visualAvailable: false, wordsVisible: false } });
  h.queries.set("lot.worthKnowing", { data: { ok: true, day: "2026-10-21", items: [] } });
  h.queries.set("lot.officeDigest", { data: { ok: true, generatedAtMs: Date.now(), hours: [] } });
}

afterEach(() => {
  h.queries.clear();
  window.localStorage.clear();
});

/** The page wraps every panel in the Checks rail's own <details>, so a bare closest("details") is always true: only a "Technical details" fold counts. */
const foldOf = (el: Element): HTMLDetailsElement | null => {
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
    if (d.querySelector(":scope > summary")?.textContent === "Technical details") return d;
  }
  return null;
};
const inFold = (el: Element) => foldOf(el) !== null;
const outside = (text: string | RegExp) => screen.queryAllByText(text).filter((el) => !inFold(el));
const inside = (text: string | RegExp) => screen.queryAllByText(text).filter(inFold);

/** The one fold whose body holds `text`; asserts it starts closed, then taps its summary open. */
function openFoldWith(text: string | RegExp) {
  const fold = foldOf(inside(text)[0])!;
  expect(fold.open).toBe(false);
  const summary = fold.querySelector("summary")!;
  expect(summary.textContent).toBe("Technical details");
  fireEvent.click(summary);
  expect(fold.open).toBe(true);
  return fold;
}

describe("the listening worker line", () => {
  it("never prints the engine command line outside a fold; the opened fold holds it with the trigger and host", () => {
    setLot();
    render(<LotSection />);
    expect(outside(/whisper-cli/)).toHaveLength(0);
    expect(outside(/--no-speech-thold/)).toHaveLength(0);
    expect(outside(/wake_word/)).toHaveLength(0);
    expect(outside(new RegExp(HOST))).toHaveLength(0);
    const fold = inside(/--no-speech-thold/).map((el) => foldOf(el)!).find((d) => within(d).queryByText(/wake_word/));
    expect(fold).toBeTruthy();
    expect(fold!.open).toBe(false);
    fireEvent.click(fold!.querySelector("summary")!);
    expect(fold!.open).toBe(true);
    expect(within(fold!).getByText(new RegExp(HOST))).toBeTruthy();
  });

  it("outside the fold it reads as one sentence from the fields the page already had", () => {
    setLot();
    render(<LotSection />);
    expect(screen.getByText("Listening worker on the front-desk PC: reported 10s ago, last capture 3m ago, last transcript 4m ago, posted 4m ago, queue 0.")).toBeTruthy();
    // No second warning line while the queue is empty.
    expect(screen.queryByText(/waiting in the worker's queue/)).toBeNull();
  });

  it("a queue above 0 stays outside the fold as its own warning sentence", () => {
    setLot({ conversation: { queueDepth: 2 } });
    render(<LotSection />);
    const line = outside("2 items waiting in the worker's queue.");
    expect(line).toHaveLength(1);
    expect(line[0].className).toContain("text-amber-400");
    expect(screen.getByText(/last capture 3m ago, last transcript 4m ago, posted 4m ago, queue 2\./)).toBeTruthy();
  });

  it("a failed transcript backlog and a failure today stay outside the fold too", () => {
    setLot({ conversation: { transcribeBacklog: 3, failuresToday: 1 } });
    render(<LotSection />);
    expect(outside("3 recordings waiting to be transcribed.")).toHaveLength(1);
    expect(outside("1 failure today.")).toHaveLength(1);
  });

  it("listening that fell below a fifth of the hour is a sentence outside the fold; a healthy figure goes in the fold", () => {
    setLot({ conversation: { listeningCoverage60m: 0.08 } });
    const { unmount } = render(<LotSection />);
    const warn = outside("Listened only 8% of the last hour.");
    expect(warn).toHaveLength(1);
    expect(warn[0].className).toContain("text-amber-400");
    unmount();
    setLot({ conversation: { listeningCoverage60m: 0.9 } });
    render(<LotSection />);
    expect(outside(/Listened only/)).toHaveLength(0);
    expect(outside("90%")).toHaveLength(0);
    expect(inside("90%")).toHaveLength(1);
  });

  it("CONTROL: a worker that stopped reporting still says so outside the fold", () => {
    setLot({ conversation: { workerAgeSeconds: 6 * 3600 } });
    render(<LotSection />);
    expect(outside(/Last self-report ready, 6h ago/)).toHaveLength(1);
    expect(outside(/A worker that stopped reporting is not known to be listening/)).toHaveLength(1);
  });
});

describe("counter conversation cards", () => {
  it("keep coverage, facts, duration and people outside; the receipt rows live in the fold", () => {
    setLot();
    render(<LotSection />);
    for (const kept of ["86% covered", "1 fact", "40s clip", "2 speaker groups", "1 person seen"]) {
      expect(outside(kept), kept).toHaveLength(1);
    }
    for (const gone of [/dBFS/, /detector:/, /ggml/, /4086/, new RegExp(SERIAL), /whisper/]) {
      expect(outside(gone), String(gone)).toHaveLength(0);
    }
    const fold = openFoldWith(/4086ms/);
    for (const kept of [/-38\.4 dBFS/, "counted 1 person", new RegExp(MODEL), new RegExp(SERIAL), new RegExp(HOST), /whisper-cli/]) {
      expect(within(fold).getByText(kept), String(kept)).toBeTruthy();
    }
  });

  it("a card with no receipt fields renders no empty fold", () => {
    setLot({ rows: [convo("e-2", { meanVolumeDb: null, sttEngine: null, sttModel: null, sttLatencyMs: null, captureHost: null, cameraSerial: null, visual: null })] });
    render(<LotSection />);
    // Only the worker card's fold remains.
    expect(screen.getAllByText("Technical details")).toHaveLength(1);
  });
});

/** Every state the server can send (cameraHealth.ts CAMERA_STATES) and the words the chip must show. */
const STATES: Array<[string, string]> = [
  ["HEALTHY", "working"],
  ["STALE", "not reporting lately"],
  ["PRODUCER_OFFLINE", "offline"],
  ["CAMERA_OFFLINE", "offline"],
  ["EXPECTED_SOLAR_OFFLINE", "offline, expected on solar"],
  ["AUTH_DEGRADED", "working with problems"],
  ["EVENTS_DEGRADED", "working with problems"],
  ["CONTROL_DEGRADED", "working with problems"],
  ["MEDIA_DEGRADED", "working with problems"],
  ["PTZ_HOME_INVALID", "working with problems"],
  ["CALIBRATION_INVALID", "working with problems"],
  ["DEGRADED_VISION", "working with problems"],
  ["CLOUD_BACKLOG", "working with problems"],
  ["UNVERIFIED_CAPABILITIES", "not yet verified"],
  ["NEVER_INGESTED", "no report yet"],
  // A code the map does not know prints as the old lowercased text: nothing disappears.
  ["SOMETHING_NEW", "something new"],
];

/** The office camera card: the rounded box that holds the "Office camera" title. */
const officeCard = () => screen.getByText("Office camera").closest("div.rounded-lg") as HTMLElement;
const chipOf = (card: HTMLElement) => card.querySelector("span.rounded-full")!;

describe("Office intelligence header and camera card", () => {
  it("the subtitle says what the panel is for, without STT or truth surface", () => {
    setLot();
    render(<LotSection />);
    expect(screen.getByText("What the office camera and microphone picked up, and whether they are working")).toBeTruthy();
    expect(screen.queryByText(/STT/)).toBeNull();
    expect(screen.queryByText(/truth surface/i)).toBeNull();
    expect(screen.queryByText(/NICKS EUCLID/)).toBeNull();
  });

  it("titles the card Office camera, says which camera is not known, and words the unverified state", () => {
    setLot();
    render(<LotSection />);
    expect(screen.getByText("Which camera: not known")).toBeTruthy();
    expect(screen.queryByText(/camera identity unknown/)).toBeNull();
    expect(chipOf(officeCard()).textContent).toBe("not yet verified");
    expect(within(officeCard()).queryByText("unverified capabilities")).toBeNull();
  });

  it("names the camera when the producer reports it", () => {
    setLot({ office: { source: { type: "rtsp", generation: "gen 2", fps: null, restores: null } } });
    render(<LotSection />);
    expect(screen.getByText("Which camera: gen 2")).toBeTruthy();
  });

  it("five facets, one line each; every unknown reads not known in the facet's own tone, never as a good value", () => {
    setLot();
    render(<LotSection />);
    const line = (label: string) => screen.getByText(label, { exact: true }).parentElement!;
    expect(line("Camera feed:").textContent).toBe("Camera feed:alive");
    expect(within(line("Camera feed:")).getByText("alive").className).toContain("text-emerald-400");
    for (const label of ["Motion events:", "Video:", "Pan and tilt:", "Home position:"]) {
      const value = within(line(label)).getByText("not known");
      expect(value.className, label).toContain("text-foreground/35");
      expect(value.className, label).not.toContain("emerald");
    }
    // The camera-health panel further down still prints raw facets; this card must not.
    expect(within(officeCard()).queryByText("unknown")).toBeNull();
    expect(within(officeCard()).queryByText(/^producer$/)).toBeNull();
  });

  it("a proven plane that is down keeps the amber tone and its own word", () => {
    setLot({ office: { facets: { ...ALL_OK, events: "down" }, state: "EVENTS_DEGRADED", reason: "semantic motion/person event stream is disconnected" } });
    render(<LotSection />);
    const value = within(screen.getByText("Motion events:").parentElement!).getByText("down");
    expect(value.className).toContain("text-amber-400");
  });

  it("the physical-proof reason is a sentence an owner can follow; other reasons print as sent", () => {
    setLot();
    const { unmount } = render(<LotSection />);
    expect(within(officeCard()).getByText("Some of this camera's functions have not been checked on site yet.")).toBeTruthy();
    expect(within(officeCard()).queryByText(/physically proven/)).toBeNull();
    unmount();
    setLot({ office: { state: "STALE", reason: "last heartbeat 90s ago (stale after 60s)" } });
    render(<LotSection />);
    expect(within(officeCard()).getByText("last heartbeat 90s ago (stale after 60s)")).toBeTruthy();
  });

  for (const [state, words] of STATES) {
    it(`state chip ${state} reads "${words}"`, () => {
      setLot({ office: { state, reason: "r" } });
      render(<LotSection />);
      expect(chipOf(officeCard()).textContent).toBe(words);
    }, 20000);
  }

  it("a camera that has not been commissioned and never reported is not yet verified, not a fault word", () => {
    setLot({ office: { state: "NEVER_INGESTED", commissioned: false, reason: "r" } });
    render(<LotSection />);
    expect(chipOf(officeCard()).textContent).toBe("not yet verified");
  });

  it("an unreadable camera read says not known, never a state", () => {
    setLot();
    h.queries.set("lot.health", { data: { ok: true, cameras: [camera("sign", "vehicle_truth")], transitions: [], thresholds: { staleAfterSeconds: 60, offlineAfterSeconds: 120 }, windowColumnsStored: true, shopOpen: true, coverage: null } });
    render(<LotSection />);
    expect(within(officeCard()).getByText("Office camera runtime could not be read.")).toBeTruthy();
    expect(chipOf(officeCard()).textContent).toBe("not known");
    expect(within(officeCard()).queryByText("unknown")).toBeNull();
    // And the fault line above the summaries says the same, in the same words.
    expect(within(screen.getByRole("list", { name: "Needs attention now" })).getByText("Office camera: not known.")).toBeTruthy();
  });
});

describe("faults first inside Office intelligence", () => {
  const list = () => screen.queryByRole("list", { name: "Needs attention now" });
  const worth = () => screen.getByRole("region", { name: "Worth knowing today" });

  it("an offline camera and a stuck worker each get one line above Worth knowing today", () => {
    setLot({ office: { state: "PRODUCER_OFFLINE", reason: "last heartbeat 400s ago", facets: { ...ALL_OK, producer: "offline" } }, conversation: { state: "CAPTURING", captureAgeSeconds: 95 * 3600, workerAgeSeconds: 10 } });
    render(<LotSection />);
    // Producer offline makes the worker report not fresh, so the worker line is the not-reporting one.
    const items = within(list()!).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Office camera: offline.",
      "Listening worker: last report was capturing 10s ago, so it is not known to be listening.",
    ]);
    expect(Boolean(list()!.compareDocumentPosition(worth()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("a worker stuck in one recording is a line above the summaries", () => {
    setLot({ conversation: { state: "CAPTURING", captureAgeSeconds: 95 * 3600 } });
    render(<LotSection />);
    const items = within(list()!).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain("Listening worker: stuck in one recording for 95h, not listening.");
    expect(Boolean(list()!.compareDocumentPosition(worth()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("a worker that has not reported yet is a line, not silence", () => {
    setLot({ conversation: null });
    render(<LotSection />);
    expect(within(list()!).getByText("Listening worker: has not reported yet.")).toBeTruthy();
  });

  it("CONTROL: a camera working and a worker listening add no line", () => {
    setLot({ office: { state: "HEALTHY", facets: ALL_OK, reason: "all planes proven" } });
    render(<LotSection />);
    expect(list()).toBeNull();
  });
});

describe("Recent visits: the Why column", () => {
  const whyOf = (id: string) => {
    const cell = screen.getAllByRole("row").find((r) => r.textContent?.includes(id))!;
    return cell.querySelectorAll("td")[9];
  };

  it("translates the camera's entry codes and keeps the raw string for a code it does not know", () => {
    setLot({
      visits: [
        visit("v-a", { plateText: "AAA 111", plateStatus: "CONFIRMED", entryEvidence: "visitd ENTERED_ZONE" }),
        visit("v-b", { plateText: "BBB 222", plateStatus: "CONFIRMED", entryEvidence: "visitd ARRIVAL_CANDIDATE" }),
        visit("v-c", { plateText: "CCC 333", plateStatus: "CONFIRMED", entryEvidence: "visitd CONFIRMED_ARRIVAL" }),
        visit("v-d", { plateText: "DDD 444", plateStatus: "CONFIRMED", entryEvidence: "something_else_entirely" }),
        visit("v-e", { plateText: "EEE 555", plateStatus: "CONFIRMED", entryEvidence: null }),
      ],
    });
    render(<LotSection />);
    expect(whyOf("AAA 111").textContent).toBe("seen entering the lot");
    expect(whyOf("BBB 222").textContent).toBe("seen staying, possibly arriving");
    expect(whyOf("CCC 333").textContent).toBe("arrival confirmed");
    expect(whyOf("DDD 444").textContent).toBe("something_else_entirely");
    expect(whyOf("EEE 555").textContent).toBe("—");
    expect(screen.queryByText(/visitd/)).toBeNull();
  });

  it("says how many times were estimated, and labels the camera view", () => {
    setLot({ visits: [visit("v-a", { plateText: "AAA 111", plateStatus: "CONFIRMED", estimatedFields: ["DEPARTING", "LEFT"], cameraPose: "north-high" })] });
    render(<LotSection />);
    expect(whyOf("AAA 111").textContent).toBe("seen entering the lot · camera view north-high · 2 times estimated");
    expect(screen.queryByText(/\b2 estimated\b/)).toBeNull();
  });

  it("one estimated time is singular", () => {
    setLot({ visits: [visit("v-a", { plateText: "AAA 111", plateStatus: "CONFIRMED", estimatedFields: ["LEFT"] })] });
    render(<LotSection />);
    expect(whyOf("AAA 111").textContent).toContain("1 time estimated");
  });
});

describe("CONTROL: the counting blocks keep today's text (the lot-vision job owns them)", () => {
  it("the four car tiles, the undercounting banner and the last-camera-event chip", () => {
    setLot({
      counterTrust: {
        level: "UNDERCOUNTING", arrivals: 9, billed: 30, days: 7, fromDay: "2026-10-14", toDay: "2026-10-20",
        reason: "The camera counted 9 arrivals in the last 7 days while 30 jobs were billed. Every billed job is a car that came in, so the counter is missing cars.",
      },
    });
    render(<LotSection />);
    expect(screen.getByText("Undercounting cars")).toBeTruthy();
    for (const label of ["On property", "On lot, not in a bay", "In a bay", "Pulled out, still here"]) {
      expect(screen.getByText(`${label} (camera saw)`), label).toBeTruthy();
    }
    expect(screen.getAllByText("Arrivals today (camera saw)").length).toBeGreaterThan(0);
    expect(screen.getByText("Last camera event")).toBeTruthy();
    expect(screen.getByText(/Counts below are what the camera saw, not every car\./)).toBeTruthy();
  });
});

describe("DRIFT: the words rest on strings other code emits", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

  it("the server still sends the physical-proof reason, and the camera still writes the entry codes the map reads", () => {
    expect(read("../../../server/lib/cameraHealth.ts")).toContain("one or more required interaction-camera planes have not been physically proven yet");
    const mirror = read("../../../../../camera-bridge/visitd/shop_mirror.py");
    expect(mirror).toContain('row["entryEvidence"] = f"visitd {emission.state}"');
    expect(mirror).toContain('ARRIVAL_STATES = frozenset({"ENTERED_ZONE", "ARRIVAL_CANDIDATE", "CONFIRMED_ARRIVAL"})');
  });

  it("every state the server can send has a row in the chip table above", () => {
    const source = read("../../../server/lib/cameraHealth.ts");
    const block = source.slice(source.indexOf("const CAMERA_STATES = ["), source.indexOf("] as const;"));
    const served = [...block.matchAll(/^\s*"([A-Z_]+)",?\s*$/gm)].map((m) => m[1]);
    expect(served).toHaveLength(15);
    expect(served.filter((state) => !STATES.some(([known]) => known === state))).toEqual([]);
  });
});
