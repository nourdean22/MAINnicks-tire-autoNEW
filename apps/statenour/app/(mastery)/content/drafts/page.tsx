"use client";

/**
 * /content/drafts — approval queue for content drafts.
 * v10.0.529.106 · Wave 76.
 *
 * Pre-Wave-76 the content pipeline shipped posts directly · no
 * operator-facing approval queue. This page closes that loop:
 *
 *   · 4-stat rollup (pending / approved / scheduled / rejected)
 *   · sort by status · pending first
 *   · per-draft card: content preview · suggested platforms · age
 *   · one-tap approve / reject · approved drafts get a "Schedule"
 *     CTA that links to /social with the draft body pre-filled
 *
 * Editorial-minimalist · matches /relationships + /system/cockpit
 * patterns from earlier waves in this session.
 */

import { useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
// misc-pages slice (2026-05-22) · the approve/reject action moved off
// authedFetch onto trpc.operator.actOnDraft. The list still flows
// through usePollingFetch (a cross-cutting hook · separate slice).
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import Link from "next/link";

type DraftStatus = "pending" | "approved" | "rejected" | "scheduled" | "published";

interface ContentDraft {
  id: string;
  key: string;
  content: string;
  metadata: {
    imageUrl?: string | null;
    suggestedPlatforms?: string[];
    status: DraftStatus;
    generatedAt: string;
    approvedAt?: string;
    kind?: string;
    source?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface DraftsResponse {
  drafts: ContentDraft[];
  counts: Record<DraftStatus | "total", number>;
  generatedAt: string;
}

const STATUS_FILTERS = ["pending", "approved", "scheduled", "all"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const STATUS_TONE: Record<DraftStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: "border-amber-500/30 bg-amber-500/[0.04]", text: "text-amber-200", label: "pending" },
  approved: { bg: "border-emerald-500/30 bg-emerald-500/[0.04]", text: "text-emerald-200", label: "approved" },
  scheduled: { bg: "border-sky-500/30 bg-sky-500/[0.04]", text: "text-sky-200", label: "scheduled" },
  published: { bg: "border-zinc-500/30 bg-zinc-500/[0.04]", text: "text-zinc-300", label: "published" },
  rejected: { bg: "border-rose-500/30 bg-rose-500/[0.04]", text: "text-rose-200", label: "rejected" },
};

function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.round(ms / 3600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function DraftsPage() {
  const [statusFilter, setStatusFilter] = useLocalStorageState<StatusFilter>(
    "content-drafts:status",
    "pending",
    STATUS_FILTERS,
  );
  const { data, loading, reload } = usePollingFetch<DraftsResponse>(
    `/api/content/drafts?status=${statusFilter}&limit=100`,
    { intervalMs: 60_000 },
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const actOnDraft = trpc.operator.actOnDraft.useMutation();

  async function action(key: string, kind: "approve" | "reject") {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await actOnDraft.mutateAsync({ key, action: kind });
      toast.success(kind === "approve" ? "Approved" : "Rejected");
      reload();
    } catch {
      toast.error(kind === "approve" ? "Failed to approve" : "Failed to reject");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <StandardPage
      eyebrow="content · drafts"
      title="approval queue"
      description="Nick-generated drafts waiting for review · tap approve to mark ready · tap reject to drop · approved drafts link to /social for scheduling"
      rhythm="comfortable"
      width="2xl"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.generatedAt}
          source="content/drafts table"
          onReload={reload}
        />
      }
    >
      {/* 4-stat rollup · same pattern as /relationships + /system/cockpit */}
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="pending" value={data.counts.pending} tint={data.counts.pending > 0 ? "text-amber-300" : "text-zinc-500"} />
          <Stat label="approved" value={data.counts.approved} tint="text-emerald-300" />
          <Stat label="scheduled" value={data.counts.scheduled} tint="text-sky-300" />
          <Stat label="rejected" value={data.counts.rejected} tint="text-zinc-500" />
        </div>
      )}

      {/* Status filter */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          {statusFilter === "pending" ? "needs review" :
           statusFilter === "approved" ? "ready to schedule" :
           statusFilter === "scheduled" ? "in queue" : "all drafts"}
        </h2>
        <SortDropdown
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          ariaLabel="Filter drafts by status"
          options={[
            { value: "pending", label: "pending review" },
            { value: "approved", label: "approved · ready" },
            { value: "scheduled", label: "scheduled" },
            { value: "all", label: "all drafts" },
          ]}
        />
      </div>

      {/* Empty state */}
      {data && data.drafts.length === 0 && !loading && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-6 text-center text-sm text-[var(--text-tertiary)]">
          {statusFilter === "pending"
            ? "Inbox zero · no drafts waiting for review. Ask Nick to generate ideas in chat."
            : `No ${statusFilter} drafts.`}
        </div>
      )}

      {/* Drafts list */}
      {data && data.drafts.length > 0 && (
        <div className="grid gap-2">
          {data.drafts.map((d) => {
            const tone = STATUS_TONE[d.metadata.status] ?? STATUS_TONE.pending;
            const isPending = d.metadata.status === "pending";
            const isApproved = d.metadata.status === "approved";
            return (
              <div
                key={d.key}
                className={cn("rounded-lg border p-4", tone.bg)}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={cn("h-auto rounded px-1.5 py-0.5 bg-transparent border-current text-[10px] font-normal uppercase tracking-wider", tone.text)}>
                      {tone.label}
                    </Badge>
                    {d.metadata.kind && (
                      <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                        {d.metadata.kind}
                      </span>
                    )}
                    {d.metadata.source && (
                      <span className="text-[10px] italic text-[var(--text-tertiary)]">
                        from {d.metadata.source}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums whitespace-nowrap">
                    {ageString(d.metadata.generatedAt)}
                  </span>
                </div>

                <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words mb-2">
                  {d.content.length > 360 ? `${d.content.slice(0, 360)}…` : d.content}
                </p>

                {d.metadata.suggestedPlatforms && d.metadata.suggestedPlatforms.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {d.metadata.suggestedPlatforms.map((p) => (
                      <Badge key={p} className="h-auto rounded px-1.5 py-0.5 bg-transparent border-[var(--border-default)] text-[var(--text-tertiary)] text-[10px] font-normal uppercase tracking-wider">
                        {p}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Action buttons · only for pending + approved */}
                {(isPending || isApproved) && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {isPending && (
                      <>
                        <button
                          type="button"
                          onClick={() => action(d.key, "approve")}
                          disabled={busyKey === d.key}
                          className="min-h-[44px] px-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 text-sm font-medium hover:bg-emerald-500/15 disabled:opacity-50"
                        >
                          {busyKey === d.key ? "…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => action(d.key, "reject")}
                          disabled={busyKey === d.key}
                          className="min-h-[44px] px-4 rounded-md border border-zinc-500/40 bg-zinc-500/5 text-zinc-300 text-sm font-medium hover:bg-zinc-500/15 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {isApproved && (
                      <Link
                        href={`/social?caption=${encodeURIComponent(d.content)}`}
                        className="min-h-[44px] px-4 rounded-md border border-sky-500/40 bg-sky-500/10 text-sky-200 text-sm font-medium hover:bg-sky-500/15 inline-flex items-center"
                      >
                        Schedule →
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-[var(--text-tertiary)]">loading drafts…</div>
      )}
    </StandardPage>
  );
}

function Stat({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-3 text-center">
      <div className={cn("text-2xl font-bold font-mono tabular-nums", tint)}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </div>
    </div>
  );
}
