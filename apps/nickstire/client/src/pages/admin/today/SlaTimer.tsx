/**
 * SlaTimer — SLA color-coded age badge for action-queue items.
 *
 * 2026-05-23 · extracted from OverviewSection.tsx (Phase 3 split) so
 * other surfaces (work orders · leads · callbacks) can reuse the same
 * green/yellow/red severity bands without duplicating the threshold
 * logic. Same green-<2h / yellow-2-8h / red->8h bands as wave-181.
 */
import { Timer } from "lucide-react";

export function getTimeSince(dateStr: string | Date): { label: string; minutes: number; severity: "green" | "yellow" | "red" } {
  const created = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  let label: string;
  if (mins < 60) label = `${mins}m`;
  else if (hours < 24) label = `${hours}h ${mins % 60}m`;
  else label = `${days}d ${hours % 24}h`;

  // SLA thresholds: green <2h, yellow 2-8h, red >8h
  const severity = mins < 120 ? "green" : mins < 480 ? "yellow" : "red";
  return { label, minutes: mins, severity };
}

export function SlaTimer({ dateStr }: { dateStr: string | Date }) {
  const { label, severity } = getTimeSince(dateStr);
  const colors = {
    green: "text-emerald-400 bg-emerald-500/10",
    yellow: "text-amber-400 bg-amber-500/10",
    red: "text-red-400 bg-red-500/10 animate-pulse",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wide ${colors[severity]}`}>
      <Timer className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}
