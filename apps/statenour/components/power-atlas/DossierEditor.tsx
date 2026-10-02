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
 * Aesthetic: Geist heading · 1px edge-subtle border on a solid content card ·
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
      className="rounded-surface border border-edge-subtle bg-content p-4"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[17px] font-semibold text-fg">
          Dossier
        </h2>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
              updated {lastUpdated}
            </span>
          )}
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[13px] font-medium text-fg-secondary hover:text-fg transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {!editing ? (
        <div className="text-sm leading-relaxed text-fg-secondary whitespace-pre-wrap min-h-[6rem]">
          {initialDossier?.trim() ? (
            initialDossier
          ) : (
            <span className="italic text-fg-tertiary">
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
            <span className="font-mono text-[11px] text-fg-tertiary tabular-nums">
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
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() =>
                  updateDossier.mutate({ personId, dossierMd: draft })
                }
                disabled={updateDossier.isPending || draft === initialDossier}
              >
                {updateDossier.isPending ? "Saving…" : "Save"}
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
