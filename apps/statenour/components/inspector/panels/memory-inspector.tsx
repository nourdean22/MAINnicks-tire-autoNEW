"use client";

/**
 * MemoryInspector · the ONE view of a memory · 2026-09-15 (flagship slice 1).
 *
 * A Brain "Changed" row, a graph node, a Cmd+K semantic hit and a chat receipt
 * now all open THIS. It shows only facts the record carries (the graph
 * panel's rule, components/home/brain-node-detail-panel.tsx): content,
 * category, provenance (the commit-gateway class), attention (seen x N, age,
 * TTL), and the TIME slot — validity interval and the supersession chain,
 * which are code-live and data-empty today (docs/CURRENT-TRUTH.md BDN-310):
 * when they are absent the section says so instead of inventing a date.
 */

import { trpc } from "@/lib/trpc/client";
import { errorCodeOf } from "@/lib/services/metric-result";
import type { EntityRef } from "@/lib/ui/entity-ref";
import { formatAge } from "@/lib/ui/metric-datum";
import { EvidenceMark } from "@/components/ui/evidence-mark";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import { useInspector } from "@/hooks/use-inspector";

export interface InspectorPanelProps {
  entity: EntityRef;
  mode: "peek" | "inspect";
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">{label}</dt>
      <dd className="truncate font-mono text-[12px] text-fg-secondary">{value}</dd>
    </div>
  );
}

export function MemoryInspector({ entity }: InspectorPanelProps) {
  const query = trpc.brain.memoryById.useQuery({ id: entity.id }, { staleTime: 30_000, retry: 1 });
  const { openInspector } = useInspector();
  const now = new Date();

  if (query.isLoading) return <InspectorNotice state="loading" kind="memory" />;
  if (query.isError) return <InspectorNotice state="error" kind="memory" code={errorCodeOf(query.error)} />;
  const m = query.data;
  if (!m) {
    return (
      <div className="space-y-4">
        <InspectorNotice state="not-found" kind="memory" />
        <EntityActionRow entities={[entity]} />
      </div>
    );
  }

  const label = m.content.replace(/\s+/g, " ").trim().slice(0, 80);
  const ttl = m.expiresAt ? Math.ceil((new Date(m.expiresAt).getTime() - now.getTime()) / 86_400_000) : null;
  const hasTime = Boolean(m.validFrom || m.validUntil || m.supersededBy || m.supersedes.length > 0);

  return (
    <div className="space-y-5" data-memory-inspector={m.id}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-edge px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-fg-tertiary">
            {m.category}
          </span>
          <EvidenceMark
            provenance={{
              evidence: m.evidence,
              source: m.source,
              trustTier: m.trustTier,
              seenCount: m.seenCount,
              createdAt: m.createdAt,
              lastVerifiedAt: m.lastVerifiedAt,
              validFrom: m.validFrom,
              validUntil: m.validUntil,
              supersededById: m.supersededBy?.id ?? null,
            }}
            now={now}
          />
          {m.discoveryVerdict ? (
            <span className="rounded border border-edge px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-fg-tertiary">
              verdict · {m.discoveryVerdict}
            </span>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-fg">{m.content}</p>
      </header>

      <section aria-label="Attention">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Fact label="seen" value={m.seenCount === 1 ? "once" : `${m.seenCount}×`} />
          <Fact label="last seen" value={formatAge(m.lastSeen, now)} />
          <Fact label="recorded" value={formatAge(m.createdAt, now)} />
          <Fact label="confidence" value={`${m.confidence.toFixed(2)} · a sighting count, not certainty`} />
          <Fact label="ttl" value={ttl === null ? null : ttl <= 0 ? "expired" : `${ttl}d`} />
          <Fact label="created by" value={m.createdBy} />
        </dl>
      </section>

      <section aria-label="Proof">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">proof</p>
        <EvidenceMark
          inline
          provenance={{ evidence: m.evidence, source: m.source, trustTier: m.trustTier, seenCount: m.seenCount, createdAt: m.createdAt, lastVerifiedAt: m.lastVerifiedAt }}
          now={now}
        />
      </section>

      <section aria-label="Time" data-memory-time={hasTime ? "present" : "absent"}>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">time</p>
        {hasTime ? (
          <ul className="space-y-1 font-mono text-[12px] text-fg-secondary">
            {m.validFrom ? <li>believed since {new Date(m.validFrom).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</li> : null}
            {m.validUntil ? <li>valid until {new Date(m.validUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</li> : null}
            {m.supersededBy ? (
              <li>
                superseded by{" "}
                <button
                  type="button"
                  className="text-gold underline-offset-2 hover:underline"
                  onClick={() => openInspector({ kind: "memory", id: m.supersededBy!.id })}
                >
                  {m.supersededBy.content}
                </button>
              </li>
            ) : null}
            {m.supersedes.map((older) => (
              <li key={older.id}>
                supersedes{" "}
                <button
                  type="button"
                  className="text-gold underline-offset-2 hover:underline"
                  onClick={() => openInspector({ kind: "memory", id: older.id })}
                >
                  {older.content}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-mono text-[11px] text-fg-tertiary">
            no validity interval or supersession recorded · current belief by default
          </p>
        )}
      </section>

      <EntityActionRow entities={[entity]} labelOf={() => label} />
    </div>
  );
}
