"use client";

/**
 * <DossierEditor> · 2026-05-27 · Power Atlas Phase 1
 *
 * Markdown view + edit toggle for PersonProfile.dossierMd. View mode
 * renders a whitespace-preserving plain-text block (zero markdown
 * dependency · matches the minimalist surface). Edit mode swaps to a
 * textarea + save/cancel buttons; "save" calls
 * `trpc.task.updateDossier.useMutation()` which embeds + persists.
 *
 * Aesthetic: serif heading · 1px border at rgba(255,255,255,0.06) ·
 * 8-12px radius · no emoji.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface DossierEditorProps {
  personId: string;
  initialDossier: string | null;
  dossierUpdatedAt: string | null;
  onSaved?: () => void;
}

export default function DossierEditor({
  personId,
  initialDossier,
  dossierUpdatedAt,
  onSaved,
}: DossierEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDossier ?? "");
  const utils = trpc.useUtils();
  const updateDossier = trpc.task.updateDossier.useMutation({
    onSuccess: async () => {
      await utils.task.personProfile.invalidate({ personId });
      setEditing(false);
      onSaved?.();
    },
  });

  const lastUpdated = dossierUpdatedAt
    ? new Date(dossierUpdatedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <section
      className="rounded-xl border bg-[var(--bg-raised)] p-4"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)]">
          Dossier
        </h2>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              updated {lastUpdated}
            </span>
          )}
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--gold)] transition-colors"
            >
              edit
            </button>
          )}
        </div>
      </div>

      {!editing ? (
        <div className="text-sm leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap min-h-[6rem]">
          {initialDossier?.trim() ? (
            initialDossier
          ) : (
            <span className="italic text-[var(--text-tertiary)]">
              No dossier yet. Tap edit to write the first 5 bullets about this
              person — what they want, what they fear, what they bring.
            </span>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              "Markdown supported. Suggested skeleton:\n\n- Identity: ...\n- Wants: ...\n- Fears: ...\n- Strengths: ...\n- Recent context: ..."
            }
            className="min-h-[16rem] font-mono text-xs"
            maxLength={20000}
            disabled={updateDossier.isPending}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
              {draft.length} / 20000
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(initialDossier ?? "");
                  setEditing(false);
                }}
                disabled={updateDossier.isPending}
              >
                cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() =>
                  updateDossier.mutate({ personId, dossierMd: draft })
                }
                disabled={updateDossier.isPending || draft === initialDossier}
              >
                {updateDossier.isPending ? "saving…" : "save"}
              </Button>
            </div>
          </div>
          {updateDossier.error && (
            <div className="text-xs text-rose-300">
              {updateDossier.error.message}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
