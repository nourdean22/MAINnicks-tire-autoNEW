"use client";

/**
 * /system/devices — fleet-level device deck (W3).
 *
 * Answers: "which devices are alive, which dropped, when did the
 * local-agent last phone home, what's in the command backlog?"
 *
 * Alive elements:
 *   · agent-liveness banner with minutes-silent + status tint
 *   · per-device staleness dot (live/stale/lost) with pulse on live
 *   · platform grouping with device-type emoji
 *   · auto-refresh 30s
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { cn } from "@/lib/utils/cn";

import { authedFetch } from "@/hooks/use-authed-fetch";
type AgentStatus = "live" | "stale" | "dead" | "never";
type Staleness = "live" | "stale" | "lost";

interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  deviceType: string;
  location: string | null;
  status: string;
  lastSeenAt: string | null;
  minutesSinceLastSeen: number | null;
  staleness: Staleness;
  pendingCommands: number;
  failedCommands24h: number;
  recentEvents24h: number;
}

interface Feed {
  rows: DeviceRow[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byPlatform: Record<string, number>;
    byLocation: Record<string, number>;
    byType: Record<string, number>;
    byStaleness: Record<Staleness, number>;
    commandQueue: { pending: number; failed24h: number };
    agent: {
      status: AgentStatus;
      lastHeartbeatAt: string | null;
      minutesSilent: number | null;
    };
  };
  generatedAt: string;
}

const TYPE_ICON: Record<string, string> = {
  CAMERA: "📷",
  LOCK: "🔒",
  SPEAKER: "🔊",
  HEATER: "🔥",
  IR_REMOTE: "📡",
  SENSOR: "📟",
  LIGHT: "💡",
  THERMOSTAT: "🌡",
  APPLIANCE: "🔌",
  OTHER: "◻",
};

// v11.1 G6 · count rows eligible for retire-stale sweep.
function offlineStaleCount(feed: Feed): number {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return feed.rows.filter((r) => {
    if (r.status === "ONLINE") return false;
    if (!r.lastSeenAt) return true;
    return new Date(r.lastSeenAt).getTime() < sevenDaysAgo;
  }).length;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function StalenessDot({ s }: { s: Staleness }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        s === "live"  && "bg-emerald-400 animate-pulse",
        s === "stale" && "bg-amber-400",
        s === "lost"  && "bg-rose-400",
      )}
    />
  );
}

function AgentBanner({ agent }: { agent: Feed["summary"]["agent"] }) {
  const tint = {
    live:  { bg: "from-emerald-500/10 to-emerald-500/[0.02]", border: "border-emerald-500/30", text: "text-emerald-200", dot: "bg-emerald-400 animate-pulse" },
    stale: { bg: "from-amber-500/10 to-amber-500/[0.02]",     border: "border-amber-500/30",   text: "text-amber-200",   dot: "bg-amber-400" },
    dead:  { bg: "from-rose-500/10 to-rose-500/[0.02]",       border: "border-rose-500/40",    text: "text-rose-200",    dot: "bg-rose-400 animate-pulse" },
    never: { bg: "from-zinc-500/10 to-zinc-500/[0.02]",       border: "border-zinc-600/40",    text: "text-zinc-300",    dot: "bg-zinc-500" },
  }[agent.status];
  return (
    <div className={cn("rounded-xl border bg-gradient-to-br p-4", tint.bg, tint.border)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn("inline-block h-3 w-3 rounded-full", tint.dot)} />
          <div>
            <div className={cn("text-xs font-medium uppercase tracking-[0.2em]", tint.text)}>
              local agent · {agent.status}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-400">
              {agent.status === "never"
                ? "no DeviceEvent rows ever written · bridge never connected"
                : `last heartbeat ${timeAgo(agent.lastHeartbeatAt)} (${agent.minutesSilent}m silent)`}
            </div>
          </div>
        </div>
        {agent.status !== "live" && (
          <div className="text-right text-[10px] text-zinc-500">
            <div>expected cadence: 5–10 min</div>
            <div className="mt-0.5">see docs/DEVICE-RPC.md</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DevicesPage() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState<string | "all">("all");
  const [locationFilter, setLocationFilter] = useState<string | "all">("all");
  // v10.0.437 · sort key · 5 modes · default = name (alphabetical)
  type DeviceSort = "name" | "online-first" | "offline-first" | "last-seen-newest" | "errors-first";
  const [sortKey, setSortKey] = useState<DeviceSort>(() => {
    if (typeof window === "undefined") return "name";
    const saved = window.localStorage.getItem("system-devices:sortKey");
    const valid: DeviceSort[] = ["name", "online-first", "offline-first", "last-seen-newest", "errors-first"];
    return saved && valid.includes(saved as DeviceSort) ? (saved as DeviceSort) : "name";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("system-devices:sortKey", sortKey);
  }, [sortKey]);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch("/api/system/devices", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setFeed(json.data ?? json);
    } catch (e) {
      console.error("devices load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, [load]);

  const filtered = useMemo(() => {
    if (!feed) return [];
    const list = feed.rows.filter((r) => {
      if (platformFilter !== "all" && r.platform !== platformFilter) return false;
      if (locationFilter !== "all" && (r.location ?? "unknown") !== locationFilter) return false;
      return true;
    });
    // v10.0.437 · sort dispatch
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "online-first": {
          const oa = a.status === "ONLINE" ? 0 : 1;
          const ob = b.status === "ONLINE" ? 0 : 1;
          if (oa !== ob) return oa - ob;
          return a.name.localeCompare(b.name);
        }
        case "offline-first": {
          const oa = a.status === "OFFLINE" ? 0 : 1;
          const ob = b.status === "OFFLINE" ? 0 : 1;
          if (oa !== ob) return oa - ob;
          return a.name.localeCompare(b.name);
        }
        case "last-seen-newest": {
          const at = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
          const bt = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
          return bt - at;
        }
        case "errors-first":
          return (b.failedCommands24h ?? 0) - (a.failedCommands24h ?? 0);
        case "name":
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [feed, platformFilter, locationFilter, sortKey]);

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="Devices"
      description={
        feed
          ? `${feed.summary.total} total · ${feed.summary.byStatus.ONLINE ?? 0} online · ${feed.summary.byStatus.OFFLINE ?? 0} offline · ${feed.summary.byStatus.ERROR ?? 0} error · ${feed.summary.byStatus.UNKNOWN ?? 0} unknown`
          : "loading…"
      }
      width="2xl"
      rhythm="loose"
      actions={
          <div className="flex items-center gap-2">
            {/* v10.0.437 · sort dropdown · 5 modes */}
            <SortDropdown<DeviceSort>
              value={sortKey}
              onChange={setSortKey}
              defaultValue="name"
              ariaLabel="Sort devices"
              options={[
                { value: "name", label: "name · A→Z" },
                { value: "online-first", label: "online first" },
                { value: "offline-first", label: "offline first" },
                { value: "last-seen-newest", label: "last seen · newest" },
                { value: "errors-first", label: "errors first" },
              ]}
            />
            {/* v11.1 G6 · Retire offline fleet — nukes any device
                with status != ONLINE whose lastSeenAt is > 7d.
                Confirm gate. Cascades DeviceCommand + DeviceEvent. */}
            {feed && offlineStaleCount(feed) > 0 && (
              <button
                onClick={async () => {
                  const { authedFetch } = await import("@/hooks/use-authed-fetch");
                  const dry = await authedFetch("/api/devices/retire-stale", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ olderThanDays: 7, dryRun: true }),
                  });
                  const dryData = await dry.json().catch(() => ({}));
                  const count = dryData?.data?.count ?? 0;
                  if (count === 0) return;
                  const confirmed = confirm(
                    `Retire ${count} stale devices? This deletes the row + all their queued commands + event history. Cannot be undone.`,
                  );
                  if (!confirmed) return;
                  await authedFetch("/api/devices/retire-stale", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ olderThanDays: 7 }),
                  });
                  load();
                }}
                className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition"
                title="Delete offline/unknown/error devices stale >7d"
              >
                retire stale fleet
              </button>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
            >
              {loading ? "refreshing…" : "refresh"}
            </button>
          </div>
      }
    >

      {feed && (
        <>
          {/* Agent liveness banner */}
          <AgentBanner agent={feed.summary.agent} />

          {/* Rollups strip */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
              <RollupCell label="online"  value={feed.summary.byStatus.ONLINE ?? 0}  tint="text-emerald-400" />
              <RollupCell label="offline" value={feed.summary.byStatus.OFFLINE ?? 0} tint={feed.summary.byStatus.OFFLINE ? "text-rose-400 animate-pulse" : "text-zinc-500"} />
              <RollupCell label="error"   value={feed.summary.byStatus.ERROR ?? 0}   tint={feed.summary.byStatus.ERROR ? "text-rose-400 animate-pulse" : "text-zinc-500"} />
              <RollupCell label="unknown" value={feed.summary.byStatus.UNKNOWN ?? 0} tint={feed.summary.byStatus.UNKNOWN ? "text-amber-400" : "text-zinc-500"} />
              <RollupCell label="cmds pending"    value={feed.summary.commandQueue.pending}    tint={feed.summary.commandQueue.pending > 5 ? "text-amber-400 animate-pulse" : "text-sky-400"} />
              <RollupCell label="cmds failed 24h" value={feed.summary.commandQueue.failed24h} tint={feed.summary.commandQueue.failed24h > 0 ? "text-rose-400" : "text-zinc-500"} />
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-zinc-500">
              <span>staleness: <span className="text-emerald-400">live {feed.summary.byStaleness.live}</span> · <span className="text-amber-400">stale {feed.summary.byStaleness.stale}</span> · <span className="text-rose-400">lost {feed.summary.byStaleness.lost}</span></span>
            </div>
          </Panel>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPlatformFilter("all")}
              className={cn("rounded-full px-3 py-1 text-xs transition", platformFilter === "all" ? "bg-white/10 text-white" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60")}
            >
              all platforms · {feed.summary.total}
            </button>
            {Object.entries(feed.summary.byPlatform)
              .sort(([, a], [, b]) => b - a)
              .map(([platform, count]) => (
                <button
                  key={platform}
                  onClick={() => setPlatformFilter(platform === platformFilter ? "all" : platform)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition",
                    platformFilter === platform ? "bg-cyan-500/20 text-cyan-200" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                  )}
                >
                  {platform} · {count}
                </button>
              ))}
            <span className="text-xs text-zinc-600">·</span>
            <button
              onClick={() => setLocationFilter("all")}
              className={cn("rounded-full px-3 py-1 text-xs transition", locationFilter === "all" ? "bg-white/10 text-white" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60")}
            >
              any location
            </button>
            {Object.entries(feed.summary.byLocation)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 8)
              .map(([loc, count]) => (
                <button
                  key={loc}
                  onClick={() => setLocationFilter(loc === locationFilter ? "all" : loc)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition",
                    locationFilter === loc ? "bg-fuchsia-500/20 text-fuchsia-200" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                  )}
                >
                  {loc} · {count}
                </button>
              ))}
          </div>

          {/* Device grid */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-500">no devices match the filters</p>
            ) : (
              <div className="grid gap-2">
                {filtered.map((d) => (
                  <a
                    key={d.id}
                    href={`/devices/${d.id}`}
                    className={cn(
                      "group grid grid-cols-[auto_auto_1fr_auto_auto_auto] items-center gap-3 rounded-lg border px-3 py-2.5 transition",
                      d.staleness === "live"  && "border-emerald-500/20 bg-emerald-500/[0.02] hover:border-emerald-500/40",
                      d.staleness === "stale" && "border-amber-500/20 bg-amber-500/[0.02] hover:border-amber-500/40",
                      d.staleness === "lost"  && "border-zinc-800/40 bg-zinc-900/20 hover:border-rose-500/30",
                    )}
                  >
                    <StalenessDot s={d.staleness} />
                    <span className="flex-shrink-0 text-lg">{TYPE_ICON[d.deviceType] ?? "◻"}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-zinc-100">{d.name}</span>
                        <span className="flex-shrink-0 rounded bg-white/[0.04] px-1.5 py-[1px] text-[9px] uppercase tracking-wider text-zinc-400">
                          {d.platform}
                        </span>
                        {d.location && (
                          <span className="flex-shrink-0 text-[10px] text-zinc-500">@ {d.location}</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-[10px] text-zinc-500">
                        <span>{d.deviceType}</span>
                        <span>·</span>
                        <span>last seen {timeAgo(d.lastSeenAt)}</span>
                      </div>
                    </div>
                    <div className="hidden text-right text-[10px] text-zinc-500 md:block">
                      <div>{d.recentEvents24h} events · 24h</div>
                    </div>
                    <div className="flex flex-col items-end">
                      {d.pendingCommands > 0 && (
                        <span className="rounded bg-sky-500/10 px-1.5 py-[1px] text-[9px] text-sky-300">
                          {d.pendingCommands} pending
                        </span>
                      )}
                      {d.failedCommands24h > 0 && (
                        <span className="mt-0.5 rounded bg-rose-500/10 px-1.5 py-[1px] text-[9px] text-rose-300">
                          {d.failedCommands24h} failed
                        </span>
                      )}
                    </div>
                    <span className={cn(
                      "rounded px-2 py-0.5 text-[9px] uppercase tracking-wider",
                      d.status === "ONLINE"  ? "bg-emerald-500/15 text-emerald-300" :
                      d.status === "OFFLINE" ? "bg-rose-500/15 text-rose-300" :
                      d.status === "ERROR"   ? "bg-rose-500/20 text-rose-200" :
                      "bg-zinc-500/15 text-zinc-400",
                    )}>
                      {d.status}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </Panel>

          {feed.summary.agent.status !== "live" && (
            <Panel className="border-amber-500/30 bg-amber-500/[0.03]">
              <h3 className="mb-2 text-sm font-semibold text-amber-300">⚠ agent side of bridge is cold</h3>
              <div className="space-y-2 text-[11px] text-zinc-400">
                <p>
                  the statenour-os side of the device RPC bridge is healthy — every device row above
                  is backed by fresh DB rows and the command queue is live.
                </p>
                <p>
                  what&apos;s missing: the Python local-agent running on the Windows box that polls
                  GET /api/devices/queue and drains the pending commands.
                </p>
                <p>
                  to restart:
                  <code className="ml-2 rounded bg-zinc-900 px-1 py-0.5 font-mono text-[10px]">
                    powershell -ExecutionPolicy Bypass -File C:\NOUR_OS\install-service.ps1
                  </code>
                </p>
                <p className="text-zinc-500">
                  full rehab procedure: docs/RUNBOOK.md § device bridge.
                </p>
              </div>
            </Panel>
          )}
        </>
      )}

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        auto-refresh 30s · source: SmartDevice + DeviceCommand + DeviceEvent
      </p>
    </StandardPage>
  );
}

function RollupCell({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="rounded-lg bg-[var(--bg-raised)]/[0.03] p-3 text-center">
      <div className={cn("text-2xl font-bold tabular-nums", tint)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
