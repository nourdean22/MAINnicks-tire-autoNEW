"use client";

/**
 * /pins — pin management UI.
 *
 * v6 · BATCH 6 · Apr 28. Surface for the pinned_user brain memory
 * category. Top-5 pins inject into every system prompt; pins beyond
 * #5 are still queryable but not auto-loaded.
 *
 * Power moves wired:
 *   · staleness badges (>14d amber, >30d red)
 *   · token-cost estimate (top-5 only count toward prompt budget)
 *   · inline edit + label + source filter
 *   · drag handle for re-order (planned for next iteration)
 *   · "remind me" callbacks via reminder action
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { cn } from "@/lib/utils/cn";
import { Pin, PinOff, Plus, Edit3, Save, X, Sparkles, AlertCircle } from "lucide-react";

// Phase YY (2026-05-19 AM) · authedFetch replaced with trpc · 4 sites
// (list · create · edit · delete) on the brain router.
// Phase straggler-pages (2026-05-22) · the last call-site — the
// prompt-cache-flush hot-path in createNewPin — is migrated onto the
// existing `system.flushPromptCache` procedure. Zero use-authed-fetch
// imports remain. Legacy REST route stays mounted.
import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged, onDataChanged } from "@/lib/events/data-change";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { selectInjectedPinIds } from "@/lib/pins/injected";
interface PinRow {
  id: string;
  key: string;
  content: string;
  source: string | null;
  confidence: number;
  seenCount: number;
  createdAt: string;
  updatedAt: string;
  metadata: { label?: string; pinnedAt?: string } | null;
}

interface Stats {
  freshPins: number;
  stalePins: number;
  veryStalePins: number;
  totalChars: number;
  avgChars: number;
  bySource: Record<string, number>;
  injectedCount: number;
  estimatedPromptTokens: number;
  oldestUpdatedAt: string | null;
}

interface PinsResponse {
  pins: PinRow[];
  count: number;
  stats?: Stats;
}

function staleness(updatedAt: string): "fresh" | "warm" | "stale" | "very-stale" {
  const age = Date.now() - new Date(updatedAt).getTime();
  const day = 86_400_000;
  if (age < 7 * day) return "fresh";
  if (age < 14 * day) return "warm";
  if (age < 30 * day) return "stale";
  return "very-stale";
}

function staleClass(s: ReturnType<typeof staleness>): string {
  return {
    fresh: "border-emerald-500/30 bg-emerald-500/5",
    warm: "border-sky-500/30 bg-sky-500/5",
    stale: "border-amber-500/30 bg-amber-500/5",
    "very-stale": "border-rose-500/30 bg-rose-500/5",
  }[s];
}

export default function PinsPage() {
  // iOS-PWA-safe confirm · window.confirm() is silently suppressed in
  // standalone mode so the early-return always fired.
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [data, setData] = useState<PinsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editLabel, setEditLabel] = useState("");
  // v10.0.439 · sort key · 5 modes
  type PinSort = "default" | "freshest" | "stalest" | "alpha" | "longest";
  const [sortKey, setSortKey] = useState<PinSort>(() => {
    if (typeof window === "undefined") return "default";
    const saved = window.localStorage.getItem("pins:sortKey");
    const valid: PinSort[] = ["default", "freshest", "stalest", "alpha", "longest"];
    return saved && valid.includes(saved as PinSort) ? (saved as PinSort) : "default";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("pins:sortKey", sortKey);
  }, [sortKey]);
  const [newContent, setNewContent] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  // Phase YY · tRPC migration · same `load` shape preserved for the
  // existing event-bus refresh hook (`onDataChanged(["brain"])`).
  const utils = trpc.useUtils();
  const createPinMutation = trpc.brain.createPin.useMutation();
  const updatePinMutation = trpc.brain.updatePin.useMutation();
  const deletePinMutation = trpc.brain.deletePin.useMutation();
  // Phase straggler-pages · the post-write prompt-cache hot-flush.
  const flushPromptCacheMutation = trpc.system.flushPromptCache.useMutation();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await utils.brain.pinned.fetch({ withStats: true });
      setData(json as unknown as PinsResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [utils]);

  useEffect(() => {
    void load();
  }, [load]);

  // v10.0.529.88 · Wave 32 · refresh when chat tool pinMemory fires
  // (TOOL_DOMAIN_MAP targets "brain") or when the swipe-to-pin gesture
  // on chat fires the same notify. Pre-Wave-32 /pins relied on a
  // single mount-load · operator could pin via chat and see nothing
  // until manual refresh.
  useEffect(() => {
    return onDataChanged(["brain"], () => void load());
  }, [load]);

  const startEdit = (p: PinRow) => {
    setEditingId(p.id);
    setEditContent(p.content);
    setEditLabel(p.metadata?.label ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
    setEditLabel("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await updatePinMutation.mutateAsync({
        id: editingId,
        content: editContent,
        label: editLabel || undefined,
      });
      cancelEdit();
      await load();
      // v10.0.529.90 · Wave 34 · fire the bus so chat (whose system
      // prompt embeds pins) + /brain (which renders the same rows)
      // refresh instantly · pre-Wave-34 these stayed up to 60s stale
      // when the operator edited a pin from /pins.
      notifyDataChanged("brain", { source: "pins-page", detail: "pin-edit" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const unpin = async (id: string) => {
    const ok = await confirm({
      title: "Unpin this?",
      body: "Removes from system-prompt context.",
      confirmLabel: "Unpin",
    });
    if (!ok) return;
    try {
      await deletePinMutation.mutateAsync({ id });
      await load();
      notifyDataChanged("brain", { source: "pins-page", detail: "pin-unpin", id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const createNewPin = async () => {
    if (!newContent.trim()) return;
    setCreating(true);
    try {
      await createPinMutation.mutateAsync({
        content: newContent,
        label: newLabel || undefined,
        source: "pin:manual",
      });
      setNewContent("");
      setNewLabel("");
      // After a write, hot-flush the prompt cache so the next chat turn
      // sees the new pin without waiting for the 45s TTL to expire.
      // Fire-and-forget · a flush failure must not block the pin create.
      flushPromptCacheMutation.mutate({ reason: "pin write — manual" });
      await load();
      notifyDataChanged("brain", { source: "pins-page", detail: "pin-create" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  // Which pins actually inject into the system prompt — computed from the
  // SERVER (injection) order, NOT the display sort, so the "injected" badge
  // stays correct when the operator re-sorts (e.g. "stalest first").
  const injectedIds = useMemo(
    () => selectInjectedPinIds((data?.pins ?? []).map((p) => p.id), data?.stats?.injectedCount),
    [data],
  );

  return (
    <StandardPage
      eyebrow="NOUR OS · Brain"
      title="pinned memory"
      description={
        data?.stats
          ? `${data.count} pins`
          : "loading…"
      }
      width="lg"
      rhythm="comfortable"
      loading={loading && !data}
    >

      {error && (
        <Panel className="border-rose-500/40 bg-rose-500/10">
          <div className="flex items-center gap-2 p-3 text-sm text-rose-200">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </Panel>
      )}

      {/* New pin */}
      <Panel>
        <h2 className="mb-2 text-sm font-semibold text-white flex items-center gap-1">
          <Plus className="h-4 w-4" /> pin a new fact
        </h2>
        <div className="space-y-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="optional label (e.g. 'shop floor rule')"
            className="w-full rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-white/25"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="The fact / rule / preference (max 2000 chars). Top-5 most-recent pins inject into every system prompt."
            className="w-full h-24 rounded-md border border-white/10 bg-black/40 p-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-white/25 font-mono"
          />
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-zinc-500">{newContent.length} / 2000</span>
            <button
              onClick={createNewPin}
              disabled={creating || !newContent.trim()}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                creating
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50",
              )}
            >
              {creating ? "Pinning…" : "Pin"}
            </button>
          </div>
        </div>
      </Panel>

      {/* Stats */}
      {data?.stats && (
        <Panel>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
            <Stat label="fresh" value={data.stats.freshPins} tone="text-emerald-300" />
            <Stat label="stale" value={data.stats.stalePins} tone="text-amber-300" />
            <Stat label="very stale" value={data.stats.veryStalePins} tone="text-rose-300" />
            <Stat label="injected" value={data.stats.injectedCount} tone="text-sky-300" />
            <Stat label="prompt tokens" value={data.stats.estimatedPromptTokens} tone="text-[var(--gold)]/80" />
          </div>
        </Panel>
      )}

      {/* Pin list */}
      {data && data.pins.length > 0 && (
        <div className="space-y-2">
          {/* v10.0.439 · sort dropdown · 5 modes */}
          <div className="flex justify-end">
            <SortDropdown<PinSort>
              value={sortKey}
              onChange={setSortKey}
              defaultValue="default"
              ariaLabel="Sort pins"
              options={[
                { value: "default", label: "default · injection order" },
                { value: "freshest", label: "freshest · newest update" },
                { value: "stalest", label: "stalest · oldest update" },
                { value: "alpha", label: "alpha · A→Z" },
                { value: "longest", label: "longest content" },
              ]}
            />
          </div>
          {[...data.pins].sort((a, b) => {
            switch (sortKey) {
              case "freshest":
                return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
              case "stalest":
                return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
              case "alpha":
                return (a.metadata?.label ?? a.content).localeCompare(b.metadata?.label ?? b.content);
              case "longest":
                return (b.content?.length ?? 0) - (a.content?.length ?? 0);
              case "default":
              default:
                return 0;
            }
          }).map((p) => {
            const stale = staleness(p.updatedAt);
            const isInjected = injectedIds.has(p.id);
            const isEditing = editingId === p.id;
            return (
              <Panel
                key={p.id}
                className={cn(
                  staleClass(stale),
                  isInjected && "ring-1 ring-emerald-500/30",
                )}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="label"
                      className="w-full rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-xs text-zinc-200"
                    />
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full h-24 rounded-md border border-white/10 bg-black/40 p-2 text-sm text-zinc-100 font-mono"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={saveEdit}
                        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 px-2 py-1 text-xs hover:bg-emerald-500/15"
                      >
                        <Save className="h-3 w-3 inline mr-1" />
                        save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-md border border-white/10 bg-white/[0.02] text-zinc-400 px-2 py-1 text-xs hover:bg-white/5"
                      >
                        <X className="h-3 w-3 inline mr-1" />
                        cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isInjected ? (
                        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                          <Sparkles className="h-2.5 w-2.5 inline mr-0.5" /> injected
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-500/10 border border-zinc-500/20 text-zinc-500">
                          stored
                        </span>
                      )}
                      {p.metadata?.label && (
                        <span className="text-[10px] font-medium text-zinc-300">{p.metadata.label}</span>
                      )}
                      <span className="text-[9px] text-zinc-500 ml-auto">
                        {p.source ?? "—"} · {new Date(p.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-200 whitespace-pre-wrap">{p.content}</p>
                    <div className="flex gap-1 pt-1">
                      <button
                        onClick={() => startEdit(p)}
                        className="text-[10px] text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-0.5 min-h-[44px] px-1 -mx-1"
                      >
                        <Edit3 className="h-3 w-3" /> edit
                      </button>
                      <span className="text-[10px] text-zinc-600">·</span>
                      <button
                        onClick={() => unpin(p.id)}
                        className="text-[10px] text-rose-400 hover:text-rose-200 inline-flex items-center gap-0.5 min-h-[44px] px-1 -mx-1"
                      >
                        <PinOff className="h-3 w-3" /> unpin
                      </button>
                    </div>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {!loading && data && data.pins.length === 0 && (
        <Panel>
          <p className="p-4 text-center text-sm text-zinc-500">
            No pins yet. Add one above to inject it into every system prompt.
          </p>
        </Panel>
      )}
      {/* iOS-PWA-safe confirm mount · renders null when idle. */}
      {confirmDialog}
    </StandardPage>
  );
}

function Stat({ label, value, tone = "text-zinc-300" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border-l-2 border-edge py-1 pl-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">{label}</div>
      <div className={cn("mt-0.5 font-mono text-lg font-bold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

