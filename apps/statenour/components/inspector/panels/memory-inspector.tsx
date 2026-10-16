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

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { errorCodeOf } from "@/lib/services/metric-result";
import type { EntityRef } from "@/lib/ui/entity-ref";
import { formatAge } from "@/lib/ui/metric-datum";
import { forgetToast } from "@/lib/brain/search-copy-status";
import { cn } from "@/lib/utils";
import { EvidenceMark } from "@/components/ui/evidence-mark";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import { useInspector } from "@/hooks/use-inspector";

export interface InspectorPanelProps {
  entity: EntityRef;
  mode: "peek" | "inspect";
}

const ACTION_BTN =
  "inline-flex min-h-11 items-center rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50";

/**
 * 05-M12: forget or correct this memory. The mutations live in the armed
 * steps below, so the idle row is two plain buttons: Forget is two-tap in the
 * DOM (an iOS PWA gets no window.confirm), Correct opens an inline editor.
 */
function MemoryEditActions({ id, content, current }: { id: string; content: string; current: boolean }) {
  const [step, setStep] = useState<"idle" | "forget" | "correct">("idle");
  if (step === "forget") return <ForgetMemoryConfirm id={id} onCancel={() => setStep("idle")} />;
  if (step === "correct") return <CorrectMemoryEditor id={id} initial={content} onCancel={() => setStep("idle")} />;
  return (
    <div className="flex flex-wrap gap-2" data-memory-actions="idle">
      <button type="button" className={ACTION_BTN} onClick={() => setStep("forget")}>Forget</button>
      {current ? (
        <button type="button" className={ACTION_BTN} onClick={() => setStep("correct")}>Correct</button>
      ) : null}
    </div>
  );
}

export function ForgetMemoryConfirm({ id, onCancel }: { id: string; onCancel: () => void }) {
  const utils = trpc.useUtils();
  const { closeInspector } = useInspector();
  const forget = trpc.brain.forgetMemory.useMutation({
    onSuccess: (res) => {
      void utils.brain.memoryById.invalidate({ id });
      // Decided for every outcome: a retry can still leave a search copy indexed.
      const outcome = forgetToast(res);
      if (outcome.level === "warning") toast.warning(outcome.text);
      else if (outcome.level === "success") toast.success(outcome.text);
      else toast.error(outcome.text);
      if (res.deleted) closeInspector();
      else onCancel();
    },
    onError: () => toast.error("Could not forget the memory"),
  });
  return (
    <div className="flex flex-wrap gap-2" data-memory-actions="forget">
      <button
        type="button"
        disabled={forget.isPending}
        onClick={() => forget.mutate({ id })}
        className={cn(ACTION_BTN, "border-rose-500/50 bg-rose-500/15 text-rose-200 hover:text-rose-100")}
      >
        Tap again to forget
      </button>
      <button type="button" disabled={forget.isPending} onClick={onCancel} className={ACTION_BTN}>Keep</button>
    </div>
  );
}

export function CorrectMemoryEditor({ id, initial, onCancel }: { id: string; initial: string; onCancel: () => void }) {
  const utils = trpc.useUtils();
  const { openInspector } = useInspector();
  const [text, setText] = useState(initial);
  const correct = trpc.brain.correctMemory.useMutation({
    onSuccess: (res) => {
      void utils.brain.memoryById.invalidate();
      toast.success("Memory corrected");
      openInspector({ kind: "memory", id: res.id });
    },
    onError: (err) => toast.error(err.message || "Could not correct the memory"),
  });
  const next = text.trim();
  const unchanged = !next || next === initial.trim();
  return (
    <form
      className="space-y-2"
      data-memory-actions="correct"
      onSubmit={(e) => {
        e.preventDefault();
        if (!unchanged) correct.mutate({ id, content: next });
      }}
    >
      <textarea
        aria-label="Corrected memory"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={correct.isPending}
        maxLength={2000}
        rows={3}
        autoFocus
        className="w-full min-h-11 resize-y rounded-control border border-edge-default bg-content px-2.5 py-2 text-[16px] text-fg focus:border-accent focus:outline-none disabled:opacity-50"
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={correct.isPending || unchanged} className={cn(ACTION_BTN, "border-accent bg-accent-soft text-fg")}>
          Save correction
        </button>
        <button type="button" disabled={correct.isPending} onClick={onCancel} className={ACTION_BTN}>Cancel</button>
      </div>
    </form>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[11px] text-fg-tertiary">{label}</dt>
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
          <span className="rounded-micro border border-edge-default px-1.5 py-px font-mono text-[11px] text-fg-tertiary">
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
            <span className="rounded-micro border border-edge-default px-1.5 py-px font-mono text-[11px] text-fg-tertiary">
              Verdict · {m.discoveryVerdict}
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
        <p className="mb-1 font-mono text-[11px] text-fg-tertiary">Proof</p>
        <EvidenceMark
          inline
          provenance={{ evidence: m.evidence, source: m.source, trustTier: m.trustTier, seenCount: m.seenCount, createdAt: m.createdAt, lastVerifiedAt: m.lastVerifiedAt }}
          now={now}
        />
      </section>

      <section aria-label="Time" data-memory-time={hasTime ? "present" : "absent"}>
        <p className="mb-1 font-mono text-[11px] text-fg-tertiary">Time</p>
        {hasTime ? (
          <ul className="space-y-1 font-mono text-[12px] text-fg-secondary">
            {m.validFrom ? <li>believed since {new Date(m.validFrom).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</li> : null}
            {m.validUntil ? <li>valid until {new Date(m.validUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</li> : null}
            {m.supersededBy ? (
              <li>
                superseded by{" "}
                <button
                  type="button"
                  className="text-fg-secondary underline-offset-2 hover:text-fg hover:underline"
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
                  className="text-fg-secondary underline-offset-2 hover:text-fg hover:underline"
                  onClick={() => openInspector({ kind: "memory", id: older.id })}
                >
                  {older.content}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-mono text-[11px] text-fg-tertiary">
            No validity interval or supersession recorded · current belief by default
          </p>
        )}
      </section>

      <MemoryEditActions key={m.id} id={m.id} content={m.content} current={!m.supersededBy} />

      <EntityActionRow entities={[entity]} labelOf={() => label} />
    </div>
  );
}
