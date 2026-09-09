/**
 * LotSection — live camera visit truth for the shop floor.
 *
 * Product boundary (ADR-0017, refined 2026-09-09): shop operations live here in
 * nickstire.org/admin. StateNour is the owner's OS and receives summaries and
 * anomalies, not the operational cockpit.
 *
 * The single rule this screen is built around: **a failed read must never render
 * as a confident zero.** "0 cars on the lot" and "the query threw" look identical
 * on a dashboard and mean opposite things, so every card here is driven by a
 * discriminated `{ ok }` result, an unreachable database shows an explicit error
 * banner, and a table that has never received an event says so rather than
 * quietly showing zeros.
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
} from "lucide-react";

const POLL_MS = 15_000;

function minutes(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${v % 60}m`;
}

function timeOnly(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/** Shown whenever a read failed. Never silently replaced by zeros. */
function ReadFailed({ what, reason }: { what: string; reason: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <div className="font-semibold text-red-400">{what} unavailable</div>
          <div className="text-foreground/70 mt-0.5">{reason}</div>
          <div className="text-foreground/50 mt-1">
            This is not an empty lot. The counters are hidden because the data
            could not be read.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LotSection() {
  const now = trpc.lot.now.useQuery(undefined, { refetchInterval: POLL_MS });
  const visits = trpc.lot.visits.useQuery(
    { limit: 50, openOnly: false },
    { refetchInterval: POLL_MS },
  );
  const health = trpc.lot.health.useQuery(undefined, { refetchInterval: POLL_MS });

  const n = now.data;
  const stale = n?.ok && n.staleSeconds !== null && n.staleSeconds > 300;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lot"
        subtitle="Live vehicle truth from the shop cameras"
        icon={<ParkingSquare className="w-5 h-5" />}
        badge={
          n?.ok === false
            ? { label: "Unavailable", variant: "danger" }
            : n?.ok && n.neverIngested
              ? { label: "Awaiting first event", variant: "neutral" }
              : stale
                ? { label: `Stale ${Math.round((n!.staleSeconds ?? 0) / 60)}m`, variant: "warning" }
                : { label: "Live", variant: "success" }
        }
      />

      {now.isLoading && <div className="text-[13px] text-foreground/50">Loading lot state…</div>}

      {n?.ok === false && <ReadFailed what="Lot counters" reason={n.reason} />}

      {n?.ok && n.neverIngested && (
        <EmptyState
          icon={<Camera className="w-5 h-5" />}
          title="No camera events yet"
          subtitle="The vision edge has not delivered a visit. Counters stay blank until real data arrives rather than showing zeros that look like an empty lot."
        />
      )}

      {n?.ok && !n.neverIngested && (
        <>
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
              label="Already parked"
              value={n.counts.preexisting}
              icon={<ShieldQuestion className="w-4 h-4" />}
              color="text-foreground/60"
              trendLabel="occupancy, not arrivals"
            />
          </MetricGrid>

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
            {n.bays.length === 0 ? (
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
      )}

      <Panel title="Camera health" icon={<Camera className="w-4 h-4" />}>
        {health.data?.ok === false ? (
          <ReadFailed what="Camera health" reason={health.data.reason} />
        ) : health.data?.ok && health.data.cameras.length === 0 ? (
          <div className="text-[13px] text-foreground/60">No camera has reported yet.</div>
        ) : (
          <div className="space-y-1.5">
            {health.data?.ok &&
              health.data.cameras.map((c) => (
                <div key={c.camera} className="flex items-center justify-between text-[13px] py-1.5 border-b border-foreground/5 last:border-0">
                  <span className="font-medium">{c.camera}</span>
                  <div className="flex items-center gap-3 text-foreground/70">
                    {c.detector && <span className="text-foreground/50">{c.detector}</span>}
                    {c.pose && <span className="text-foreground/50">{c.pose}</span>}
                    <span
                      className={
                        c.status === "healthy"
                          ? "text-emerald-400"
                          : c.status === "stale"
                            ? "text-amber-400"
                            : "text-foreground/50"
                      }
                    >
                      {c.status}
                      {c.ageSeconds !== null && c.status !== "healthy" ? ` · ${Math.round(c.ageSeconds / 60)}m ago` : ""}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </Panel>

      <Panel title="Recent visits" icon={<Car className="w-4 h-4" />}>
        {visits.data?.ok === false ? (
          <ReadFailed what="Visit list" reason={visits.data.reason} />
        ) : visits.data?.ok && visits.data.rows.length === 0 ? (
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
                {visits.data?.ok &&
                  visits.data.rows.map((v) => (
                    <tr key={v.visitId} className="border-b border-foreground/5 last:border-0">
                      <td className="py-2 pr-3">{timeOnly(v.arrivedAt)}</td>
                      <td className="py-2 pr-3">
                        {v.preexisting ? (
                          <span className="text-foreground/50">already parked</span>
                        ) : (
                          v.state
                        )}
                      </td>
                      <td className="py-2 pr-3">{v.bay ?? "—"}</td>
                      <td className="py-2 pr-3">{timeOnly(v.departedAt)}</td>
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
