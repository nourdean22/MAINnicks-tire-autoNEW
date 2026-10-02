"use client";

/**
 * AlertInspector · an alert as an object · 2026-09-15 (System flagship).
 *
 * Alerts ARE BrainMemory rows (routers/brain.ts `activeAlerts` /
 * `resolveAlert`), so the read is the same by-id procedure the memory
 * inspector uses — one read path, soft-delete filtered. What differs is the
 * verb set: RESOLVE (soft-deletes the row; the alerts list and the Brain
 * card already exclude deletedAt) and MUTE the category for 7 days (an
 * expiring `alert_mute` row the builder honours server-side). Both existed
 * only on the home ActiveAlertsCard; the /system/alerts list itself had no
 * verbs. Resolve is two-tap in the DOM — a PWA gets no window.confirm.
 */

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { errorCodeOf } from "@/lib/services/metric-result";
import { formatAge } from "@/lib/ui/metric-datum";
import { cn } from "@/lib/utils";
import { EvidenceMark } from "@/components/ui/evidence-mark";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import { useInspector } from "@/hooks/use-inspector";
import type { InspectorPanelProps } from "@/components/inspector/panels/memory-inspector";

export const ALERT_MUTE_DAYS = 7;

export function AlertInspector({ entity }: InspectorPanelProps) {
  const query = trpc.brain.memoryById.useQuery({ id: entity.id }, { staleTime: 30_000, retry: 1 });
  const utils = trpc.useUtils();
  const { closeInspector } = useInspector();
  const [armed, setArmed] = useState(false);
  const resolve = trpc.brain.resolveAlert.useMutation({
    onSuccess: (res) => {
      void utils.brain.activeAlerts.invalidate();
      void utils.brain.memoryById.invalidate({ id: entity.id });
      if (res.ok) {
        toast.success("Alert resolved");
        closeInspector();
      } else {
        toast.error("Nothing to resolve — it was already gone");
      }
    },
    onError: () => toast.error("Could not resolve the alert"),
  });
  const mute = trpc.brain.muteAlertCategory.useMutation({
    onSuccess: (res) => {
      void utils.brain.activeAlerts.invalidate();
      toast.success(`Muted until ${new Date(res.until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
    },
    onError: () => toast.error("Could not mute the category"),
  });
  const now = new Date();

  if (query.isLoading) return <InspectorNotice state="loading" kind="alert" />;
  if (query.isError) return <InspectorNotice state="error" kind="alert" code={errorCodeOf(query.error)} />;
  const m = query.data;
  if (!m) {
    return (
      <div className="space-y-4">
        <InspectorNotice state="not-found" kind="alert" />
        <EntityActionRow entities={[entity]} />
      </div>
    );
  }

  const busy = resolve.isPending || mute.isPending;
  const label = m.content.replace(/\s+/g, " ").trim().slice(0, 80);

  return (
    <div className="space-y-5" data-alert-inspector={m.id}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-micro border border-amber-500/30 bg-amber-500/10 px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.12em] text-amber-300">
            {m.category}
          </span>
          <span className="font-mono text-[11px] text-fg-tertiary">{formatAge(m.createdAt, now)}</span>
          <EvidenceMark
            provenance={{ evidence: m.evidence, source: m.source, trustTier: m.trustTier, seenCount: m.seenCount, createdAt: m.createdAt }}
            now={now}
          />
        </div>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-fg">{m.content}</p>
        {m.key ? <p className="font-mono text-[11px] text-fg-tertiary">key · {m.key}</p> : null}
      </header>

      <div className="flex flex-wrap gap-2" data-alert-actions>
        <button
          type="button"
          disabled={busy}
          aria-pressed={armed}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              window.setTimeout(() => setArmed(false), 4000);
              return;
            }
            setArmed(false);
            resolve.mutate({ id: m.id });
          }}
          className={cn(
            "inline-flex min-h-[44px] items-center rounded-control border px-3 text-[13px] font-medium transition-colors duration-[var(--motion-state)] md:min-h-[36px]",
            armed
              ? "border-rose-500/50 bg-rose-500/15 text-rose-200"
              : "border-accent bg-accent-soft text-fg hover:bg-accent-medium",
          )}
        >
          {armed ? "Tap again to resolve" : "Resolve"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => mute.mutate({ category: m.category, days: ALERT_MUTE_DAYS })}
          className="inline-flex min-h-[44px] items-center rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg md:min-h-[36px]"
        >
          Mute {m.category} · {ALERT_MUTE_DAYS}d
        </button>
      </div>
      <p className="font-mono text-[11px] text-fg-tertiary">
        resolve soft-deletes this alert (the receipt is its deletedAt) · mute hides the whole category from the list and the home card
      </p>

      <EntityActionRow entities={[entity]} labelOf={() => label} />
    </div>
  );
}
