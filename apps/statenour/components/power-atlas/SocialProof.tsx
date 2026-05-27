"use client";

/**
 * <SocialProof> · 2026-05-27 · Power Atlas Phase 3
 *
 * Renders the cross-mention roster for a person · "who in your network
 * appears alongside this person in chat history". Sourced from
 * trpc.task.socialProofFor which aggregates over the operator's full
 * PersonProfile set.
 *
 * Surfaces ·
 *   · cluster spotting (this person rolls with that person in my head)
 *   · bridge candidates (high-cross-mention = high social proof)
 *   · introduction targets (who can vouch for them)
 *
 * Aesthetic · matches the Phase 2 detail-panel cards · serif heading ·
 * 1px border · monospace counts · NO emojis.
 */

import { trpc } from "@/lib/trpc/client";

interface SocialProofProps {
  personId: string;
}

export default function SocialProof({ personId }: SocialProofProps) {
  const { data, isLoading } = trpc.task.socialProofFor.useQuery({ personId });

  if (isLoading) {
    return (
      <section
        className="rounded-xl border bg-[var(--bg-raised)] p-4"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)] mb-2">
          Social proof
        </h2>
        <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
      </section>
    );
  }

  const mentions = data?.mentionsByPerson ?? [];

  if (mentions.length === 0) {
    return (
      <section
        className="rounded-xl border bg-[var(--bg-raised)] p-4"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)] mb-2">
          Social proof
        </h2>
        <p className="text-xs text-[var(--text-tertiary)]">
          No cross-mentions yet. As you talk about this person alongside
          others in chat, this list builds the cluster map.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border bg-[var(--bg-raised)] p-4"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)]">
          Social proof
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums">
          {data?.totalCrossMentions ?? 0} cross-mentions
        </span>
      </div>
      <ol className="space-y-2">
        {mentions.map((m) => (
          <li
            key={m.personId}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-[var(--text-secondary)] truncate">
              {m.personName}
            </span>
            <span className="font-mono tabular-nums text-[var(--text-tertiary)] text-xs">
              {m.mentionCount}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
