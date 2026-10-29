"use client";

import { useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";
import { relativeTimeSeconds as timeAgo } from "@/lib/utils/datetime";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

// UI v3 W5c: 44 px verbs (iOS tap floor), one shape for all three.
const VERB =
  "inline-flex min-h-[44px] items-center rounded-control px-4 text-[13px] font-semibold transition-colors duration-[var(--motion-state)] disabled:opacity-50";

interface ExtractedClaim {
  id?: string;
  text: string;
  confidence?: number;
}

interface ContradictionLog {
  id?: string;
  content: string;
  similarity?: number;
  category?: string;
  createdAt?: string;
}

interface InboxItem {
  id: string;
  sourceUrl: string | null;
  sourceType: string;
  rawTextFenced: string;
  extractedClaims: unknown;
  contradictionLogs: unknown;
  privacyClass: string;
  status: string;
  createdAt: string;
}

export default function MemoryInboxPage() {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const quarantinedQuery = trpc.system.getQuarantinedItems.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const resolveMutation = trpc.system.resolveInboxItem.useMutation({
    onSuccess: () => {
      quarantinedQuery.refetch();
    },
  });

  const items = (quarantinedQuery.data as InboxItem[] | undefined) ?? [];
  const loading = quarantinedQuery.isPending || quarantinedQuery.isFetching;
  // 2026-10-10 · audit 02-F13: no read (failed, or not landed yet) is not a
  // clear queue. Only a successful read may say "clear ... safe". A failed poll
  // keeps the last data, so an old empty [] must not read as clear either.
  const readFailed = quarantinedQuery.isError && items.length === 0;
  const notYetRead = !quarantinedQuery.data && !quarantinedQuery.isError;

  const { confirm, dialog } = useConfirmDialog();
  const handleResolve = async (id: string, verdict: "overwrite" | "reject" | "coexist") => {
    // Overwrite replaces a saved memory with the quarantined claim: one in-DOM confirm first
    // (2026-10-29 sync audit, finding 6; never window.confirm, which iOS standalone suppresses).
    if (
      verdict === "overwrite" &&
      !(await confirm({
        title: "Overwrite the saved memory?",
        body: "The conflicting memory is replaced by this claim.",
        confirmLabel: "Overwrite",
        tone: "danger",
      }))
    ) {
      return;
    }
    try {
      await resolveMutation.mutateAsync({ id, verdict });
    } catch {
      // A failed ruling used to vanish into the console; the item stays in the queue, so say so.
      toast.error("Could not save the ruling. The item is still in the queue.");
    }
  };

  // W5b lanes: `conflicting` is the one status that needs a ruling; everything else waits under Other.
  const priority = items.filter((item) => item.status === "conflicting");
  const other = items.filter((item) => item.status !== "conflicting");
  const [otherOpen, setOtherOpen] = useState(false);

  // An Other item is selectable only while Other is open; with no choice, only a Priority item
  // opens by itself (a collapsed item's text and verbs never show behind a closed disclosure).
  const selectedItem =
    items.find(
      (item) => item.id === selectedItemId && (item.status === "conflicting" || otherOpen),
    ) ??
    priority[0] ??
    null;
  const toggleOther = () => {
    if (otherOpen && other.some((item) => item.id === selectedItemId)) setSelectedItemId(null);
    setOtherOpen((v) => !v);
  };

  const renderItem = (item: InboxItem) => {
    const active = selectedItem?.id === item.id;
    const isConflicting = item.status === "conflicting";

    // Count claims
    let claimCount = 0;
    if (Array.isArray(item.extractedClaims)) claimCount = item.extractedClaims.length;
    else if (item.extractedClaims) claimCount = 1;

    return (
      <button
        key={item.id}
        onClick={() => setSelectedItemId(item.id)}
        className={cn(
          "w-full text-left rounded-control p-3 border transition flex flex-col gap-2",
          active
            ? "border-accent bg-accent-soft"
            : isConflicting
            ? "border-amber-500/30 hover:border-amber-500/50"
            : "border-edge-subtle hover:border-edge-default"
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-fg-secondary bg-surface-interactive px-1.5 py-0.5 rounded-micro">
            {item.sourceType}
          </span>
          <span className="text-[11px] text-fg-tertiary">{timeAgo(item.createdAt)}</span>
        </div>
        <p className="text-xs text-fg font-medium line-clamp-2">
          {item.rawTextFenced}
        </p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[11px] text-fg-tertiary flex items-center gap-1">
            {claimCount} claim{claimCount !== 1 ? "s" : ""}
          </span>
          {isConflicting && (
            <span className="text-[11px] text-amber-400 font-semibold flex items-center gap-1">
              Contradiction Alert
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="Memory inbox"
      descriptionVisibility="always"
      description={
        items.length > 0
          ? `${items.length} claim(s) quarantined for safety review`
          : readFailed
            ? "Queue state unknown: read failed"
            : notYetRead
              ? "Reading the queue…"
              : "All ingested memories clear and committed"
      }
      width="3xl"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          <FreshnessChip
            // 2026-09-10 · render time is not evidence freshness. See
            // system/tools/page.tsx for the same fix.
            lastFetchedAt={
              quarantinedQuery.dataUpdatedAt ? new Date(quarantinedQuery.dataUpdatedAt) : null
            }
            source="db · MemoryInboxItem"
            onReload={() => quarantinedQuery.refetch()}
          />
          <button
            onClick={() => quarantinedQuery.refetch()}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center rounded-control border border-edge-strong bg-content px-4 text-[13px] font-medium text-fg-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      }
    >
      {readFailed ? (
        // A fixed sentence, never the raw server message (2026-10-29 sync audit, finding 16).
        <EmptyState
          provenance="ERROR"
          tone="warning"
          title="Queue state unknown - read failed"
          why="A failed read clears nothing. The quarantine queue was not read, so it may not be empty."
          cta={{ label: "Retry", onClick: () => void quarantinedQuery.refetch() }}
        />
      ) : notYetRead ? (
        <p className="border-l-2 border-edge-strong py-1 pl-4 text-[15px] text-fg-tertiary">Reading the queue…</p>
      ) : items.length === 0 ? (
        <section className="border-l-2 border-edge-strong pl-5 sm:pl-6">
          <h2 className="vt-eyebrow text-fg-secondary">Memory Queue Clear</h2>
          <p className="mt-2 max-w-[56ch] text-[15px] leading-relaxed text-fg-secondary">
            All facts ingested from external sources are safe. Any contradiction or security warning quarantines an item here.
          </p>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Sidebar list of quarantined items */}
          <div data-inbox-list="" className="lg:col-span-5 space-y-4 max-h-[75vh] overflow-y-auto pr-1">
              <h2 className="font-mono text-[11px] text-fg-tertiary mb-2">
              Quarantined Items ({items.length})
            </h2>
            <section aria-labelledby="inbox-priority-heading" className="space-y-3">
              <h3 id="inbox-priority-heading" className="text-[13px] font-medium text-fg-secondary">
                Priority
                <span className="ml-2 font-mono text-[12px] tabular-nums text-fg-tertiary">{priority.length}</span>
              </h3>
              {priority.length === 0 ? (
                <p className="text-[14px] text-fg-tertiary">Nothing needs a ruling.</p>
              ) : (
                priority.map(renderItem)
              )}
            </section>
            {other.length > 0 && (
              <section aria-label="Other quarantined items" className="space-y-3">
                <button
                  type="button"
                  aria-expanded={otherOpen}
                  aria-controls="inbox-other-list"
                  onClick={toggleOther}
                  className="inline-flex min-h-[44px] items-center gap-2 text-[14px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg"
                >
                  Other, {other.length}
                  <span className="font-mono text-[12px] text-fg-tertiary">{otherOpen ? "shown" : "hidden"}</span>
                </button>
                {otherOpen && (
                  <div id="inbox-other-list" className="space-y-3">
                    {other.map(renderItem)}
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Main detail area */}
          {selectedItem && (
            <div className="lg:col-span-7 space-y-4">
              <section aria-label="Memory review" className="space-y-4 border-l-2 border-edge-strong pl-5 sm:pl-6">
                {/* Header detail */}
                <div className="flex items-start justify-between flex-wrap gap-4 border-b border-edge-subtle pb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
                      <span>Memory Review</span>
                      <span className="text-xs font-normal text-fg-tertiary">
                        ({selectedItem.id.slice(0, 8)})
                      </span>
                    </h3>
                    <div className="text-xs text-fg-tertiary mt-1 flex flex-col gap-1">
                      <div>
                        Source: <span className="font-mono text-fg-secondary">{selectedItem.sourceType}</span>
                        {selectedItem.sourceUrl && /^https?:\/\//.test(selectedItem.sourceUrl) ? (
                          <a
                            href={selectedItem.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-fg-secondary hover:underline ml-1"
                          >
                            [link]
                          </a>
                        ) : selectedItem.sourceUrl ? (
                          // 2026-09-02 · ingestion rows carry an identity like
                          // gmail://<messageId>, not a navigable URL, show it,
                          // don't link it.
                          <span className="font-mono text-fg-tertiary ml-1">{selectedItem.sourceUrl}</span>
                        ) : null}
                      </div>
                      <div>
                        Privacy: <span className="font-mono text-fg-secondary">{selectedItem.privacyClass}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => handleResolve(selectedItem.id, "reject")}
                      disabled={resolveMutation.isPending}
                      className={cn(VERB, "border border-edge-subtle bg-content text-fg hover:bg-surface-hover")}
                    >
                      Reject
                    </button>
                    {selectedItem.status === "conflicting" && (
                      <button
                        onClick={() => handleResolve(selectedItem.id, "overwrite")}
                        disabled={resolveMutation.isPending}
                        className={cn(VERB, "bg-amber-500 text-black hover:bg-amber-600")}
                      >
                        Overwrite Conflicting
                      </button>
                    )}
                    <button
                      onClick={() => handleResolve(selectedItem.id, "coexist")}
                      disabled={resolveMutation.isPending}
                      className={cn(VERB, "bg-accent text-[var(--text-inverse)] hover:bg-accent-hover")}
                    >
                      Coexist
                    </button>
                  </div>
                </div>

                {/* Raw content fenced */}
                <div className="space-y-1.5">
              <span className="font-mono text-[11px] text-fg-tertiary">
                    Raw Ingested Text
                  </span>
                  <div className="rounded-micro bg-content p-4 border border-edge-subtle">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-fg font-sans leading-relaxed">
                      {selectedItem.rawTextFenced}
                    </pre>
                  </div>
                </div>

                {/* Extracted claims */}
                <div className="space-y-2">
              <span className="font-mono text-[11px] text-fg-tertiary">
                    Extracted Claims
                  </span>
                  <div className="space-y-1.5">
                    {(() => {
                      let claims: ExtractedClaim[] = [];
                      try {
                        if (Array.isArray(selectedItem.extractedClaims)) {
                          claims = selectedItem.extractedClaims as ExtractedClaim[];
                        } else if (typeof selectedItem.extractedClaims === "string") {
                          claims = [{ text: selectedItem.extractedClaims }];
                        } else if (selectedItem.extractedClaims && typeof selectedItem.extractedClaims === "object") {
                          const obj = selectedItem.extractedClaims as any;
                          if (obj.text) claims = [obj];
                        }
                      } catch (err) {
                        // ignore
                      }

                      if (claims.length === 0) {
                        return <p className="text-xs text-fg-tertiary italic">No claims extracted</p>;
                      }

                      return claims.map((claim, idx) => (
                        <div
                          key={idx}
                          className="bg-content border border-edge-subtle p-3 rounded-surface flex items-start justify-between gap-4"
                        >
                          <div className="text-xs text-fg font-sans leading-relaxed">
                            {claim.text}
                          </div>
                          {claim.confidence !== undefined && (
                            <span className="text-[11px] font-mono text-fg-tertiary px-1.5 py-0.5 rounded-micro flex-shrink-0">
                              conf: {Math.round(claim.confidence * 100)}%
                            </span>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                {/* Contradiction comparison panel */}
                {selectedItem.status === "conflicting" && (
                  <div className="space-y-2 pt-2 border-t border-edge-subtle">
              <span className="text-[13px] font-medium text-amber-300 flex items-center gap-1">
                      Semantic Conflicts Detected
                    </span>
                    <div className="space-y-2">
                      {(() => {
                        let conflicts: ContradictionLog[] = [];
                        try {
                          if (Array.isArray(selectedItem.contradictionLogs)) {
                            conflicts = selectedItem.contradictionLogs as ContradictionLog[];
                          } else if (typeof selectedItem.contradictionLogs === "string") {
                            conflicts = [{ content: selectedItem.contradictionLogs }];
                          }
                        } catch (err) {
                          // ignore
                        }

                        if (conflicts.length === 0) {
                          return (
                            <p className="text-xs text-fg-tertiary italic">
                              Contradicting records metadata missing
                            </p>
                          );
                        }

                        return conflicts.map((conflict, idx) => (
                          <div
                            key={idx}
                            className="bg-amber-500/[0.02] border border-amber-500/20 p-3 rounded-surface space-y-2"
                          >
                            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded-micro">
                                Conflicting Memory
                              </span>
                              {conflict.similarity !== undefined && (
                                <span className="text-[11px] font-mono text-amber-400/80">
                                  Similarity: {Math.round(conflict.similarity * 100)}%
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-fg leading-relaxed font-sans">
                              {conflict.content}
                            </div>
                            {conflict.createdAt && (
                              <div className="text-[11px] text-fg-tertiary font-mono">
                                Saved: {new Date(conflict.createdAt).toLocaleString()}
                              </div>
                            )}
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}
      {dialog}
    </StandardPage>
  );
}
