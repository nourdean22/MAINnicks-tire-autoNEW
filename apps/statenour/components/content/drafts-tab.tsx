"use client";

/**
 * DraftsTab · the Drafts section of the merged /content surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/content/drafts/page.tsx — the
 * only changes are: the outer <StandardPage> wrapper became a fragment (the
 * page-level chrome now lives on /content), the former StandardPage
 * `description` + `actions` (FreshnessChip) moved into an inline header row,
 * the former rhythm="comfortable" spacing is preserved via a `space-y-4`
 * wrapper, and the approved-draft "Schedule →" link now points at the
 * Publish tab (/content?tab=publish&caption=…) instead of the retired
 * /social route. The 4-stat rollup, status filter, approve/reject flow, and
 * the polling read are unchanged.
 */

import { useState } from "react";
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

export function DraftsTab() {
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
  const [confirmKey, setConfirmKey] = useState<{ key: string; action: "approve" | "reject" } | null>(null);
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

  const handleActionClick = (key: string, actionKind: "approve" | "reject") => {
    if (confirmKey?.key === key && confirmKey.action === actionKind) {
      setConfirmKey(null);
      action(key, actionKind);
    } else {
      setConfirmKey({ key, action: actionKind });
      setTimeout(() => {
        setConfirmKey((prev) => (prev?.key === key && prev.action === actionKind ? null : prev));
      }, 3000);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-[var(--text-secondary)]" style={{ maxWidth: "60ch" }}>
          Nick-generated drafts waiting for review · tap approve to mark ready ·
          tap reject to drop · approved drafts link to the Publish tab for scheduling.
        </p>
        <FreshnessChip
          lastFetchedAt={data?.generatedAt}
          source="content/drafts table"
          onReload={reload}
        />
      </div>

      <div className="space-y-4">
        {/* 4-stat rollup · same pattern as /people + /system/cockpit */}
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

                  {/* On-the-fly Image Preview */}
                  <div className="my-3 overflow-hidden rounded border border-[var(--border-default)] bg-[var(--bg-raised)] max-w-sm">
                    <div className="border-b border-[var(--border-default)] bg-black/10 px-3 py-1.5 text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      Visual Asset Preview
                    </div>
                    <div className="p-3 flex justify-center bg-black/20">
                      <img
                        src={`/api/content/render-asset?id=${d.id}`}
                        alt="Visual Preview"
                        className="h-auto w-full max-w-[280px] rounded shadow-lg object-contain aspect-square bg-[var(--bg-void)] border border-[var(--border-default)]"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </div>
                  </div>

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
                            onClick={() => handleActionClick(d.key, "approve")}
                            disabled={busyKey === d.key}
                            className={cn(
                              "min-h-[44px] px-4 rounded-md border text-sm font-medium transition-all duration-200 disabled:opacity-50",
                              confirmKey?.key === d.key && confirmKey.action === "approve"
                                ? "border-emerald-500 bg-emerald-500/20 text-emerald-200 font-bold px-5"
                                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                            )}
                          >
                            {busyKey === d.key ? "…" : confirmKey?.key === d.key && confirmKey.action === "approve" ? "Confirm Approve" : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleActionClick(d.key, "reject")}
                            disabled={busyKey === d.key}
                            className={cn(
                              "min-h-[44px] px-4 rounded-md border text-sm font-medium transition-all duration-200 disabled:opacity-50",
                              confirmKey?.key === d.key && confirmKey.action === "reject"
                                ? "border-rose-500 bg-rose-500/20 text-rose-200 font-bold px-5"
                                : "border-zinc-500/40 bg-zinc-500/5 text-zinc-300 hover:bg-zinc-500/15"
                            )}
                          >
                            {busyKey === d.key ? "…" : confirmKey?.key === d.key && confirmKey.action === "reject" ? "Confirm Reject" : "Reject"}
                          </button>
                        </>
                      )}
                      {isApproved && (
                        <Link
                          href={`/content?tab=publish&caption=${encodeURIComponent(d.content)}`}
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
      </div>
    </>
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
