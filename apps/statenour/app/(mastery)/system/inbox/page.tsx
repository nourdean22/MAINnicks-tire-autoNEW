"use client";

import { useState } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";
import { relativeTimeSeconds as timeAgo } from "@/lib/utils/datetime";

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

  const handleResolve = async (id: string, verdict: "overwrite" | "reject" | "coexist") => {
    try {
      await resolveMutation.mutateAsync({ id, verdict });
    } catch (err) {
      console.error("Failed to resolve memory inbox item:", err);
    }
  };

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="Memory Ingestion Inbox"
      description={
        items.length > 0
          ? `${items.length} claim(s) quarantined for safety review`
          : "All ingested memories clear and committed"
      }
      width="3xl"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={new Date().toISOString()}
            source="db · MemoryInboxItem"
            onReload={() => quarantinedQuery.refetch()}
          />
          <button
            onClick={() => quarantinedQuery.refetch()}
            disabled={loading}
            className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
          >
            {loading ? "refreshing…" : "refresh"}
          </button>
        </div>
      }
    >
      {items.length === 0 ? (
        <Panel className="border-zinc-800/80 bg-[var(--bg-raised)]/[0.02] flex flex-col items-center justify-center p-12 text-center">
          <span className="text-4xl mb-4">🛡️</span>
          <h3 className="text-lg font-semibold text-zinc-100 mb-1">Memory Queue Clear</h3>
          <p className="text-xs text-zinc-500 max-w-sm">
            All facts ingested from external sources are safe. Any contradiction or security warnings will quarantine items here.
          </p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Sidebar list of quarantined items */}
          <div className="lg:col-span-5 space-y-3 max-h-[75vh] overflow-y-auto pr-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Quarantined Items ({items.length})
            </h2>
            {items.map((item) => {
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
                    "w-full text-left rounded-lg p-3 border transition flex flex-col gap-2 bg-[var(--bg-raised)]/[0.02]",
                    active
                      ? "border-[var(--gold)] bg-[var(--gold)]/[0.04]"
                      : isConflicting
                      ? "border-amber-500/30 hover:border-amber-500/50"
                      : "border-zinc-800/80 hover:border-zinc-700/80"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 bg-white/[0.04] px-1.5 py-0.5 rounded">
                      {item.sourceType}
                    </span>
                    <span className="text-[10px] text-zinc-500">{timeAgo(item.createdAt)}</span>
                  </div>
                  <p className="text-xs text-zinc-300 font-medium line-clamp-2">
                    {item.rawTextFenced}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                      <span>📄</span> {claimCount} claim{claimCount !== 1 ? "s" : ""}
                    </span>
                    {isConflicting && (
                      <span className="text-[10px] text-amber-400 font-semibold flex items-center gap-1 animate-pulse">
                        <span>⚠️</span> Contradiction Alert
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Main detail area */}
          {selectedItem && (
            <div className="lg:col-span-7 space-y-4">
              <Panel className="border-zinc-800/80 bg-[var(--bg-raised)]/[0.02] p-6 space-y-4">
                {/* Header detail */}
                <div className="flex items-start justify-between flex-wrap gap-4 border-b border-zinc-800/80 pb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                      <span>Memory Review</span>
                      <span className="text-xs font-normal text-zinc-500">
                        ({selectedItem.id.slice(0, 8)})
                      </span>
                    </h3>
                    <div className="text-xs text-zinc-500 mt-1 flex flex-col gap-1">
                      <div>
                        Source: <span className="font-mono text-zinc-400">{selectedItem.sourceType}</span>
                        {selectedItem.sourceUrl && (
                          <a
                            href={selectedItem.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--gold)] hover:underline ml-1"
                          >
                            [link]
                          </a>
                        )}
                      </div>
                      <div>
                        Privacy: <span className="font-mono text-zinc-400">{selectedItem.privacyClass}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleResolve(selectedItem.id, "reject")}
                      disabled={resolveMutation.isPending}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition"
                    >
                      Reject
                    </button>
                    {selectedItem.status === "conflicting" && (
                      <button
                        onClick={() => handleResolve(selectedItem.id, "overwrite")}
                        disabled={resolveMutation.isPending}
                        className="rounded-lg bg-amber-500 hover:bg-amber-600 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50 transition"
                      >
                        Overwrite Conflicting
                      </button>
                    )}
                    <button
                      onClick={() => handleResolve(selectedItem.id, "coexist")}
                      disabled={resolveMutation.isPending}
                      className="rounded-lg bg-[var(--gold)] hover:bg-[var(--gold)]/80 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50 transition"
                    >
                      Coexist
                    </button>
                  </div>
                </div>

                {/* Raw content fenced */}
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                    Raw Ingested Text
                  </span>
                  <div className="rounded bg-black/40 p-4 border border-zinc-800/60">
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-zinc-300 font-sans leading-relaxed">
                      {selectedItem.rawTextFenced}
                    </pre>
                  </div>
                </div>

                {/* Extracted claims */}
                <div className="space-y-2">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
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
                        return <p className="text-xs text-zinc-500 italic">No claims extracted</p>;
                      }

                      return claims.map((claim, idx) => (
                        <div
                          key={idx}
                          className="bg-zinc-900/60 border border-zinc-800 p-3 rounded-lg flex items-start justify-between gap-4"
                        >
                          <div className="text-xs text-zinc-300 font-sans leading-relaxed">
                            {claim.text}
                          </div>
                          {claim.confidence !== undefined && (
                            <span className="text-[10px] font-mono text-zinc-500 bg-white/[0.02] px-1.5 py-0.5 rounded flex-shrink-0">
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
                  <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                    <span className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1">
                      <span>⚠️</span> Semantic Conflicts Detected
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
                            <p className="text-xs text-zinc-500 italic">
                              Contradicting records metadata missing
                            </p>
                          );
                        }

                        return conflicts.map((conflict, idx) => (
                          <div
                            key={idx}
                            className="bg-amber-500/[0.02] border border-amber-500/20 p-3 rounded-lg space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                Conflicting Memory
                              </span>
                              {conflict.similarity !== undefined && (
                                <span className="text-[10px] font-mono text-amber-400/80">
                                  Similarity: {Math.round(conflict.similarity * 100)}%
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-300 leading-relaxed font-sans">
                              {conflict.content}
                            </div>
                            {conflict.createdAt && (
                              <div className="text-[9px] text-zinc-500 font-mono">
                                Saved: {new Date(conflict.createdAt).toLocaleString()}
                              </div>
                            )}
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </Panel>
            </div>
          )}
        </div>
      )}
    </StandardPage>
  );
}
