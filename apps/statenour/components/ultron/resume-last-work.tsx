"use client";

/**
 * ResumeLastWork · v10.0.299 · "Continue X · paused Yh ago" pill on
 * Ultron HQ. Removes the daily "where was I?" friction · operator
 * lands on HQ and one tap puts them back in flow.
 *
 * Data source · /api/missions returns missions ordered by status ASC,
 * updatedAt DESC · the first ACTIVE (status != COMPLETED && !=
 * ARCHIVED) entry is the most recent thing the operator was doing.
 *
 * Renders silently if no active mission exists or if the most recent
 * one was touched within the last ~10 minutes (operator is mid-flow,
 * doesn't need a "resume" prompt for what they just did).
 *
 * Click → /tasks · the operator's main work surface where missions
 * live. Future · could deep-link to the specific mission detail.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { authedFetch } from "@/hooks/use-authed-fetch";

interface MissionLite {
  id: string;
  title?: string;
  status?: string;
  updatedAt?: string | Date;
}

interface ResumeData {
  // v10.0.529.41 · capture missionId so the resume link can deep-link
  // straight into /tasks?mission=<id> instead of dumping the operator
  // at the generic /tasks page · removes the "where was I?" friction
  // on a board with 20+ missions.
  id: string;
  title: string;
  updatedAt: string;
  ageMs: number;
}

const DORMANT_THRESHOLD_MS = 10 * 60_000; // 10 min · skip pill while mid-flow

function ageLabel(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function ResumeLastWork() {
  const [data, setData] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await authedFetch("/api/missions");
        if (!res.ok) return;
        const payload = await res.json();
        const missions: MissionLite[] = Array.isArray(payload)
          ? payload
          : (payload?.data ?? payload?.missions ?? []);
        // Find the most recently-touched mission that's still active.
        const active = missions.find((m) => {
          const s = (m.status ?? "").toUpperCase();
          return s !== "COMPLETED" && s !== "ARCHIVED" && s !== "DELETED";
        });
        if (!alive || !active || !active.title || !active.id) return;
        const updatedAt = active.updatedAt ? new Date(active.updatedAt).toISOString() : null;
        if (!updatedAt) return;
        const ageMs = Date.now() - new Date(updatedAt).getTime();
        if (ageMs < DORMANT_THRESHOLD_MS) {
          // Operator is mid-flow · don't render the resume prompt.
          setData(null);
          return;
        }
        setData({ id: active.id, title: active.title, updatedAt, ageMs });
      } catch {
        // best-effort · failure leaves the pill silent
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    // Refresh hourly so the age label stays roughly current.
    const id = setInterval(load, 3_600_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (loading || !data) return null;

  return (
    <Link
      // v10.0.529.41 · deep-link to the specific mission · removes the
      // generic /tasks landing friction. /tasks already filters on the
      // mission query param.
      href={`/tasks?mission=${encodeURIComponent(data.id)}`}
      data-no-anchor
      className="group flex items-center gap-2 rounded-lg border border-[var(--gold)]/25 bg-[var(--gold)]/[0.04] px-3 py-2 transition-all hover:bg-[var(--gold)]/[0.08] hover:border-[var(--gold)]/45 hover:scale-[1.005]"
    >
      <Clock size={12} className="text-[var(--gold)]/70 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[8px] font-mono uppercase tracking-wider text-[var(--gold)]/70">
          Resume · paused {ageLabel(data.ageMs)}
        </div>
        <div className="font-[var(--font-display)] text-[13px] font-bold text-[var(--text-primary)] truncate">
          {data.title}
        </div>
      </div>
      <ArrowRight
        size={14}
        className="text-[var(--gold)]/60 shrink-0 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
