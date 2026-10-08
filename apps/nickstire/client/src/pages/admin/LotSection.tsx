/**
 * LotSection — live camera visit truth for the shop floor.
 *
 * Product boundary (ADR-0017, refined 2026-09-09): shop operations live here in
 * nickstire.org/admin. StateNour is the owner's OS and receives summaries and
 * anomalies, not the operational cockpit.
 *
 * The single rule this screen is built around: **a failed read must never render
 * as a confident zero.** "0 cars on the lot" and "the query threw" look identical
 * on a dashboard and mean opposite things.
 *
 * That takes FOUR states per surface, not two, and the first version of this file
 * only had two. It discriminated on `data.ok` and handled neither `isError` nor
 * `isPending`, so a rejected query (the app sets `retry: 0`) fell through every
 * branch: the header rendered a green "Live" badge, the health panel rendered an
 * empty div, and the visits panel rendered a table of headers with no rows — which
 * reads exactly like "no visits". The order below is the repo's canonical one, the
 * same as MarketSection: **isError → isPending → no data → empty → data.**
 *
 * Freshness is treated the same way: a null `staleSeconds` means "we could not
 * establish freshness", which is UNKNOWN, not live.
 *
 * THE FLOOR BOARD (added 2026-09-09). The counters answer "how many"; nothing here
 * answered the question the person on the floor actually asks, which is **"how long
 * has THAT car been sitting there?"** `FloorCard` renders one card per vehicle still
 * on the property, ordered longest-first, because the longest wait is the one about
 * to become a complaint. Every duration is computed in SQL (lot.ts `minutesBetween`):
 * subtracting driver-parsed TiDB datetimes in JS is wrong by the UTC offset, and it
 * would be wrong in exactly the number an operator acts on.
 *
 * Between polls the OPEN durations tick client-side from `dataUpdatedAt`. That is
 * wall-clock elapsed since we asked, added to a server number — not a re-derivation
 * of a database timestamp. It is applied only while an interval is open: a departed
 * car's stay is a fact, and a fact that grows while you watch it is a bug.
 *
 * Data: trpc.lot.now + trpc.lot.visits + trpc.lot.health + trpc.lot.conversations, polled every 15s.
 */
import { useEffect, useState } from "react";

import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { summarizeCameraFleet, WORKER_STALE_AFTER_SECONDS } from "@shared/cameraFleetHealth";
import { lotDataConfidence, type LotConfidence } from "@shared/lotDataConfidence";
import { localClock } from "@shared/shopState";
import { PageHeader, StatCard, Panel, MetricGrid, EmptyState } from "./shared";
// Durations live in shared/format.ts, with the "these take SQL-computed MINUTES,
// never timestamps" contract documented next to them.
import { formatDuration, advanceOpenDuration } from "./shared/format";
import CommissioningPanel from "./CommissioningPanel";
import {
  Car,
  Clock,
  Wrench,
  LogOut,
  AlertTriangle,
  Camera,
  ParkingSquare,
  ShieldQuestion,
  HelpCircle,
  Hourglass,
  MessageSquare,
  Eye,
} from "lucide-react";

const POLL_MS = 15_000;
/** The floor board reads every OPEN visit up to this many; past it the strip says "N more". */
const FLOOR_BOARD_LIMIT = 200;
/** How often the open-visit clocks re-render between polls. */
const TICK_MS = 10_000;

/** Minutes on the property past which a wait is worth an operator's attention. */
const ATTENTION_MINUTES = 30;
/** Past this, it is a problem, not a wait. */
const URGENT_MINUTES = 60;

function stamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const day = d.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  // A bare clock time on a table with no date filter makes a week-old row look like
  // this morning's, so anything not from today carries its date.
  return day === today ? time : `${day} ${time}`;
}

/** Re-render on an interval so open clocks advance between polls. */
function useTick(ms: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

function dwellTone(m: number | null): string {
  if (m === null) return "text-foreground/50";
  if (m >= URGENT_MINUTES) return "text-red-400";
  if (m >= ATTENTION_MINUTES) return "text-amber-400";
  return "text-emerald-400";
}

/** A read that FAILED. Never silently replaced by zeros or an empty list. */
function Unknown({ what, reason }: { what: string; reason?: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <div className="font-semibold text-red-400">{what} unavailable</div>
          {reason && <div className="text-foreground/70 mt-0.5">{reason}</div>}
          <div className="text-foreground/50 mt-1">
            This is not an empty lot. The data could not be read.
          </div>
        </div>
      </div>
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <div className="text-[13px] text-foreground/50">Loading {what}…</div>;
}

/** Shape of `lot.activity`'s success payload. `baselineArrivals` is null when no earlier
 *  day reported -- absence of history, which must not be drawn as a flat zero line. */
type ActivityData = {
  hours: Array<{ hour: number; arrivals: number; passThroughs: number; baselineArrivals: number | null }>;
  totals: { arrivals: number; passThroughs: number; crossings: number; passThroughShare: number | null };
  history: { priorDaysWithData: number; days: Array<{ dayOffset: number; arrivals: number; passThroughs: number }> };
};

type VisitRow = {
  visitId: string;
  camera: string;
  state: string;
  arrivedAt: string | null;
  waitStartedAt: string | null;
  bayEnteredAt: string | null;
  bayExitedAt: string | null;
  departedAt: string | null;
  bay: string | null;
  preexisting: boolean;
  entryEvidence: string | null;
  plateStatus: string;
  plateText: string | null;
  customerMatch: string;
  estimatedFields: string[];
  cameraPose: string | null;
  dataClass: string;
  commissioningRunId: string | null;
  onPropertyMinutes: number | null;
  sinceFirstSeenMinutes: number | null;
  waitMinutes: number | null;
  bayMinutes: number | null;
  open: boolean;
};

type ConversationRow = {
  episodeId: string;
  source: string;
  cameraSerial: string | null;
  captureHost: string | null;
  triggerType: string | null;
  triggeredAtMs: number | null;
  startedAtMs: number | null;
  durationSeconds: number | null;
  meanVolumeDb: number | null;
  transcriptStatus: string;
  transcriptError: string | null;
  sttEngine: string | null;
  sttModel: string | null;
  sttLatencyMs: number | null;
  speakerCount: number | null;
  coverage: number | null;
  factCount: number;
  summary: string | null;
  candidateVehicleVisitId: string | null;
  candidateWorkOrderId: string | null;
  linkConfidence: number | null;
  /** One sentence on what the conversation was about (migration 0141). Absent on older servers. */
  gist?: string | null;
  /** What the office camera saw (migration 0140). Absent on older servers, null when no frames were sent. */
  visual?: {
    status: "DONE" | "FAILED";
    summary: string | null;
    peopleCount: number | null;
    activities: string[];
    waitingUnattended: boolean | null;
    frameCount: number;
    error: string | null;
    /** Max persons the shop-PC detector counted in one frame; null = not measured. */
    onBoxPeople?: number | null;
    review?: { verdict: "correct" | "wrong"; note: string | null; at: string } | null;
  } | null;
};

/**
 * Right / Wrong on a "Saw:" line. A review becomes a calibration note in the next vision prompt
 * (server/services/officeVisual.ts), so this is how the office camera learns this shop.
 * In-DOM correction field, never window.prompt (suppressed in the iOS PWA).
 */
function VisualReview({
  episodeId,
  review,
  onSaved,
}: {
  episodeId: string;
  review: { verdict: "correct" | "wrong"; note: string | null } | null | undefined;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = trpc.lot.reviewConversationVisual.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        setEditing(false);
        setError(null);
        onSaved();
      } else {
        setError(r.reason);
      }
    },
    onError: (e) => setError(e.message),
  });

  if (review && !editing) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground/50">
        <span>
          {review.verdict === "correct" ? "You confirmed this." : "You marked this wrong"}
          {review.verdict === "wrong" && review.note ? `: ${review.note}` : review.verdict === "wrong" ? "." : ""}
        </span>
        <button
          type="button"
          className="min-h-12 rounded-md px-3 text-foreground/60 underline active:scale-95"
          onClick={() => setEditing(true)}
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={save.isPending}
          className="min-h-12 min-w-12 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 text-[12px] text-emerald-300 active:scale-95 disabled:opacity-50"
          onClick={() => save.mutate({ episodeId, verdict: "correct" })}
        >
          Right
        </button>
        <button
          type="button"
          disabled={save.isPending}
          className="min-h-12 min-w-12 rounded-md border border-red-500/30 bg-red-500/10 px-3 text-[12px] text-red-300 active:scale-95 disabled:opacity-50"
          onClick={() => setEditing(true)}
        >
          Wrong
        </button>
      </div>
      {editing && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What actually happened? (optional)"
            className="min-h-12 rounded-md border border-foreground/15 bg-transparent px-3 text-[13px]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={save.isPending}
              className="min-h-12 rounded-md border border-foreground/20 px-3 text-[12px] active:scale-95 disabled:opacity-50"
              onClick={() => save.mutate({ episodeId, verdict: "wrong", note: note.trim() || null })}
            >
              Save correction
            </button>
            <button
              type="button"
              className="min-h-12 rounded-md px-3 text-[12px] text-foreground/50 active:scale-95"
              onClick={() => { setEditing(false); setError(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-[11px] text-red-300">Not saved: {error}</div>}
    </div>
  );
}

type CameraFacets = {
  producer: string;
  source: string;
  frames: string;
  pose: string;
  calibration: string;
  /** seeing | blind | quiet | unknown | not_required -- what the detector SAW, not whether it ran. */
  vision: string;
  auth: string;
  events: string;
  control: string;
  media: string;
  home: string;
  cloud: string;
};

type CameraHealth = {
  camera: string;
  label: string;
  role: string;
  healthProfile: "fixed_geometry" | "interaction_ptz";
  commissioned: boolean;
  registered: boolean;
  state: string;
  facets: CameraFacets;
  reason: string;
  ageSeconds: number | null;
  stateForSeconds: number | null;
  mode: string | null;
  commissioningRunId: string | null;
  producer: { instanceId: string; version: string | null; gitSha: string | null; heartbeatSeq: number } | null;
  source: { type: string | null; generation: string | null; fps: number | null; restores: number | null } | null;
  vision: { detector: string | null; modelSha256: string | null; inferenceP95Ms: number | null; inferenceAgeSeconds: number | null; poseDelta: number | null; calibrationVersion: string | null; relocateFailures: number | null; preexistingCrossed: number | null; arrivalsAfterStitch: number | null; stitchedTotal: number | null; stitchRefusedAmbiguous: number | null; detectionsLast10m: number | null; portalCrossingsLast60m: number | null } | null;
  transport: { eventProofAgeSeconds: number | null; controlProofAgeSeconds: number | null; mediaProofAgeSeconds: number | null; ptzNotifyAgeSeconds: number | null } | null;
  conversation: {
    workerOk: boolean | null;
    state: string | null;
    workerAgeSeconds: number | null;
    audioSource: string | null;
    captureHost: string | null;
    sttEngine: string | null;
    queueDepth: number | null;
    lastTrigger: string | null;
    eventAgeSeconds: number | null;
    captureAgeSeconds: number | null;
    sttAgeSeconds: number | null;
    postAgeSeconds: number | null;
    summaryAgeSeconds: number | null;
    lastCoverage: number | null;
    failuresToday: number | null;
    lastError: string | null;
    /** Listening over the last hour (0144); null until the migration is applied and the worker reports. */
    listeningCoverage60m: number | null;
    captureSecondsLast60m: number | null;
    capturesLast60m: number | null;
    captureFailuresLast60m: number | null;
    wakeTriggersLast60m: number | null;
    transcribeBacklog: number | null;
  } | null;
  cloud: { outboxDepth: number | null; oldestOutboxAgeSeconds: number | null; deadLetterDepth: number | null; cloudAckAgeSeconds: number | null; diskFreeBytes: number | null } | null;
  /** Null when no health event was recorded for this camera today -- which is NOT the same
   *  as a steady day, and must not render as one. */
  stability: { dropsToday: number; transitionsToday: number } | null;
  openVisits: number;
};

/** Seconds -> "12s" / "4m" / "2h"; null -> em dash. Never "0s" for unknown. */
function formatAgo(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

/** Headline tone per state. Colour AND wording carry the meaning; colour alone never does. */
function stateTone(state: string, commissioned: boolean): string {
  switch (state) {
    case "HEALTHY":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "STALE":
    case "UNVERIFIED_CAPABILITIES":
    case "PTZ_HOME_INVALID":
    case "CALIBRATION_INVALID":
    case "DEGRADED_VISION":
    case "CLOUD_BACKLOG":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "PRODUCER_OFFLINE":
    case "CAMERA_OFFLINE":
    case "AUTH_DEGRADED":
    case "EVENTS_DEGRADED":
    case "CONTROL_DEGRADED":
    case "MEDIA_DEGRADED":
      return "border-red-500/40 bg-red-500/10 text-red-300";
    default:
      // NEVER_INGESTED: a fault for a commissioned camera, an expectation for a planned one.
      return commissioned
        ? "border-foreground/20 bg-foreground/5 text-foreground/70"
        : "border-foreground/10 bg-foreground/5 text-foreground/40";
  }
}

/** One dimension of the lattice. `good` values read calm; the rest read as attention. */
function facetTone(value: string): string {
  if (["alive", "connected", "fresh", "ok", "valid", "seeing"].includes(value)) return "text-emerald-400/80";
  // `quiet` is "saw nothing, and nothing says it should have": not a fault, not a proof.
  if (["unknown", "never", "not_required", "quiet"].includes(value)) return "text-foreground/35";
  return "text-amber-400";
}

/**
 * Whether a worker's self-report is about NOW. The office worker writes its status every
 * ~30 s and the agent relays it on every heartbeat; a READY that is hours old was written by a
 * process that has since hung (2026-10-05/06), and the agent kept relaying it.
 */
function workerReportFresh(camera: CameraHealth | null): boolean {
  const runtime = camera?.conversation ?? null;
  return (
    camera !== null &&
    camera.facets.producer === "alive" &&
    typeof runtime?.workerAgeSeconds === "number" &&
    runtime.workerAgeSeconds <= WORKER_STALE_AFTER_SECONDS
  );
}

type ChipTone = "ok" | "warn" | "bad" | "muted";

const CHIP_TONE: Record<ChipTone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  bad: "border-red-500/30 bg-red-500/10 text-red-300",
  muted: "border-foreground/15 bg-foreground/5 text-foreground/55",
};

/** One fact on the trust strip: a label, a short value, and a tone that never carries the meaning alone. */
function TrustChip({ label, value, tone, detail }: { label: string; value: string; tone: ChipTone; detail?: string | null }) {
  return (
    <div className={`rounded-lg border px-3 py-2 min-w-0 ${CHIP_TONE[tone]}`} title={detail ?? undefined}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-[12px] font-medium leading-snug break-words">{value}</div>
      {detail && <div className="mt-0.5 text-[11px] opacity-75 leading-snug break-words">{detail}</div>}
    </div>
  );
}

function CameraCard({ c }: { c: CameraHealth }) {
  const stateLabel = c.state.replace(/_/g, " ").toLowerCase();
  const facets: Array<[string, string]> = [
    ["producer", c.facets.producer],
    ["source", c.facets.source],
    ["frames", c.facets.frames],
    ["pose", c.facets.pose],
    ["calibration", c.facets.calibration],
    ["vision", c.facets.vision],
    ["auth", c.facets.auth],
    ["events", c.facets.events],
    ["control", c.facets.control],
    ["media", c.facets.media],
    ["home", c.facets.home],
    ["cloud", c.facets.cloud],
  ].filter(([, value]) => value !== "not_required") as Array<[string, string]>;
  /**
   * Everything except `producer` is the producer's own last SELF-REPORT, and it is only a
   * statement about NOW while the producer is still alive. `deriveCameraState` computes
   * frame age on the producer's clock at the instant it sent that heartbeat, so a box that
   * died six hours ago keeps reporting "frames fresh · pose ok · cloud ok" -- true when it
   * was said, and read as present tense on the card.
   *
   * Observed in production 2026-09-10: the `sign` card showed exactly that beside
   * "producer offline for 6h", which invites "everything is fine except the heartbeat"
   * when the truth is that NOTHING is currently known. The facets are not wrong; rendering
   * them undated was. Marked as last-known and dimmed whenever the producer is not alive.
   */
  const producerAlive = c.facets.producer === "alive";
  return (
    <div className={`rounded-lg border p-3 ${c.registered ? "border-foreground/10" : "border-amber-500/30"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold truncate">{c.label}</div>
          <div className="text-[12px] text-foreground/50 truncate">
            {c.camera}
            <span className="ml-2 rounded border border-foreground/15 px-1 py-px text-[10px] uppercase tracking-wide text-foreground/45">
              {c.role.replace(/_/g, " ")}
            </span>
            {c.mode && c.mode !== "PRODUCTION" && (
              <span className="ml-2 rounded border border-sky-500/40 bg-sky-500/10 px-1 py-px text-[10px] uppercase tracking-wide text-sky-300">
                {c.mode.toLowerCase()}
                {c.commissioningRunId ? ` · ${c.commissioningRunId}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${stateTone(c.state, c.commissioned)}`}>
            {c.state === "NEVER_INGESTED" && !c.commissioned ? "not commissioned yet" : stateLabel}
          </span>
          {/* TODAY'S RECORD, beside the badge that only knows about NOW.
              The badge above said "healthy" all morning on 2026-09-18 while this camera
              dropped 17 times, because whoever looked happened to look during an up phase.
              A steady source and a flapping one are indistinguishable from a single glance,
              and the count is the only thing on this card that can tell them apart. */}
          {c.stability !== null && c.state !== "NEVER_INGESTED" && (
            <span
              className={`text-[10px] ${c.stability.dropsToday === 0 ? "text-foreground/40" : "text-amber-400/80"}`}
              title={`${c.stability.transitionsToday} state change(s) recorded today, of which ${c.stability.dropsToday} left the camera unusable. A drop is any move to offline, degraded, stale or calibration-invalid; returning to healthy is not counted.`}
            >
              {c.stability.dropsToday === 0
                ? "steady today"
                : `${c.stability.dropsToday} drop${c.stability.dropsToday === 1 ? "" : "s"} today`}
            </span>
          )}
        </div>
      </div>

      {c.state !== "NEVER_INGESTED" && (
        <>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {!producerAlive && (
              <span className="rounded border border-foreground/20 px-1 py-px text-[10px] uppercase tracking-wide text-foreground/50">
                last known
              </span>
            )}
            {facets.map(([k, v]) => (
              <span key={k} className={producerAlive ? "text-foreground/45" : "text-foreground/30"}>
                {k}{" "}
                {/* Only `producer` is measured HERE, from heartbeat age; the rest are the
                    producer's own self-report and stop being present-tense the moment it
                    stops reporting. Colour is dropped on those so a dead box cannot show a
                    row of reassuring greens. */}
                <span className={producerAlive || k === "producer" ? facetTone(v) : "text-foreground/40"}>
                  {v.replace(/_/g, " ")}
                </span>
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-foreground/60 tabular-nums">
            <span>heartbeat {formatAgo(c.ageSeconds)} ago</span>
            {c.stateForSeconds !== null && <span>{stateLabel} for {formatAgo(c.stateForSeconds)}</span>}
            {c.source?.type && (
              <span>
                {c.source.type}
                {c.source.generation ? ` · gen ${c.source.generation}` : ""}
                {c.source.fps !== null ? ` · ${c.source.fps.toFixed(1)} fps` : ""}
              </span>
            )}
            {c.vision?.detector && <span>{c.vision.detector}</span>}
            {c.vision?.calibrationVersion && <span>cal {c.vision.calibrationVersion}</span>}
            {/*
              These two were stored, typed and never rendered: the producer sent nothing, so
              the card had nothing to show, and once the producer started sending them the
              card still showed nothing. A field that survives that round trip unnoticed is
              one nobody was ever going to miss, which is why it needs to be on the screen.

              An inference AGE, not a timestamp -- "how long since the detector last ran" is
              the only question anyone asks of it. It goes stale by design on a quiet lot,
              because the motion gate is a decision NOT to infer, so a stale reading here is
              not a fault on its own; what it separates is a producer that has stopped
              inferring from one watching an empty lot, once the lot has had any traffic.
            */}
            {typeof c.vision?.inferenceP95Ms === "number" && (
              <span>p95 {Math.round(c.vision.inferenceP95Ms)}ms</span>
            )}
            {typeof c.vision?.inferenceAgeSeconds === "number" && (
              <span>
                inferred {c.vision.inferenceAgeSeconds < 90
                  ? `${Math.max(0, Math.round(c.vision.inferenceAgeSeconds))}s ago`
                  : `${Math.round(c.vision.inferenceAgeSeconds / 60)}m ago`}
              </span>
            )}
            {/*
              What the detector SAW (0144), beside how recently it ran. "inferred 4s ago" was
              true all through 2026-10-05 while the lane counted 4 arrivals on a 40-car day;
              these two numbers are the ones that would have said so. 0 is a real reading and
              is shown; NULL (a pre-0144 edge) says nothing rather than claiming a zero.
            */}
            {typeof c.vision?.detectionsLast10m === "number" && (
              <span className={c.facets.vision === "blind" ? "text-amber-400" : undefined}>
                saw {c.vision.detectionsLast10m} vehicle{c.vision.detectionsLast10m === 1 ? "" : "s"} in 10m
              </span>
            )}
            {typeof c.vision?.portalCrossingsLast60m === "number" && (
              <span className={c.facets.vision === "blind" ? "text-amber-400" : undefined}>
                {c.vision.portalCrossingsLast60m} crossing{c.vision.portalCrossingsLast60m === 1 ? "" : "s"} in 60m
              </span>
            )}
            {/*
              BOTH ONLY WHEN NON-ZERO, and both amber. They are faults, not statistics: a
              healthy producer reports 0 for each all day, and a row that carried "geometry
              unconfirmed 0x" on every camera forever would be read past within a week.
              `> 0` also means NULL never renders -- a producer that does not report the
              counter says nothing here, rather than claiming a zero nobody measured.
            */}
            {typeof c.vision?.relocateFailures === "number" && c.vision.relocateFailures > 0 && (
              <span className="text-amber-400" title="Revalidation passes that produced no binding. The producer is still warping frames through geometry it can no longer confirm.">
                geometry unconfirmed {c.vision.relocateFailures}×
              </span>
            )}
            {/*
              Stitch counters. BOTH numbers or neither: a stitcher that never fires and one
              that merges everything are indistinguishable from successes alone, and they
              need opposite fixes. `typeof === "number"` rather than a truthiness check --
              0 is a real reading here ("it ran and folded nothing"), not absence, and NULL
              means a producer that predates the stitcher never reported.
            */}
            {typeof c.vision?.stitchedTotal === "number" && (
              <div className="text-xs text-slate-400">
                stitched {c.vision.stitchedTotal}
                {typeof c.vision.stitchRefusedAmbiguous === "number" && (
                  <> · too close to call {c.vision.stitchRefusedAmbiguous}</>
                )}
                {typeof c.vision.arrivalsAfterStitch === "number" && (
                  <> · arrivals de-duplicated {c.vision.arrivalsAfterStitch}</>
                )}
              </div>
            )}
            {typeof c.vision?.preexistingCrossed === "number" && c.vision.preexistingCrossed > 0 && (
              <span className="text-amber-400" title="Cars the census called already-there that the entry portal then watched drive in. Their arrivals were never counted.">
                missed arrivals {c.vision.preexistingCrossed}
              </span>
            )}
            {typeof c.transport?.eventProofAgeSeconds === "number" && (
              <span>event proof {formatAgo(c.transport.eventProofAgeSeconds)} ago</span>
            )}
            {typeof c.transport?.controlProofAgeSeconds === "number" && (
              <span>control proof {formatAgo(c.transport.controlProofAgeSeconds)} ago</span>
            )}
            {typeof c.transport?.mediaProofAgeSeconds === "number" && (
              <span>media proof {formatAgo(c.transport.mediaProofAgeSeconds)} ago</span>
            )}
            {typeof c.transport?.ptzNotifyAgeSeconds === "number" && (
              <span>PTZ receipt {formatAgo(c.transport.ptzNotifyAgeSeconds)} ago</span>
            )}
            {c.cloud && c.cloud.outboxDepth !== null && <span>outbox {c.cloud.outboxDepth}</span>}
            {c.source && c.source.restores !== null && c.source.restores > 0 && (
              <span className="text-amber-400">window restored {c.source.restores}×</span>
            )}
            {c.openVisits > 0 && <span>{c.openVisits} open</span>}
            {c.producer && (
              <span className="text-foreground/40">
                seq {c.producer.heartbeatSeq}
                {/* NO hardcoded "v". Neither producer sends a bare semver: run_live sends
                    "vision.run_live" and edge_main sends "edge 2.1.2", so the prefix
                    rendered "vvision.run_live" and "vedge 2.1.2" in production. The field
                    is a self-describing name; print what was sent. */}
                {c.producer.version ? ` · ${c.producer.version}` : ""}
              </span>
            )}
          </div>
          {c.state !== "HEALTHY" && <div className="mt-1.5 text-[12px] text-foreground/60">{c.reason}</div>}
        </>
      )}
      {c.state === "NEVER_INGESTED" && c.commissioned && (
        <div className="mt-1.5 text-[12px] text-foreground/50">
          No producer has ever reported for this camera. Start the edge with the shop ingest configured; this card turns live on its first heartbeat.
        </div>
      )}
    </div>
  );
}

type Stage = { label: string; tone: string };

/**
 * Where a vehicle is, derived only from timestamps the camera actually observed.
 *
 * A non-bay car is deliberately NOT called "waiting": Nick's does tire changes, plugs
 * and other jack work wherever necessary outside. Geometry can prove "no bay observed";
 * it cannot prove whether the car is queueing or being serviced where it stands.
 */
function stageOf(v: VisitRow): Stage {
  if (v.bayEnteredAt && !v.bayExitedAt) {
    return {
      label: v.bay ? `Inside service · ${v.bay}` : "Inside service",
      tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    };
  }
  if (v.bayExitedAt && !v.departedAt) {
    return {
      label: "Pulled out · still here",
      tone: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    };
  }
  if (v.departedAt) {
    return {
      label: v.bayEnteredAt ? "Left after inside service" : "Left · no bay observed",
      tone: "bg-foreground/10 text-foreground/55 border-foreground/20",
    };
  }
  if (v.preexisting) {
    return {
      label: "Already parked",
      tone: "bg-foreground/10 text-foreground/60 border-foreground/20",
    };
  }
  return {
    label: "On lot · no bay observed",
    tone: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  };
}

/**
 * One vehicle. The number the floor needs is the biggest thing on the card; every
 * other element exists to qualify it.
 */
/**
 * WHEN the lot is busy, drawn from `lot.activity`.
 *
 * Every other panel on this screen is a scalar for "now" or "today", which cannot answer
 * the question the shop actually asks: when do cars come in, and is this morning unusual.
 *
 * THREE HONESTY RULES, each of which a prettier chart would break:
 *
 *  1. A DAY WITH NO ROWS IS NOT A QUIET DAY. The baseline is averaged over days that
 *     actually reported and is labelled with that count; with none, it is not drawn at
 *     all rather than drawn flat at zero. The producer has been up for hours, not weeks.
 *  2. THE SHARE NEVER SHIPS WITHOUT ITS DENOMINATOR. "8% drive-by" off three cars is
 *     noise wearing a percentage, so the crossing count sits next to it.
 *  3. THE HOUR RANGE IS DERIVED, NOT ASSUMED. Hard-coding "business hours" would hide
 *     an arrival at 6am -- exactly the finding worth having. The window spans the hours
 *     that carry data, widened to a readable minimum.
 */
function ActivityPanel({ a }: { a: ActivityData }) {
  const hours = a.hours;
  const active = hours.filter((h) => h.arrivals > 0 || h.passThroughs > 0 || (h.baselineArrivals ?? 0) > 0);
  // Derived window. With no data at all, fall back to a mid-day span so the axis still
  // reads as a day rather than collapsing to a single ambiguous column.
  const first = active.length ? Math.min(...active.map((h) => h.hour)) : 8;
  const last = active.length ? Math.max(...active.map((h) => h.hour)) : 17;
  const pad = Math.max(0, Math.ceil((6 - (last - first)) / 2));
  const from = Math.max(0, first - pad);
  const to = Math.min(23, Math.max(last + pad, from + 5));
  const window = hours.slice(from, to + 1);

  const peak = Math.max(1, ...window.map((h) => h.arrivals + h.passThroughs), ...window.map((h) => h.baselineArrivals ?? 0));
  const label = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
  const pct = (v: number) => `${Math.round((v / peak) * 100)}%`;

  const share = a.totals.passThroughShare;
  const busiest = window.reduce((b, h) => (h.arrivals > b.arrivals ? h : b), window[0]);

  return (
    <Panel
      title="When the lot is busy"
      icon={<Clock className="w-4 h-4" />}
      subtitle={
        a.history.priorDaysWithData === 0
          ? "Today by the hour. No earlier day has reported yet, so there is nothing to compare against."
          : `Today by the hour, against the average of the ${a.history.priorDaysWithData} earlier day${a.history.priorDaysWithData === 1 ? "" : "s"} that reported.`
      }
    >
      <MetricGrid cols={3}>
        <StatCard
          label="Arrivals today"
          value={a.totals.arrivals}
          icon={<Car className="w-4 h-4" />}
          color="text-emerald-400"
          trendLabel="cars that stayed"
        />
        <StatCard
          label="Drive-bys today"
          value={a.totals.passThroughs}
          icon={<LogOut className="w-4 h-4" />}
          color={a.totals.passThroughs > 0 ? "text-amber-400" : "text-foreground/60"}
          trendLabel="crossed and left"
        />
        <StatCard
          label="Drive-by share"
          value={share === null ? "--" : `${Math.round(share * 100)}%`}
          icon={<AlertTriangle className="w-4 h-4" />}
          color="text-foreground/70"
          // The denominator, always. See rule 2 above.
          trendLabel={a.totals.crossings === 0 ? "no crossings yet" : `of ${a.totals.crossings} crossings`}
        />
      </MetricGrid>

      <div className="mt-5">
        <div className="flex items-end gap-1 h-28" role="img"
             aria-label={`Arrivals by hour, ${label(from)} to ${label(to)}. Busiest hour ${label(busiest.hour)} with ${busiest.arrivals} arrivals.`}>
          {window.map((h) => (
            <div key={h.hour} className="flex-1 flex flex-col justify-end items-center gap-0.5 min-w-0"
                 title={`${label(h.hour)} — ${h.arrivals} arrival${h.arrivals === 1 ? "" : "s"}` +
                        (h.passThroughs ? `, ${h.passThroughs} drive-by` : "") +
                        (h.baselineArrivals === null ? "" : `, usual ${h.baselineArrivals.toFixed(1)}`)}>
              {/* Drive-bys stack ABOVE arrivals: they are crossings too, but they are not
                  customers, so they never grow the green bar. */}
              {h.passThroughs > 0 && (
                <div className="w-full bg-amber-400/50 rounded-t-sm" style={{ height: pct(h.passThroughs) }} />
              )}
              <div className={`w-full rounded-sm ${h.arrivals > 0 ? "bg-emerald-400/80" : "bg-foreground/10"}`}
                   style={{ height: h.arrivals > 0 ? pct(h.arrivals) : "2px" }} />
              {/* The baseline is a tick, not a second bar -- it is context, not a rival
                  measurement, and drawing it as a bar invites reading it as today. */}
              {h.baselineArrivals !== null && h.baselineArrivals > 0 && (
                <div className="w-full border-t border-dashed border-sky-400/70 -mt-px"
                     style={{ marginBottom: pct(h.baselineArrivals) }} />
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-1 mt-1">
          {window.map((h) => (
            <div key={h.hour} className="flex-1 text-center text-[10px] text-foreground/40 min-w-0 truncate">
              {label(h.hour)}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-foreground/50">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400/80" />Arrivals</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400/50" />Drive-bys</span>
          {a.history.priorDaysWithData > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 border-t border-dashed border-sky-400/70" />
              Usual for this hour
            </span>
          )}
          {busiest.arrivals > 0 && (
            <span className="ml-auto text-foreground/60">
              Busiest so far: <span className="text-foreground/80">{label(busiest.hour)}</span>
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function FloorCard({ v, fetchedAt, now }: { v: VisitRow; fetchedAt: number; now: number }) {
  const stage = stageOf(v);

  // Prefer the OBSERVED arrival. Fall back to first-seen and say so — an unobserved
  // arrival rendered as a confident dwell time is the same lie as a confident zero.
  const observed = v.onPropertyMinutes !== null;
  const dwell = advanceOpenDuration(
    observed ? v.onPropertyMinutes : v.sinceFirstSeenMinutes,
    v.open,
    fetchedAt,
    now,
  );
  const wait = advanceOpenDuration(v.waitMinutes, v.open && !v.bayEnteredAt, fetchedAt, now);
  const inBay = advanceOpenDuration(
    v.bayMinutes,
    v.open && Boolean(v.bayEnteredAt) && !v.bayExitedAt,
    fetchedAt,
    now,
  );

  // Capped at 100% so an overnight vehicle cannot render a bar wider than its card.
  const pct = dwell === null ? 0 : Math.min(100, Math.round((dwell / URGENT_MINUTES) * 100));
  const barTone =
    dwell !== null && dwell >= URGENT_MINUTES
      ? "bg-red-400/70"
      : dwell !== null && dwell >= ATTENTION_MINUTES
        ? "bg-amber-400/70"
        : "bg-emerald-400/60";

  return (
    <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3.5 transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-[22px] leading-none font-semibold tabular-nums ${dwellTone(dwell)}`}>
            {formatDuration(dwell)}
          </div>
          <div className="text-[11px] text-foreground/45 mt-1">
            {observed ? "on the property" : "since first seen · arrival not observed"}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0 ${stage.tone}`}
        >
          {stage.label}
        </span>
      </div>

      <div className="mt-2.5 h-1 rounded-full bg-foreground/10 overflow-hidden">
        <div className={`h-full ${barTone}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <div className="text-foreground/40">Waited</div>
          <div className="tabular-nums text-foreground/80">{formatDuration(wait)}</div>
        </div>
        <div>
          <div className="text-foreground/40">In bay</div>
          <div className="tabular-nums text-foreground/80">{formatDuration(inBay)}</div>
        </div>
        <div>
          <div className="text-foreground/40">Arrived</div>
          <div className="tabular-nums text-foreground/80">{stamp(v.arrivedAt)}</div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 flex-wrap text-[11px] text-foreground/50">
        {/* Plate text appears ONLY for a CONFIRMED read — the router nulls the rest,
            because a candidate string on screen becomes a fact in someone's head. */}
        {v.plateText ? (
          <span className="font-mono tracking-wide rounded bg-foreground/10 px-1.5 py-0.5 text-foreground/80">
            {v.plateText}
          </span>
        ) : (
          <span className="text-foreground/35">plate {v.plateStatus.toLowerCase()}</span>
        )}
        {v.customerMatch === "EXACT" && <span className="text-emerald-400/80">customer matched</span>}
        {v.customerMatch === "CONFUSABLE_UNIQUE" && (
          <span className="text-amber-400/80">needs staff confirm</span>
        )}
        <span className="text-foreground/25">·</span>
        <span>{v.camera}</span>
        {v.estimatedFields.length > 0 && (
          <span className="text-amber-400/70">{v.estimatedFields.length} estimated</span>
        )}
      </div>
    </div>
  );
}

type ConversationQueryData =
  | { ok: true; conversations: ConversationRow[] }
  | { ok: false; reason: string };

function ConversationPanel({
  query,
  officeCamera,
}: {
  query: ReturnType<typeof trpc.lot.conversations.useQuery>;
  officeCamera: CameraHealth | null;
}) {
  // tRPC's decorated hook proxy widens ReturnType<useQuery>["data"] to {} at this
  // component boundary. Re-narrow ONLY the procedure payload here; the server still owns
  // runtime validation and every branch below preserves failed/unknown vs empty.
  const data = query.data as ConversationQueryData | undefined;
  const rows: ConversationRow[] = data?.ok === true ? data.conversations : [];
  const runtime = officeCamera?.conversation ?? null;
  const reportedState =
    runtime?.state ?? (runtime?.workerOk === false ? "STOPPED" : "UNKNOWN");
  // A self-report is a statement about now only while it is FRESH. A hung worker leaves
  // "READY" on disk and the agent relays it for hours (2026-10-05/06); the panel then read a
  // live state off a dead process. Stale or from a dead producer, the state is UNKNOWN and
  // the last report is shown as history, dated.
  const reportFresh = workerReportFresh(officeCamera);
  const workerState = runtime && !reportFresh ? "UNKNOWN" : reportedState;
  const workerHealthy =
    reportFresh &&
    runtime?.workerOk === true &&
    !["DEGRADED", "MISSING", "STALE", "ERROR", "STOPPED"].includes(workerState);
  const workerTone = workerHealthy
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : runtime?.workerOk === false ||
        ["DEGRADED", "MISSING", "STALE", "ERROR", "STOPPED"].includes(
          workerState
        )
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : "border-amber-500/30 bg-amber-500/10 text-amber-300";

  return (
    <Panel
      title="Office intelligence"
      icon={<MessageSquare className="w-4 h-4" />}
      subtitle="NICKS EUCLID camera health, counter capture/STT health, and evidence-backed summaries in one truth surface"
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-foreground/10 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold">
                NICKS EUCLID · office camera
              </div>
              <div className="mt-0.5 text-[11px] text-foreground/45">
                {officeCamera?.source?.generation ?? "camera identity unknown"}
              </div>
            </div>
            {officeCamera ? (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${stateTone(officeCamera.state, officeCamera.commissioned)}`}
              >
                {officeCamera.state.replace(/_/g, " ").toLowerCase()}
              </span>
            ) : (
              <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-[10px] text-foreground/50">
                unknown
              </span>
            )}
          </div>
          {officeCamera ? (
            <>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/55">
                <span>
                  producer{" "}
                  <b className={facetTone(officeCamera.facets.producer)}>
                    {officeCamera.facets.producer}
                  </b>
                </span>
                <span>
                  events{" "}
                  <b className={facetTone(officeCamera.facets.events)}>
                    {officeCamera.facets.events}
                  </b>
                </span>
                <span>
                  media{" "}
                  <b className={facetTone(officeCamera.facets.media)}>
                    {officeCamera.facets.media}
                  </b>
                </span>
                <span>
                  control{" "}
                  <b className={facetTone(officeCamera.facets.control)}>
                    {officeCamera.facets.control}
                  </b>
                </span>
                <span>
                  home{" "}
                  <b className={facetTone(officeCamera.facets.home)}>
                    {officeCamera.facets.home.replace(/_/g, " ")}
                  </b>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/45 tabular-nums">
                <span>heartbeat {formatAgo(officeCamera.ageSeconds)} ago</span>
                {officeCamera.transport?.eventProofAgeSeconds !== null &&
                  officeCamera.transport?.eventProofAgeSeconds !==
                    undefined && (
                    <span>
                      event proof{" "}
                      {formatAgo(officeCamera.transport.eventProofAgeSeconds)}{" "}
                      ago
                    </span>
                  )}
                {officeCamera.transport?.mediaProofAgeSeconds !== null &&
                  officeCamera.transport?.mediaProofAgeSeconds !==
                    undefined && (
                    <span>
                      media proof{" "}
                      {formatAgo(officeCamera.transport.mediaProofAgeSeconds)}{" "}
                      ago
                    </span>
                  )}
              </div>
              <div className="mt-2 text-[11px] text-foreground/40">
                {officeCamera.reason}
              </div>
            </>
          ) : (
            <div className="mt-2 text-[12px] text-foreground/50">
              Office camera runtime could not be read.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-foreground/10 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold">
                Conversation intelligence
              </div>
              <div className="mt-0.5 text-[11px] text-foreground/45">
                {runtime?.audioSource ?? "audio source unknown"}
                {runtime?.captureHost ? ` · ${runtime.captureHost}` : ""}
              </div>
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${workerTone}`}
            >
              {workerState.replace(/_/g, " ").toLowerCase()}
            </span>
          </div>
          {runtime && !reportFresh && (
            <div className="mt-2 text-[11px] text-amber-300/90">
              Last self-report {reportedState.replace(/_/g, " ").toLowerCase()},{" "}
              {formatAgo(runtime.workerAgeSeconds)} ago
              {officeCamera?.facets.producer !== "alive" ? " via a producer that is no longer heartbeating" : ""}.
              A worker that stopped reporting is not known to be listening.
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/55 tabular-nums">
            <span>
              worker {formatAgo(runtime?.workerAgeSeconds ?? null)} ago
            </span>
            {/*
              Listening over the last hour (0144). The lane listened about 8% of the day on
              2026-10-03 to 10-05 while READY; "latest coverage" below is one clip's
              transcript coverage, a different number. typeof === "number": 0% is a reading.
            */}
            {typeof runtime?.listeningCoverage60m === "number" && (
              <span className={runtime.listeningCoverage60m < 0.2 ? "text-amber-400" : undefined}>
                listened {Math.round(runtime.listeningCoverage60m * 100)}% of the last hour
              </span>
            )}
            {typeof runtime?.captureSecondsLast60m === "number" && (
              <span>{Math.round(runtime.captureSecondsLast60m / 60)}m recorded</span>
            )}
            {typeof runtime?.capturesLast60m === "number" && (
              <span>
                {runtime.capturesLast60m} capture{runtime.capturesLast60m === 1 ? "" : "s"}
                {typeof runtime.captureFailuresLast60m === "number" && runtime.captureFailuresLast60m > 0
                  ? `, ${runtime.captureFailuresLast60m} failed`
                  : ""}
              </span>
            )}
            {typeof runtime?.wakeTriggersLast60m === "number" && (
              <span>{runtime.wakeTriggersLast60m} wake{runtime.wakeTriggersLast60m === 1 ? "" : "s"}/h</span>
            )}
            {typeof runtime?.transcribeBacklog === "number" && runtime.transcribeBacklog > 0 && (
              <span className="text-amber-400">backlog {runtime.transcribeBacklog}</span>
            )}
            {runtime?.queueDepth !== null &&
              runtime?.queueDepth !== undefined && (
                <span>queue {runtime.queueDepth}</span>
              )}
            {runtime?.sttEngine && <span>{runtime.sttEngine}</span>}
            {runtime?.lastTrigger && <span>trigger {runtime.lastTrigger}</span>}
            {runtime?.eventAgeSeconds !== null &&
              runtime?.eventAgeSeconds !== undefined && (
                <span>event {formatAgo(runtime.eventAgeSeconds)} ago</span>
              )}
            {runtime?.captureAgeSeconds !== null &&
              runtime?.captureAgeSeconds !== undefined && (
                <span>capture {formatAgo(runtime.captureAgeSeconds)} ago</span>
              )}
            {runtime?.sttAgeSeconds !== null &&
              runtime?.sttAgeSeconds !== undefined && (
                <span>STT {formatAgo(runtime.sttAgeSeconds)} ago</span>
              )}
            {runtime?.postAgeSeconds !== null &&
              runtime?.postAgeSeconds !== undefined && (
                <span>posted {formatAgo(runtime.postAgeSeconds)} ago</span>
              )}
            {runtime?.summaryAgeSeconds !== null &&
              runtime?.summaryAgeSeconds !== undefined && (
                <span>summary {formatAgo(runtime.summaryAgeSeconds)} ago</span>
              )}
            {runtime?.lastCoverage !== null &&
              runtime?.lastCoverage !== undefined && (
                <span>
                  {Math.round(runtime.lastCoverage * 100)}% latest coverage
                </span>
              )}
            {runtime?.failuresToday !== null &&
              runtime?.failuresToday !== undefined &&
              runtime.failuresToday > 0 && (
                <span className="text-amber-400">
                  {runtime.failuresToday} failure
                  {runtime.failuresToday === 1 ? "" : "s"} today
                </span>
              )}
          </div>
          {runtime?.lastError && (
            <div className="mt-2 text-[11px] text-red-300/90">
              {runtime.lastError}
            </div>
          )}
          {!runtime && (
            <div className="mt-2 text-[11px] text-foreground/45">
              Conversation worker has not reported yet; camera health alone is
              not capture health.
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-foreground/10 pt-3">
        <div className="mb-2">
          <div className="text-[12px] font-semibold">Counter conversations</div>
          <div className="text-[11px] text-foreground/40">
            Operational summaries only — raw audio and full transcripts stay off
            this screen; self-tests are hidden
          </div>
        </div>

        {query.isError ? (
          <Unknown what="Counter conversations" reason={query.error?.message} />
        ) : query.isPending ? (
          <Loading what="counter conversations" />
        ) : !data ? (
          <Unknown what="Counter conversations" />
        ) : data.ok === false ? (
          <Unknown what="Counter conversations" reason={data.reason} />
        ) : rows.length === 0 ? (
          <div className="text-[13px] text-foreground/60">
            No customer conversation episodes recorded yet. Self-test episodes
            are hidden.
          </div>
        ) : (
          <div className="space-y-2.5">
            {rows.map(row => {
              const status = row.transcriptStatus.toUpperCase();
              const statusTone =
                status === "DONE"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : status === "FAILED"
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : status === "SKIPPED"
                      ? "border-foreground/20 bg-foreground/5 text-foreground/60"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-300";
              const coverage =
                row.coverage === null
                  ? "coverage unknown"
                  : `${Math.round(row.coverage * 100)}% covered`;
              const duration =
                row.durationSeconds === null
                  ? "duration unknown"
                  : row.durationSeconds < 60
                    ? `${Math.round(row.durationSeconds)}s clip`
                    : `${(row.durationSeconds / 60).toFixed(1)}m clip`;
              const summaryText =
                row.summary ??
                (status === "SKIPPED"
                  ? "No speech was transcribed in this clip."
                  : status === "FAILED"
                    ? "Summary unavailable — capture, transcription, or extraction failed."
                    : row.coverage === null
                      ? "Summary withheld — transcript coverage is unknown."
                      : row.coverage < 0.65
                        ? `Summary withheld — transcript coverage ${Math.round(row.coverage * 100)}% is below the 65% evidence threshold.`
                        : row.factCount === 0
                          ? "No evidence-backed actionable facts were found."
                          : "Summary withheld — validated evidence is incomplete.");

              return (
                <div
                  key={row.episodeId}
                  className="rounded-lg border border-foreground/10 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] text-foreground/45">
                        {row.startedAtMs === null
                          ? "time unknown"
                          : stamp(new Date(row.startedAtMs).toISOString())}
                        {" · "}
                        {row.source}
                        {row.triggerType ? ` · ${row.triggerType}` : ""}
                      </div>
                      {row.gist && (
                        <div className="mt-1 text-[13px] text-foreground/85">
                          <span className="font-medium text-foreground/55">Heard: </span>
                          {row.gist}
                        </div>
                      )}
                      <div className={row.gist && !row.summary ? "mt-1 text-[11px] text-foreground/45" : "mt-1 text-[13px] text-foreground/85"}>
                        {summaryText}
                      </div>
                      {row.visual?.status === "DONE" && row.visual.summary && (
                        <div className="mt-1 text-[12px] text-foreground/70">
                          <span className="font-medium text-foreground/55">Saw: </span>
                          {row.visual.summary}
                          {row.visual.waitingUnattended && (
                            <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                              customer waiting unattended
                            </span>
                          )}
                        </div>
                      )}
                      {row.visual?.status === "DONE" && row.visual.summary && (
                        <VisualReview
                          episodeId={row.episodeId}
                          review={row.visual.review}
                          onSaved={() => { void query.refetch(); }}
                        />
                      )}
                      {row.visual?.status === "FAILED" && (
                        <div className="mt-1 text-[11px] text-foreground/45">
                          Saw: unavailable. {row.visual.frameCount} frame{row.visual.frameCount === 1 ? "" : "s"} arrived but the vision model could not describe them.
                        </div>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusTone}`}
                    >
                      {status.toLowerCase()}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/50 tabular-nums">
                    <span>{coverage}</span>
                    <span>
                      {row.factCount} fact{row.factCount === 1 ? "" : "s"}
                    </span>
                    <span>{duration}</span>
                    {row.speakerCount !== null && (
                      <span>
                        {row.speakerCount} speaker group
                        {row.speakerCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {row.meanVolumeDb !== null && (
                      <span>{row.meanVolumeDb.toFixed(1)} dBFS</span>
                    )}
                    {row.visual?.status === "DONE" && row.visual.peopleCount !== null && (
                      <span>
                        {row.visual.peopleCount} {row.visual.peopleCount === 1 ? "person" : "people"} seen
                      </span>
                    )}
                    {typeof row.visual?.onBoxPeople === "number" && (
                      <span>
                        detector: {row.visual.onBoxPeople} {row.visual.onBoxPeople === 1 ? "person" : "people"}
                      </span>
                    )}
                    {row.sttEngine && <span>{row.sttEngine}</span>}
                    {row.sttModel && <span>{row.sttModel}</span>}
                    {row.sttLatencyMs !== null && (
                      <span>STT {row.sttLatencyMs}ms</span>
                    )}
                    {row.captureHost && <span>{row.captureHost}</span>}
                    {row.cameraSerial && <span>camera {row.cameraSerial}</span>}
                  </div>

                  {(row.candidateVehicleVisitId ||
                    row.candidateWorkOrderId) && (
                    <div className="mt-2 text-[11px] text-amber-300/80">
                      Candidate link
                      {row.candidateVehicleVisitId
                        ? ` · visit ${row.candidateVehicleVisitId}`
                        : ""}
                      {row.candidateWorkOrderId
                        ? ` · work order ${row.candidateWorkOrderId}`
                        : ""}
                      {row.linkConfidence === null
                        ? " · confidence unknown"
                        : ` · ${Math.round(row.linkConfidence * 100)}% confidence`}
                      {" · not identity-confirmed"}
                    </div>
                  )}

                  {row.transcriptError && (
                    <div className="mt-2 text-[11px] text-red-300/90">
                      Capture/transcription error: {row.transcriptError}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="text-[11px] text-foreground/35">
              Speaker labels group voices only; they do not identify people.
              Candidate visit/work-order links remain unconfirmed.
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function LotSection() {
  // Commissioning / replay rows are excluded from every counter and hidden from the
  // list by default; they are never deleted, so the operator can opt in to see them.
  const [showCommissioning, setShowCommissioning] = useState(false);
  const now = trpc.lot.now.useQuery(undefined, { refetchInterval: POLL_MS });
  const activity = trpc.lot.activity.useQuery(undefined, { refetchInterval: POLL_MS });
  const visits = trpc.lot.visits.useQuery(
    { limit: 50, openOnly: false, includeCommissioning: showCommissioning },
    { refetchInterval: POLL_MS },
  );
  // THE FLOOR BOARD HAS ITS OWN READ (2026-10-07). It used to filter the 50 most recent
  // visits of any state down to the open ones, so a car that arrived 51 visits ago and was
  // still on the lot simply fell off the board -- on a 40-car day, by early afternoon, the
  // longest-waiting cars were exactly the ones missing. This asks for OPEN visits only, up
  // to FLOOR_BOARD_LIMIT, and the strip says "N more" when even that is not everything.
  const onLotVisits = trpc.lot.visits.useQuery(
    { limit: FLOOR_BOARD_LIMIT, openOnly: true, includeCommissioning: showCommissioning },
    { refetchInterval: POLL_MS },
  );
  const health = trpc.lot.health.useQuery(undefined, { refetchInterval: POLL_MS });
  const conversations = trpc.lot.conversations.useQuery(
    { limit: 25, includeSelftest: false },
    { refetchInterval: POLL_MS },
  );
  // Hooks stay above every conditional return — `pnpm run lint:hooks` fails a hook
  // called after an early return, and this component has many conditional branches.
  const tick = useTick(TICK_MS);

  const n = now.data;
  const nowFailed = now.isError || (!now.isPending && !n) || n?.ok === false;
  const nowReason = now.isError
    ? (now.error?.message ?? "the request failed")
    : n?.ok === false
      ? n.reason
      : undefined;

  // null freshness is UNKNOWN, not fresh. Only a real, recent number is "Live".
  const freshnessUnknown = n?.ok === true && n.staleSeconds === null && !n.neverIngested;
  const stale = n?.ok === true && n.staleSeconds !== null && n.staleSeconds > 300;

  const fleet = summarizeCameraFleet(
    health.isError
      ? { ok: false, reason: health.error?.message }
      : (health.data as Parameters<typeof summarizeCameraFleet>[0]),
  );

  const allRows: VisitRow[] =
    visits.data?.ok === true ? (visits.data.rows as unknown as VisitRow[]) : [];
  const healthCameras: CameraHealth[] =
    health.data?.ok === true ? (health.data.cameras as unknown as CameraHealth[]) : [];
  const officeCamera = healthCameras.find((camera) => camera.camera === "office") ?? null;
  // The vehicle-truth camera. Every count on this page comes from it, so its state decides
  // whether the lot is being WATCHED -- "Live" visits from the office camera are not.
  const signCamera = healthCameras.find((camera) => camera.role === "vehicle_truth") ?? null;
  const signLoaded = !health.isPending && !health.isError && health.data?.ok === true;
  const signWatching = signCamera !== null && signCamera.state === "HEALTHY";
  const signStateLabel = signCamera ? signCamera.state.replace(/_/g, " ").toLowerCase() : "unknown";
  const windowColumnsStored = health.data?.ok === true ? health.data.windowColumnsStored : null;

  const badge: { label: string; variant: "success" | "warning" | "danger" | "neutral" } =
    nowFailed
      ? { label: "Unavailable", variant: "danger" }
      : now.isPending
        ? { label: "Loading", variant: "neutral" }
        : n?.ok === true && n.neverIngested
          ? { label: "Awaiting first event", variant: "neutral" }
          : signLoaded && signCamera && !signWatching
            ? // Never "Live" over a sign camera that is not HEALTHY: the visits below are
              // whatever it last managed to see. 2026-10-05 said "Live" over a blind lane.
              { label: `Not watching · sign ${signStateLabel}`, variant: "danger" }
            : freshnessUnknown
              ? { label: "Freshness unknown", variant: "warning" }
              : stale
                ? { label: `Stale ${Math.round((n!.staleSeconds ?? 0) / 60)}m`, variant: "warning" }
                : fleet.state === "DEGRADED"
                  ? // Fresh visits from one camera do not make the fleet healthy: before
                    // 2026-10-02 this said "Live" while sign was CAMERA_OFFLINE.
                    { label: `Live · ${fleet.problems.length} camera issue${fleet.problems.length === 1 ? "" : "s"}`, variant: "warning" }
                  : fleet.state === "UNKNOWN" && !health.isPending
                    ? { label: "Live · camera health unknown", variant: "warning" }
                    : { label: "Live", variant: "success" };

  // Longest-dwelling first: the car that has been there longest is the one about to
  // become a complaint, so it belongs at the top of the screen, not the bottom.
  const onLotRows: VisitRow[] =
    onLotVisits.data?.ok === true ? (onLotVisits.data.rows as unknown as VisitRow[]) : [];
  const onLot = onLotRows
    .filter((v) => v.open)
    .slice()
    .sort((a, b) => {
      const av = a.onPropertyMinutes ?? a.sinceFirstSeenMinutes ?? -1;
      const bv = b.onPropertyMinutes ?? b.sinceFirstSeenMinutes ?? -1;
      return bv - av;
    });
  const onPropertyCount = n?.ok === true ? n.counts.onProperty : null;
  const floorBoardLoaded = onLotVisits.data?.ok === true;
  const notShown = floorBoardLoaded && onPropertyCount !== null ? Math.max(0, onPropertyCount - onLot.length) : null;

  // HOW MUCH TO BELIEVE TODAY'S COUNTS, in words. Pure helper (shared/lotDataConfidence.ts);
  // the clock is the shop's, recomputed on the tick so the expected-so-far number moves.
  const clock = localClock(new Date(tick), BUSINESS.timezone);
  const confidence: LotConfidence = lotDataConfidence({
    activity: activity.isError
      ? { ok: false, reason: activity.error?.message }
      : (activity.data as Parameters<typeof lotDataConfidence>[0]["activity"]),
    sign: signCamera
      ? { state: signCamera.state, stateForSeconds: signCamera.stateForSeconds, dropsToday: signCamera.stability?.dropsToday ?? null }
      : null,
    clock: { hour: Math.floor(clock.minutes / 60), minute: clock.minutes % 60 },
  });

  // Office mic: coverage is a NUMBER about the last hour, or it is unknown. A fresh worker
  // with no number is "not stored yet" while the 0144 migration lags; a stale worker's
  // number is history, not listening.
  const officeRuntime = officeCamera?.conversation ?? null;
  const officeFresh = workerReportFresh(officeCamera);
  const officeCoverage = officeRuntime?.listeningCoverage60m ?? null;
  const officeChip: { value: string; tone: ChipTone; detail: string | null } = !officeCamera
    ? { value: health.isPending ? "loading" : "unknown", tone: "muted", detail: "office camera health could not be read" }
    : !officeRuntime
      ? { value: "worker has not reported", tone: "warn", detail: "camera health alone is not capture health" }
      : !officeFresh
        ? {
            value: `unknown · last report ${formatAgo(officeRuntime.workerAgeSeconds)} ago`,
            tone: "warn",
            detail: officeCamera.facets.producer !== "alive"
              ? "the office producer is not heartbeating; its last worker report is history"
              : "the worker stopped writing its status; a stale READY is not listening",
          }
        : typeof officeCoverage === "number"
          ? {
              value: `listened ${Math.round(officeCoverage * 100)}% of the last hour`,
              tone: officeCoverage >= 0.5 ? "ok" : officeCoverage >= 0.2 ? "muted" : "warn",
              detail:
                `${officeRuntime.capturesLast60m ?? "?"} capture${officeRuntime.capturesLast60m === 1 ? "" : "s"}` +
                (typeof officeRuntime.captureFailuresLast60m === "number" && officeRuntime.captureFailuresLast60m > 0
                  ? `, ${officeRuntime.captureFailuresLast60m} failed`
                  : "") +
                (typeof officeRuntime.wakeTriggersLast60m === "number" ? `, ${officeRuntime.wakeTriggersLast60m} wakes` : "") +
                (typeof officeRuntime.transcribeBacklog === "number" && officeRuntime.transcribeBacklog > 0
                  ? `, backlog ${officeRuntime.transcribeBacklog}`
                  : ""),
            }
          : windowColumnsStored === false
            ? { value: "coverage not stored yet", tone: "muted", detail: "migration 0144 has not been applied; the worker reports it, the shop cannot keep it" }
            : { value: "coverage unknown", tone: "muted", detail: "the worker has not reported a listening window yet" };

  const signChip: { value: string; tone: ChipTone; detail: string | null } = !signLoaded
    ? { value: health.isPending ? "loading" : "unknown", tone: "muted", detail: health.isError ? health.error?.message ?? null : "camera health could not be read" }
    : !signCamera
      ? { value: "no vehicle-truth camera registered", tone: "bad", detail: null }
      : signWatching
        ? {
            value: `watching · heartbeat ${formatAgo(signCamera.ageSeconds)} ago`,
            tone: "ok",
            detail:
              signCamera.facets.vision === "seeing" && typeof signCamera.vision?.detectionsLast10m === "number"
                ? `saw ${signCamera.vision.detectionsLast10m} vehicle${signCamera.vision.detectionsLast10m === 1 ? "" : "s"} in the last 10 min`
                : signCamera.facets.vision === "quiet"
                  ? "nothing seen in the last 10 min; nothing says there should have been"
                  : signCamera.facets.vision === "unknown"
                    ? "detector window not reported (edge predates 0144)"
                    : null,
          }
        : {
            value: `${signStateLabel} for ${formatAgo(signCamera.stateForSeconds)}`,
            tone: signCamera.state === "STALE" || signCamera.state === "UNVERIFIED_CAPABILITIES" ? "warn" : "bad",
            detail: signCamera.reason,
          };

  const confidenceChip: { value: string; tone: ChipTone } =
    confidence.level === "OK"
      ? { value: "OK", tone: "ok" }
      : confidence.level === "LOW"
        ? { value: "LOW", tone: "warn" }
        : { value: "cannot judge", tone: "muted" };

  const eventChip: { value: string; tone: ChipTone } =
    n?.ok !== true
      ? { value: "unknown", tone: "muted" }
      : n.neverIngested
        ? { value: "none yet", tone: "muted" }
        : n.staleSeconds === null
          ? { value: "unknown", tone: "muted" }
          : { value: `${formatAgo(n.staleSeconds)} ago`, tone: n.staleSeconds > 300 ? "warn" : "ok" };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lot"
        subtitle="Live vehicle truth from the shop cameras"
        icon={<ParkingSquare className="w-5 h-5" />}
        badge={badge}
      />

      {/* THE STRIP: what this page's numbers rest on, before any number. Each chip is a fact
          with its evidence; none of them is a number from a producer that was not looking. */}
      <Panel
        title="What these numbers rest on"
        icon={<Eye className="w-4 h-4" />}
        subtitle="Camera, baseline, floor-board completeness and office listening, in words"
        padding="sm"
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <TrustChip label="Sign camera" value={signChip.value} tone={signChip.tone} detail={signChip.detail} />
          <TrustChip label="Today's counts" value={confidenceChip.value} tone={confidenceChip.tone} detail={confidence.headline} />
          <TrustChip
            label="On the lot"
            value={
              !floorBoardLoaded
                ? onLotVisits.isPending ? "loading" : "unavailable"
                : onPropertyCount === null
                  ? `${onLot.length} shown`
                  : notShown && notShown > 0
                    ? `${onLot.length} of ${onPropertyCount} shown`
                    : `${onLot.length} of ${onPropertyCount}`
            }
            tone={!floorBoardLoaded ? "muted" : notShown && notShown > 0 ? "warn" : "ok"}
            detail={
              notShown && notShown > 0
                ? `${notShown} more on the property than this read returns (${FLOOR_BOARD_LIMIT} max)`
                : !signWatching && signLoaded
                  ? "the sign camera is not watching, so the board may be missing cars"
                  : null
            }
          />
          <TrustChip label="Office mic" value={officeChip.value} tone={officeChip.tone} detail={officeChip.detail} />
          <TrustChip label="Last camera event" value={eventChip.value} tone={eventChip.tone} detail={null} />
        </div>
      </Panel>

      {nowFailed ? (
        <Unknown what="Lot counters" reason={nowReason} />
      ) : now.isPending ? (
        <Loading what="lot state" />
      ) : n?.ok === true && n.neverIngested ? (
        <EmptyState
          icon={<Camera className="w-5 h-5" />}
          title={n.commissioningVisits > 0 ? "No production visits yet" : "No camera events yet"}
          subtitle={
            n.commissioningVisits > 0
              ? `${n.commissioningVisits} commissioning ${n.commissioningVisits === 1 ? "visit is" : "visits are"} recorded and excluded from every counter. Use "Show commissioning runs" below to review them.`
              : "The vision edge has not delivered a visit. Counters stay blank until real data arrives rather than showing zeros that look like an empty lot."
          }
        />
      ) : n?.ok === true ? (
        <>
          {n.truncated && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] text-amber-300">
              More open visits than this read returns. The counters below are a floor,
              not a total.
            </div>
          )}

          <MetricGrid cols={4}>
            <StatCard
              label="On property"
              value={n.counts.onProperty}
              icon={<Car className="w-4 h-4" />}
              color="text-primary"
            />
            {/* NOT "Waiting". Jacking happens wherever it needs to, so this bucket holds
                cars that are queueing AND cars being worked on where they stand. The
                camera cannot separate them, and naming it "waiting" would turn a guess
                into a number someone staffs against. */}
            <StatCard
              label="On lot, not in a bay"
              value={n.counts.onLotNotInBay}
              icon={<Clock className="w-4 h-4" />}
              color={n.waits.oldestWaitMinutes && n.waits.oldestWaitMinutes > ATTENTION_MINUTES ? "text-amber-400" : "text-foreground"}
              trendLabel={
                n.waits.oldestWaitMinutes !== null
                  ? `${n.counts.waitingForBay} never in a bay · longest ${formatDuration(n.waits.oldestWaitMinutes)}`
                  : "includes cars on jacks"
              }
            />
            {/* Bays 1 and 3 only, and INTERIOR only. A car being plugged on the apron
                in front of a bay is a different job with a different duration, so the
                zone stops at the door threshold and that car stays out of this count. */}
            <StatCard
              label="In a bay"
              value={n.counts.inBays}
              icon={<Wrench className="w-4 h-4" />}
              color="text-emerald-400"
              trendLabel="pulled in · bays 1 and 3"
            />
            <StatCard
              label="Pulled out, still here"
              value={n.counts.postService}
              icon={<LogOut className="w-4 h-4" />}
              color={n.counts.postService > 0 ? "text-amber-400" : "text-foreground"}
            />
          </MetricGrid>

          {/* THE FLOOR BOARD. The counters say how many; this says how long, per car. */}
          <Panel
            title="On the lot right now"
            icon={<Hourglass className="w-4 h-4" />}
            subtitle="Longest first — clocks are live, and a car whose arrival was never observed says so instead of guessing"
          >
            {onLotVisits.isError ? (
              <Unknown what="Floor board" reason={onLotVisits.error?.message} />
            ) : onLotVisits.isPending ? (
              <Loading what="vehicles on the lot" />
            ) : !onLotVisits.data ? (
              <Unknown what="Floor board" />
            ) : onLotVisits.data.ok === false ? (
              <Unknown what="Floor board" reason={onLotVisits.data.reason} />
            ) : onLot.length === 0 ? (
              <div className="text-[13px] text-foreground/60">
                {signLoaded && signCamera && !signWatching ? (
                  // An empty board under a camera that is not watching is not an empty lot.
                  <span className="text-amber-400">
                    Not being watched: the sign camera is {signStateLabel}. Vehicles may be on the
                    property with nothing here to show them.
                  </span>
                ) : (
                  "Nothing on the lot right now."
                )}
                {n.counts.onProperty > 0 && (
                  <span className="text-amber-400">
                    {" "}
                    The counter above says {n.counts.onProperty}, so open visits exist that this
                    read did not return.
                  </span>
                )}
              </div>
            ) : (
              <>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {onLot.map((v) => (
                    <FloorCard key={v.visitId} v={v} fetchedAt={onLotVisits.dataUpdatedAt} now={tick} />
                  ))}
                </div>
                {notShown !== null && notShown > 0 && (
                  <div className="mt-3 text-[12px] text-amber-400">
                    {notShown} more on the property than shown: this read returns at most{" "}
                    {FLOOR_BOARD_LIMIT} open visits, longest first.
                  </div>
                )}
              </>
            )}
          </Panel>

          <MetricGrid cols={4}>
            {/* Drive-bys are counted beside arrivals, never inside them. Until 2026-10-07 a
                car that crossed the portal and turned around counted as an arrival, a
                departure AND a left-without-a-bay. */}
            <StatCard
              label="Arrivals today"
              value={n.counts.arrivalsToday}
              icon={<Car className="w-4 h-4" />}
              trendLabel={`${n.counts.passThroughsToday} drive-by${n.counts.passThroughsToday === 1 ? "" : "s"} not counted`}
            />
            <StatCard label="Departures today" value={n.counts.departuresToday} icon={<LogOut className="w-4 h-4" />} />
            {/* NOT "abandoned". A finished outside tyre job looks identical to a
                customer who gave up, and calling good business a loss is the worse of
                the two errors. */}
            <StatCard
              label="Left without a bay"
              value={n.counts.leftWithoutBay}
              icon={<AlertTriangle className="w-4 h-4" />}
              color="text-foreground/70"
            />
            <StatCard
              label="Arrival time unknown"
              value={n.counts.arrivalTimeUnknown}
              icon={<HelpCircle className="w-4 h-4" />}
              color={n.counts.arrivalTimeUnknown > 0 ? "text-amber-400" : "text-foreground/60"}
              trendLabel="not counted in today"
            />
          </MetricGrid>

          {/* The canonical order for this file: isError -> isPending -> no data -> not ok
              -> data. A chart is the easiest surface on which a failed read renders as a
              calm, empty day, so it gets the same four states as every counter here. */}
          {activity.isError ? (
            <Panel title="When the lot is busy" icon={<Clock className="w-4 h-4" />}>
              <Unknown what="hourly activity" reason={activity.error.message} />
            </Panel>
          ) : activity.isPending ? (
            <Panel title="When the lot is busy" icon={<Clock className="w-4 h-4" />}>
              <Loading what="hourly activity" />
            </Panel>
          ) : !activity.data || !activity.data.ok ? (
            <Panel title="When the lot is busy" icon={<Clock className="w-4 h-4" />}>
              <Unknown what="hourly activity"
                       reason={activity.data && !activity.data.ok ? activity.data.reason : undefined} />
            </Panel>
          ) : (
            <ActivityPanel a={activity.data} />
          )}

          <Panel title="Already on the lot at startup" icon={<ShieldQuestion className="w-4 h-4" />}
                 subtitle="Occupancy, kept separate from today's arrivals — a car parked before the detector started never arrived">
            <MetricGrid cols={2}>
              <StatCard
                label="Already parked at startup"
                value={n.counts.preexisting}
                icon={<ShieldQuestion className="w-4 h-4" />}
                color="text-foreground/60"
                trendLabel="occupancy, never an arrival"
              />
              <StatCard
                label="No bay observed, already parked"
                value={n.counts.preexistingWaiting}
                icon={<Clock className="w-4 h-4" />}
                color="text-foreground/60"
                trendLabel="may be parked, queued, or outside service"
              />
            </MetricGrid>
          </Panel>

          <Panel title="Time to bay today" icon={<Clock className="w-4 h-4" />}
                 subtitle="Arrival to bay, for vehicles that reached bay 1 or 3. Outside jack work has no observable start, so it is not in here.">
            {n.waits.sampleSize === 0 ? (
              <div className="text-[13px] text-foreground/60">
                No completed waits yet today. Median and P90 need at least one car
                that reached a bay.
              </div>
            ) : (
              <MetricGrid cols={3}>
                <StatCard label="Median to bay" value={formatDuration(n.waits.medianMinutes)} icon={<Clock className="w-4 h-4" />} />
                <StatCard label="P90 to bay" value={formatDuration(n.waits.p90Minutes)} icon={<Clock className="w-4 h-4" />} />
                <StatCard label="Sample size" value={n.waits.sampleSize} icon={<Car className="w-4 h-4" />} color="text-foreground/60" />
              </MetricGrid>
            )}
          </Panel>

          <Panel title="Bays" icon={<Wrench className="w-4 h-4" />}>
            {n.bays.length === 0 && n.counts.bayUnknown === 0 ? (
              signLoaded && signCamera && !signWatching ? (
                // "All bays clear." was rendered over a camera that could not see the bays
                // (2026-10-05). An empty list from a blind or offline camera is unknown.
                <div className="text-[13px] text-amber-400">
                  Bay status unknown: the sign camera is {signStateLabel}, so an empty list is not a
                  clear bay.
                </div>
              ) : (
                <div className="text-[13px] text-foreground/60">All bays clear.</div>
              )
            ) : (
              <div className="space-y-1.5">
                {n.bays.map((b) => (
                  <div key={b.bay} className="flex items-center justify-between text-[13px] py-1.5 border-b border-foreground/5 last:border-0">
                    <span className="font-medium">{b.bay}</span>
                    <span className={b.occupiedMinutes && b.occupiedMinutes > 90 ? "text-amber-400" : "text-foreground/70"}>
                      occupied {formatDuration(b.occupiedMinutes)}
                    </span>
                  </div>
                ))}
                {n.counts.bayUnknown > 0 && (
                  // An unknown bay is not a clear bay. Without this the operator could
                  // read "In bays: 2" and "All bays clear." from the same response.
                  <div className="flex items-center justify-between text-[13px] py-1.5 text-amber-400">
                    <span className="font-medium">bay not identified</span>
                    <span>{n.counts.bayUnknown} vehicle(s) in a bay we cannot name</span>
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Identity confidence today" icon={<ShieldQuestion className="w-4 h-4" />}
                 subtitle="A confusable or ambiguous plate is never bound to a customer automatically">
            {Object.values(n.identity).every((v) => v === 0) ? (
              // Five tiles that have read 0 since the day they shipped are not information;
              // they teach the reader to skip the panel. No plate reader is wired to these
              // cameras, so a zero here is "nothing produced", said once. The tiles return the
              // moment any producer writes an identity.
              <div className="text-[13px] text-foreground/60">
                No plate or customer identity today. The cameras have no plate reader wired, so
                these counters are zero by construction, not by observation.
              </div>
            ) : (
              <MetricGrid cols={5}>
                <StatCard label="Plates confirmed" value={n.identity.plateConfirmed} icon={<Camera className="w-4 h-4" />} color="text-emerald-400" />
                <StatCard label="Plates ambiguous" value={n.identity.plateAmbiguous} icon={<AlertTriangle className="w-4 h-4" />} color="text-amber-400" />
                <StatCard label="Customer exact" value={n.identity.customerExact} icon={<Car className="w-4 h-4" />} color="text-emerald-400" />
                <StatCard label="Confusable only" value={n.identity.customerConfusable} icon={<ShieldQuestion className="w-4 h-4" />} color="text-amber-400" trendLabel="needs staff confirm" />
                <StatCard label="Ambiguous" value={n.identity.customerAmbiguous} icon={<AlertTriangle className="w-4 h-4" />} color="text-foreground/60" trendLabel="no auto-link" />
              </MetricGrid>
            )}
          </Panel>
        </>
      ) : null}

      <ConversationPanel query={conversations} officeCamera={officeCamera} />

      <Panel title="Cameras" icon={<Camera className="w-4 h-4" />}
             subtitle="Producer heartbeats — infrastructure health, independent of whether any car has arrived">
        {health.isError ? (
          <Unknown what="Camera health" reason={health.error?.message} />
        ) : health.isPending ? (
          <Loading what="camera health" />
        ) : !health.data ? (
          <Unknown what="Camera health" />
        ) : health.data.ok === false ? (
          <Unknown what="Camera health" reason={health.data.reason} />
        ) : (
          <div className="space-y-2">
            {healthCameras.map((c) => (
              <CameraCard key={c.camera} c={c} />
            ))}
            {health.data.transitions.length > 0 && (
              <div className="pt-1 space-y-0.5 text-[12px] text-foreground/50">
                {health.data.transitions.slice(0, 6).map((t, i) => (
                  <div key={`${t.camera}-${i}`} className="tabular-nums">
                    <span className="text-foreground/70">{t.camera}</span>
                    {" "}{(t.from ?? "—").toLowerCase()} → {t.to.toLowerCase()} · {formatAgo(t.agoSeconds)} ago
                    {t.reason ? <span className="text-foreground/40"> · {t.reason}</span> : null}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[12px] text-foreground/40 pt-1">
              A quiet lot is healthy. Stale and offline come from heartbeat age (stale after{" "}
              {health.data.thresholds.staleAfterSeconds}s, offline after {health.data.thresholds.offlineAfterSeconds}s);
              every other dimension is what the producer reported about itself.
            </p>
          </div>
        )}
      </Panel>

      {/* Between the cameras and the visit list on purpose: you commission a camera you
          can see the health of, and you read the result against the visits it produced. */}
      <CommissioningPanel camera="sign" />

      <Panel title="Recent visits" icon={<Car className="w-4 h-4" />}
             subtitle="Durations are SQL-computed; an open visit keeps counting, a departed one is frozen"
             actions={
               <button
                 type="button"
                 onClick={() => setShowCommissioning((v) => !v)}
                 className={`rounded-md border px-2 py-1 text-[12px] ${showCommissioning ? "border-sky-500/40 bg-sky-500/10 text-sky-300" : "border-foreground/15 text-foreground/60 hover:text-foreground"}`}
               >
                 {showCommissioning ? "Hide commissioning runs" : "Show commissioning runs"}
               </button>
             }>
        {visits.isError ? (
          <Unknown what="Visit list" reason={visits.error?.message} />
        ) : visits.isPending ? (
          <Loading what="visits" />
        ) : !visits.data ? (
          <Unknown what="Visit list" />
        ) : visits.data.ok === false ? (
          <Unknown what="Visit list" reason={visits.data.reason} />
        ) : allRows.length === 0 ? (
          <div className="text-[13px] text-foreground/60">No visits recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-foreground/50 text-left border-b border-foreground/10">
                  <th className="py-2 pr-3 font-medium">Arrived</th>
                  <th className="py-2 pr-3 font-medium">Stage</th>
                  <th className="py-2 pr-3 font-medium text-right">On property</th>
                  <th className="py-2 pr-3 font-medium text-right">Waited</th>
                  <th className="py-2 pr-3 font-medium text-right">In bay</th>
                  <th className="py-2 pr-3 font-medium">Bay</th>
                  <th className="py-2 pr-3 font-medium">Departed</th>
                  <th className="py-2 pr-3 font-medium">Plate</th>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((v) => {
                  const observed = v.onPropertyMinutes !== null;
                  const dwell = advanceOpenDuration(
                    observed ? v.onPropertyMinutes : v.sinceFirstSeenMinutes,
                    v.open,
                    visits.dataUpdatedAt,
                    tick,
                  );
                  const stage = stageOf(v);
                  return (
                    <tr key={v.visitId} className="border-b border-foreground/5 last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">{stamp(v.arrivedAt)}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] ${stage.tone}`}>
                          {stage.label}
                        </span>
                        {v.dataClass !== "PRODUCTION" && (
                          <span
                            className="ml-1 inline-flex items-center rounded border border-sky-500/40 bg-sky-500/10 px-1 py-px text-[10px] uppercase tracking-wide text-sky-300"
                            title={v.commissioningRunId ?? undefined}
                          >
                            {v.dataClass.toLowerCase()}
                          </span>
                        )}
                      </td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${v.open ? dwellTone(dwell) : "text-foreground/70"}`}>
                        {formatDuration(dwell)}
                        {!observed && dwell !== null && (
                          <span className="text-foreground/35 text-[11px]"> first seen</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground/70">
                        {formatDuration(advanceOpenDuration(v.waitMinutes, v.open && !v.bayEnteredAt, visits.dataUpdatedAt, tick))}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground/70">
                        {formatDuration(advanceOpenDuration(v.bayMinutes, v.open && Boolean(v.bayEnteredAt) && !v.bayExitedAt, visits.dataUpdatedAt, tick))}
                      </td>
                      <td className="py-2 pr-3">{v.bay ?? "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{stamp(v.departedAt)}</td>
                      <td className="py-2 pr-3">
                        {v.plateText ? (
                          <span className="font-mono tracking-wide">{v.plateText}</span>
                        ) : (
                          <span className="text-foreground/40">{v.plateStatus.toLowerCase()}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {v.customerMatch === "EXACT" ? (
                          <span className="text-emerald-400">exact</span>
                        ) : (
                          <span className="text-foreground/50">{v.customerMatch.toLowerCase().replace("_", " ")}</span>
                        )}
                      </td>
                      <td className="py-2 text-foreground/50">
                        {v.entryEvidence ?? "—"}
                        {/* Pose is the provenance that says whether the geometry behind this
                            row was even valid; it was being sent to the browser and rendered
                            nowhere. */}
                        {v.cameraPose && <span className="text-foreground/40"> · {v.cameraPose}</span>}
                        {v.estimatedFields.length > 0 && (
                          <span className="text-amber-400"> · {v.estimatedFields.length} estimated</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
