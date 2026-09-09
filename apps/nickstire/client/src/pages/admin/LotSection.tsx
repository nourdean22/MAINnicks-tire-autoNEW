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
 * Data: trpc.lot.now + trpc.lot.visits + trpc.lot.health, polled every 15s.
 */
import { trpc } from "@/lib/trpc";
import { PageHeader, StatCard, Panel, MetricGrid, EmptyState } from "./shared";
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
} from "lucide-react";

const POLL_MS = 15_000;

function minutes(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${v % 60}m`;
}

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

export default function LotSection() {
  const now = trpc.lot.now.useQuery(undefined, { refetchInterval: POLL_MS });
  const visits = trpc.lot.visits.useQuery(
    { limit: 50, openOnly: false },
    { refetchInterval: POLL_MS },
  );
  const health = trpc.lot.health.useQuery(undefined, { refetchInterval: POLL_MS });

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
          title="No camera events yet"
          subtitle="The vision edge has not delivered a visit. Counters stay blank until real data arrives rather than showing zeros that look like an empty lot."
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
            <StatCard
              label="Waiting"
              value={n.counts.waiting}
              icon={<Clock className="w-4 h-4" />}
              color={n.waits.oldestWaitMinutes && n.waits.oldestWaitMinutes > 30 ? "text-amber-400" : "text-foreground"}
              trendLabel={n.waits.oldestWaitMinutes !== null ? `oldest ${minutes(n.waits.oldestWaitMinutes)}` : undefined}
            />
            <StatCard
              label="In bays"
              value={n.counts.inBays}
              icon={<Wrench className="w-4 h-4" />}
              color="text-emerald-400"
            />
            <StatCard
              label="Done, not left"
              value={n.counts.postService}
              icon={<LogOut className="w-4 h-4" />}
              color={n.counts.postService > 0 ? "text-amber-400" : "text-foreground"}
            />
          </MetricGrid>

          <MetricGrid cols={4}>
            <StatCard label="Arrivals today" value={n.counts.arrivalsToday} icon={<Car className="w-4 h-4" />} />
            <StatCard label="Departures today" value={n.counts.departuresToday} icon={<LogOut className="w-4 h-4" />} />
            <StatCard
              label="Left before a bay"
              value={n.counts.abandonedBeforeBay}
              icon={<AlertTriangle className="w-4 h-4" />}
              color={n.counts.abandonedBeforeBay > 0 ? "text-red-400" : "text-foreground"}
            />
            <StatCard
              label="Arrival time unknown"
              value={n.counts.arrivalTimeUnknown}
              icon={<HelpCircle className="w-4 h-4" />}
              color={n.counts.arrivalTimeUnknown > 0 ? "text-amber-400" : "text-foreground/60"}
              trendLabel="not counted in today"
            />
          </MetricGrid>

          <Panel title="On the lot right now" icon={<Car className="w-4 h-4" />}
                 subtitle="Occupancy, separate from today's arrival totals">
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

          <Panel title="Wait times today" icon={<Clock className="w-4 h-4" />}>
            {n.waits.sampleSize === 0 ? (
              <div className="text-[13px] text-foreground/60">
                No completed waits yet today. Median and P90 need at least one car
                that reached a bay.
              </div>
            ) : (
              <MetricGrid cols={3}>
                <StatCard label="Median wait" value={minutes(n.waits.medianMinutes)} icon={<Clock className="w-4 h-4" />} />
                <StatCard label="P90 wait" value={minutes(n.waits.p90Minutes)} icon={<Clock className="w-4 h-4" />} />
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
                      occupied {minutes(b.occupiedMinutes)}
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

      <Panel title="Event freshness by camera" icon={<Camera className="w-4 h-4" />}
             subtitle="How recently each camera produced a VISIT EVENT — not a camera heartbeat">
        {health.isError ? (
          <Unknown what="Event freshness" reason={health.error?.message} />
        ) : health.isPending ? (
          <Loading what="camera freshness" />
        ) : !health.data ? (
          <Unknown what="Event freshness" />
        ) : health.data.ok === false ? (
          <Unknown what="Event freshness" reason={health.data.reason} />
        ) : health.data.cameras.length === 0 ? (
          <div className="text-[13px] text-foreground/60">No camera has reported yet.</div>
        ) : (
          <div className="space-y-1.5">
            {health.data.cameras.map((c) => (
              <div key={c.camera} className="flex items-center justify-between text-[13px] py-1.5 border-b border-foreground/5 last:border-0">
                <span className="font-medium">{c.camera}</span>
                <div className="flex items-center gap-3 text-foreground/70">
                  {c.detector && <span className="text-foreground/50">{c.detector}</span>}
                  {c.pose && <span className="text-foreground/50">{c.pose}</span>}
                  <span
                    className={
                      c.status === "recent"
                        ? "text-emerald-400"
                        : c.status === "quiet"
                          ? "text-amber-400"
                          : "text-foreground/50"
                    }
                  >
                    {c.status}
                    {c.ageSeconds !== null && c.status !== "recent" ? ` · ${Math.round(c.ageSeconds / 60)}m ago` : ""}
                  </span>
                </div>
              </div>
            ))}
            <p className="text-[12px] text-foreground/40 pt-1">
              A quiet lot produces no events, so "quiet" here does not mean the camera is
              down. True camera liveness is the device heartbeat, which this panel does
              not read.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Recent visits" icon={<Car className="w-4 h-4" />}>
        {visits.isError ? (
          <Unknown what="Visit list" reason={visits.error?.message} />
        ) : visits.isPending ? (
          <Loading what="visits" />
        ) : !visits.data ? (
          <Unknown what="Visit list" />
        ) : visits.data.ok === false ? (
          <Unknown what="Visit list" reason={visits.data.reason} />
        ) : visits.data.rows.length === 0 ? (
          <div className="text-[13px] text-foreground/60">No visits recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-foreground/50 text-left border-b border-foreground/10">
                  <th className="py-2 pr-3 font-medium">Arrived</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  <th className="py-2 pr-3 font-medium">Bay</th>
                  <th className="py-2 pr-3 font-medium">Departed</th>
                  <th className="py-2 pr-3 font-medium">Plate</th>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {visits.data.rows.map((v) => (
                  <tr key={v.visitId} className="border-b border-foreground/5 last:border-0">
                    <td className="py-2 pr-3">{stamp(v.arrivedAt)}</td>
                    <td className="py-2 pr-3">
                      {v.preexisting ? (
                        <span className="text-foreground/50">already parked</span>
                      ) : (
                        v.state
                      )}
                    </td>
                    <td className="py-2 pr-3">{v.bay ?? "—"}</td>
                    <td className="py-2 pr-3">{stamp(v.departedAt)}</td>
                    <td className="py-2 pr-3">
                      {v.plateText ?? <span className="text-foreground/40">{v.plateStatus.toLowerCase()}</span>}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
