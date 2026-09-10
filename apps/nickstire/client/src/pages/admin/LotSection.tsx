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
 * Data: trpc.lot.now + trpc.lot.visits + trpc.lot.health, polled every 15s.
 */
import { useEffect, useState } from "react";

import { trpc } from "@/lib/trpc";
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
} from "lucide-react";

const POLL_MS = 15_000;
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

type CameraFacets = {
  producer: string;
  source: string;
  frames: string;
  pose: string;
  calibration: string;
  cloud: string;
};

type CameraHealth = {
  camera: string;
  label: string;
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
  vision: { detector: string | null; modelSha256: string | null; inferenceP95Ms: number | null; inferenceAgeSeconds: number | null; poseDelta: number | null; calibrationVersion: string | null; relocateFailures: number | null; preexistingCrossed: number | null } | null;
  cloud: { outboxDepth: number | null; oldestOutboxAgeSeconds: number | null; deadLetterDepth: number | null; cloudAckAgeSeconds: number | null; diskFreeBytes: number | null } | null;
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
    case "CALIBRATION_INVALID":
    case "DEGRADED_VISION":
    case "CLOUD_BACKLOG":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "PRODUCER_OFFLINE":
    case "CAMERA_OFFLINE":
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
  if (["alive", "connected", "fresh", "ok", "valid"].includes(value)) return "text-emerald-400/80";
  if (value === "unknown" || value === "never") return "text-foreground/35";
  return "text-amber-400";
}

function CameraCard({ c }: { c: CameraHealth }) {
  const stateLabel = c.state.replace(/_/g, " ").toLowerCase();
  const facets: Array<[string, string]> = [
    ["producer", c.facets.producer],
    ["source", c.facets.source],
    ["frames", c.facets.frames],
    ["pose", c.facets.pose],
    ["calibration", c.facets.calibration],
    ["cloud", c.facets.cloud],
  ];
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
            {c.mode && c.mode !== "PRODUCTION" && (
              <span className="ml-2 rounded border border-sky-500/40 bg-sky-500/10 px-1 py-px text-[10px] uppercase tracking-wide text-sky-300">
                {c.mode.toLowerCase()}
                {c.commissioningRunId ? ` · ${c.commissioningRunId}` : ""}
              </span>
            )}
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${stateTone(c.state, c.commissioned)}`}>
          {c.state === "NEVER_INGESTED" && !c.commissioned ? "not commissioned yet" : stateLabel}
        </span>
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
            {typeof c.vision?.preexistingCrossed === "number" && c.vision.preexistingCrossed > 0 && (
              <span className="text-amber-400" title="Cars the census called already-there that the entry portal then watched drive in. Their arrivals were never counted.">
                missed arrivals {c.vision.preexistingCrossed}
              </span>
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

/** Where a vehicle is, derived from its timestamps rather than the raw state string. */
function stageOf(v: VisitRow): Stage {
  if (v.bayEnteredAt && !v.bayExitedAt) {
    return {
      label: v.bay ? `In ${v.bay}` : "In a bay",
      tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    };
  }
  if (v.bayExitedAt && !v.departedAt) {
    return {
      label: "Done, not left",
      tone: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    };
  }
  if (v.departedAt) {
    return { label: "Left", tone: "bg-foreground/10 text-foreground/55 border-foreground/20" };
  }
  if (v.preexisting) {
    return {
      label: "Already parked",
      tone: "bg-foreground/10 text-foreground/60 border-foreground/20",
    };
  }
  return { label: "Waiting", tone: "bg-sky-500/15 text-sky-300 border-sky-500/30" };
}

/**
 * One vehicle. The number the floor needs is the biggest thing on the card; every
 * other element exists to qualify it.
 */
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

export default function LotSection() {
  // Commissioning / replay rows are excluded from every counter and hidden from the
  // list by default; they are never deleted, so the operator can opt in to see them.
  const [showCommissioning, setShowCommissioning] = useState(false);
  const now = trpc.lot.now.useQuery(undefined, { refetchInterval: POLL_MS });
  const visits = trpc.lot.visits.useQuery(
    { limit: 50, openOnly: false, includeCommissioning: showCommissioning },
    { refetchInterval: POLL_MS },
  );
  const health = trpc.lot.health.useQuery(undefined, { refetchInterval: POLL_MS });
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

  const badge: { label: string; variant: "success" | "warning" | "danger" | "neutral" } =
    nowFailed
      ? { label: "Unavailable", variant: "danger" }
      : now.isPending
        ? { label: "Loading", variant: "neutral" }
        : n?.ok === true && n.neverIngested
          ? { label: "Awaiting first event", variant: "neutral" }
          : freshnessUnknown
            ? { label: "Freshness unknown", variant: "warning" }
            : stale
              ? { label: `Stale ${Math.round((n!.staleSeconds ?? 0) / 60)}m`, variant: "warning" }
              : { label: "Live", variant: "success" };

  const allRows: VisitRow[] =
    visits.data?.ok === true ? (visits.data.rows as unknown as VisitRow[]) : [];
  // Longest-dwelling first: the car that has been there longest is the one about to
  // become a complaint, so it belongs at the top of the screen, not the bottom.
  const onLot = allRows
    .filter((v) => v.open)
    .slice()
    .sort((a, b) => {
      const av = a.onPropertyMinutes ?? a.sinceFirstSeenMinutes ?? -1;
      const bv = b.onPropertyMinutes ?? b.sinceFirstSeenMinutes ?? -1;
      return bv - av;
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lot"
        subtitle="Live vehicle truth from the shop cameras"
        icon={<ParkingSquare className="w-5 h-5" />}
        badge={badge}
      />

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
              label="Done, not left"
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
            {visits.isError ? (
              <Unknown what="Floor board" reason={visits.error?.message} />
            ) : visits.isPending ? (
              <Loading what="vehicles on the lot" />
            ) : !visits.data ? (
              <Unknown what="Floor board" />
            ) : visits.data.ok === false ? (
              <Unknown what="Floor board" reason={visits.data.reason} />
            ) : onLot.length === 0 ? (
              <div className="text-[13px] text-foreground/60">
                Nothing on the lot right now.
                {n.counts.onProperty > 0 && (
                  <span className="text-amber-400">
                    {" "}
                    The counter above says {n.counts.onProperty}, so those visits fall
                    outside this list&rsquo;s window — widen it before reading the lot as
                    empty.
                  </span>
                )}
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {onLot.map((v) => (
                  <FloorCard key={v.visitId} v={v} fetchedAt={visits.dataUpdatedAt} now={tick} />
                ))}
              </div>
            )}
          </Panel>

          <MetricGrid cols={4}>
            <StatCard label="Arrivals today" value={n.counts.arrivalsToday} icon={<Car className="w-4 h-4" />} />
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
                label="Waiting, already parked"
                value={n.counts.preexistingWaiting}
                icon={<Clock className="w-4 h-4" />}
                color="text-foreground/60"
                trendLabel="excluded from Waiting above"
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
              <div className="text-[13px] text-foreground/60">All bays clear.</div>
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
            <MetricGrid cols={5}>
              <StatCard label="Plates confirmed" value={n.identity.plateConfirmed} icon={<Camera className="w-4 h-4" />} color="text-emerald-400" />
              <StatCard label="Plates ambiguous" value={n.identity.plateAmbiguous} icon={<AlertTriangle className="w-4 h-4" />} color="text-amber-400" />
              <StatCard label="Customer exact" value={n.identity.customerExact} icon={<Car className="w-4 h-4" />} color="text-emerald-400" />
              <StatCard label="Confusable only" value={n.identity.customerConfusable} icon={<ShieldQuestion className="w-4 h-4" />} color="text-amber-400" trendLabel="needs staff confirm" />
              <StatCard label="Ambiguous" value={n.identity.customerAmbiguous} icon={<AlertTriangle className="w-4 h-4" />} color="text-foreground/60" trendLabel="no auto-link" />
            </MetricGrid>
          </Panel>
        </>
      ) : null}

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
            {(health.data.cameras as CameraHealth[]).map((c) => (
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
