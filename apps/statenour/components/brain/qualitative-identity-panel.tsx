"use client";

/**
 * QualitativeIdentityPanel — values / fears / style / rhythms / red
 * lines. Each bucket is a stacked list with an add button + per-row
 * remove. Manual entries show a gold dot to distinguish them from
 * auto-extracted entries.
 */

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { Loader2, Plus, X, RefreshCw, Compass } from "lucide-react";
import { DismissButton } from "@/components/ui/dismiss-button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";
// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/identity/
// qualitative")` (GET + POST + PATCH) onto `trpc.brain.qualitativeIdentity`
// (reactive read) + `trpc.brain.recomputeQualitativeIdentity` +
// `trpc.brain.editQualitativeIdentity` (mutations).
import { trpc } from "@/lib/trpc/client";

type Bucket = "values" | "fears" | "operating_style" | "rhythms" | "red_lines";

interface Entry {
  text: string;
  manual: boolean;
  evidence_ids: string[];
  confidence: number;
  updated_at: string;
}

interface Identity {
  values: Entry[];
  fears: Entry[];
  operating_style: Entry[];
  rhythms: Entry[];
  red_lines: Entry[];
  computed_at: string;
}

const BUCKET_LABELS: Record<Bucket, string> = {
  values: "Values",
  fears: "Fears",
  operating_style: "Operating style",
  rhythms: "Rhythms",
  red_lines: "Red lines",
};

const BUCKET_COLOR: Record<Bucket, string> = {
  values: "text-emerald-400",
  fears: "text-red-400",
  operating_style: "text-fg-secondary",
  rhythms: "text-blue-400",
  red_lines: "text-violet-400",
};

export function QualitativeIdentityPanel() {
  const utils = trpc.useUtils();
  const identityQuery = trpc.brain.qualitativeIdentity.useQuery(undefined);
  const recomputeMutation =
    trpc.brain.recomputeQualitativeIdentity.useMutation();
  const editMutation = trpc.brain.editQualitativeIdentity.useMutation();

  const [adding, setAdding] = useState<Bucket | null>(null);
  const [addText, setAddText] = useState("");
  const [busy, setBusy] = useState(false);

  const identity =
    (identityQuery.data?.identity as Identity | undefined) ?? null;
  const loading = identityQuery.isLoading;
  const loadedAt = identityQuery.dataUpdatedAt || null;
  const recomputing = recomputeMutation.isPending;

  const load = useCallback(() => {
    void utils.brain.qualitativeIdentity.invalidate();
  }, [utils]);

  const recompute = useCallback(async () => {
    try {
      await recomputeMutation.mutateAsync();
      await utils.brain.qualitativeIdentity.invalidate();
      toast.success("qualitative identity recomputed");
    } catch (e) {
      toast.error(`recompute failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [recomputeMutation, utils]);

  const addEntry = useCallback(
    async (bucket: Bucket) => {
      if (!addText.trim()) return;
      setBusy(true);
      try {
        await editMutation.mutateAsync({
          action: "add",
          bucket,
          text: addText,
        });
        await utils.brain.qualitativeIdentity.invalidate();
        setAdding(null);
        setAddText("");
      } catch (e) {
        toast.error(`add failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(false);
      }
    },
    [addText, editMutation, utils],
  );

  const removeEntry = useCallback(
    async (bucket: Bucket, text: string) => {
      setBusy(true);
      try {
        await editMutation.mutateAsync({ action: "remove", bucket, text });
        await utils.brain.qualitativeIdentity.invalidate();
      } catch (e) {
        toast.error(`remove failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(false);
      }
    },
    [editMutation, utils],
  );

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Compass size={12} className="text-fg-secondary" />
          <p className="section-label">Qualitative identity</p>
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => void load()} />
          <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
            · values / fears / style / rhythms / red lines
          </span>
        </div>
        <button
          onClick={() => void recompute()}
          disabled={recomputing}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
        >
          {recomputing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          recompute
        </button>
      </div>

      {loading && !identity && (
        <div className="flex items-center gap-2 py-6 justify-center text-[11px] text-[var(--text-tertiary)]">
          <Loader2 size={12} className="animate-spin" />
          loading…
        </div>
      )}

      {/* A FAILED READ RENDERED A BLANK BODY. `loading && !identity` gated
          the spinner and `identity &&` gated ALL content — including the
          per-bucket "(empty — add one…)" hint — so a DB failure
          (lib/brain/qualitative-identity.ts:303-318 has no internal catch,
          so it propagates) left this card as a header, a recompute button
          and a paragraph of explanatory copy about content that was not
          there. Indistinguishable from an identity with five empty
          buckets, which is the state the copy invites you to fix.
          Same three-state discipline as
          components/brain/contradiction-resolution-panel.tsx:296-305. */}
      {!loading && !identity && (
        <EmptyState
          icon={Compass}
          title={
            identityQuery.isError
              ? "Qualitative identity unavailable"
              : "Identity not read"
          }
          provenance={identityQuery.isError ? "ERROR" : "UNMEASURED"}
          tone="warning"
          why={
            identityQuery.isError
              ? "The read failed, so nothing is known about the values / fears / style / rhythms / red lines on file. That is NOT an empty self-model — do not add entries to fill it."
              : "The read returned no identity envelope at all. Nothing has been measured here, so this is NOT an empty self-model — do not add entries to fill it."
          }
          unlock="Reload above. If it keeps failing, check the brain router and the qualitative_identity row."
          cta={{ label: "reload", onClick: () => void load() }}
        />
      )}
      {!loading && !identity && identityQuery.isError && (
        <p className="mt-1 text-[11px] font-mono text-red-300/70 break-words text-center">
          {identityQuery.error.message}
        </p>
      )}

      {identity && (
        <div className="space-y-3">
          {(Object.keys(BUCKET_LABELS) as Bucket[]).map((b) => (
            <div key={b}>
              <div className="flex items-center justify-between mb-1">
                <p className={cn("text-[11px] font-mono", BUCKET_COLOR[b])}>
                  {BUCKET_LABELS[b]} ({identity[b].length})
                </p>
                <button
                  onClick={() => { setAdding(b); setAddText(""); }}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control sm:min-h-5 sm:min-w-5 border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-fg hover:border-edge-strong justify-center"
                  title="add manual entry"
                >
                  <Plus size={9} />
                </button>
              </div>
              {adding === b && (
                <div className="flex items-center gap-1.5 mb-1.5">
                  <input
                    autoFocus
                    value={addText}
                    onChange={(e) => setAddText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void addEntry(b)}
                    placeholder={`add to ${BUCKET_LABELS[b].toLowerCase()}…`}
                    className="flex-1 px-2 py-1 bg-surface-interactive border border-[var(--border-default)] rounded-control text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => void addEntry(b)}
                    disabled={busy}
                    className="inline-flex min-h-11 items-center rounded-control px-2.5 sm:min-h-6 sm:px-2 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono"
                  >
                    add
                  </button>
                  <button
                    onClick={() => { setAdding(null); setAddText(""); }}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control sm:min-h-6 sm:min-w-6 border border-[var(--border-default)] text-[var(--text-tertiary)] justify-center"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
              <div className="space-y-1">
                {identity[b].map((e) => (
                  <div
                    key={e.text}
                    className="group flex items-center gap-2 px-2 py-1.5 rounded-micro border border-[var(--border-default)] bg-[var(--bg-base)]"
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", e.manual ? "bg-fg-secondary" : "bg-[var(--text-tertiary)]/40")} />
                    <span className="flex-1 text-[11px] text-[var(--text-primary)]">{e.text}</span>
                    <DismissButton
                      onClick={() => void removeEntry(b, e.text)}
                      label="Remove identity entry"
                      alwaysVisible
                      size="sm"
                      className="hover:text-red-400"
                    />
                  </div>
                ))}
                {identity[b].length === 0 && (
                  <p className="text-[11px] text-[var(--text-tertiary)] italic">(empty — add one or let reflection auto-extract)</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-tertiary)] mt-3 leading-relaxed">
        Pulled from reflections + chat importance + beliefs over 60d. Manual entries
        (gold dot) always survive re-computes. Chat route injects this as "## Nour's
        qualitative identity" so Nick anchors in WHO you are, not a generic persona.
      </p>
    </GlassCard>
  );
}
