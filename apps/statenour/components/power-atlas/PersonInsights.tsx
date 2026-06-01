"use client";

/**
 * PersonInsights · 2026-06-01 · statenour/people-overhaul
 *
 * Three new high-signal surfaces for the /people detail panel, all
 * matching the existing dark/gold · serif · mono · 1px-rgba-border
 * aesthetic (no new palette, no emojis):
 *
 *   · PendingClassificationBanner — the suggest-then-approve banner. The
 *     people-intelligence engine no longer silently overwrites role /
 *     leverageNotes / trustScore; it parks a proposal the operator
 *     accepts or dismisses here.
 *   · RelationshipXpChip — what this relationship has EARNED (deposits +
 *     power-plays now credit the INFLUENCE & PEOPLE stats).
 *   · OpenPromisesPanel — open tasks/promises to this person. This is
 *     what makes /people actually READ the task list and correlate.
 */
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PERSON_ROLE_LABELS, isPersonRole } from "@/lib/brain/person-roles";

const STAT_LABELS: Record<string, string> = {
  networking: "Networking",
  relationships: "Relationships",
  persuasion: "Persuasion",
  seduction: "Seduction",
  strategy: "Strategy",
  leadership: "Leadership",
};

interface PendingClassification {
  role?: string | null;
  leverageNotes?: string | null;
  trustAdjustment?: number;
  basis?: string;
  suggestedAt?: string;
}

export function PendingClassificationBanner({
  personId,
  pending,
  onResolved,
}: {
  personId: string;
  pending: unknown;
  onResolved: () => void;
}) {
  const utils = trpc.useUtils();
  const accept = trpc.task.acceptClassification.useMutation({
    onSuccess: () => {
      void utils.task.personProfile.invalidate({ personId });
      onResolved();
    },
  });
  const dismiss = trpc.task.dismissClassification.useMutation({
    onSuccess: () => {
      void utils.task.personProfile.invalidate({ personId });
      onResolved();
    },
  });

  const pc = (pending ?? null) as PendingClassification | null;
  if (!pc || (!pc.role && !pc.leverageNotes && !pc.trustAdjustment)) return null;

  const busy = accept.isPending || dismiss.isPending;
  const roleLabel =
    pc.role && isPersonRole(pc.role) ? PERSON_ROLE_LABELS[pc.role] : null;
  const trustPct =
    typeof pc.trustAdjustment === "number" && pc.trustAdjustment !== 0
      ? Math.round(pc.trustAdjustment * 100)
      : 0;

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="AI classification suggestion — review and accept or dismiss"
      className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.06] p-3"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          Nick suggests
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => accept.mutate({ personId })}
            className="h-7 border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10 text-[11px] uppercase tracking-wider"
          >
            {accept.isPending ? "applying…" : "accept"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => dismiss.mutate({ personId })}
            className="h-7 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] text-[11px] uppercase tracking-wider"
          >
            dismiss
          </Button>
        </div>
      </div>
      <div className="space-y-1 text-xs text-[var(--text-secondary)]">
        {roleLabel && (
          <div>
            role → <span className="text-[var(--text-primary)] font-medium">{roleLabel}</span>
          </div>
        )}
        {pc.leverageNotes && (
          <div className="line-clamp-2">
            notes → <span className="italic">{pc.leverageNotes}</span>
          </div>
        )}
        {trustPct !== 0 && (
          <div>
            trust → <span className="font-mono tabular-nums">{trustPct > 0 ? "+" : ""}{trustPct}%</span>
          </div>
        )}
        {pc.basis && (
          <div className="text-[10px] text-[var(--text-tertiary)] line-clamp-1">
            basis: {pc.basis}
          </div>
        )}
      </div>
    </div>
  );
}

export function RelationshipXpChip({
  xp,
}: {
  xp?: { total: number; count: number; byStat: Record<string, number> };
}) {
  if (!xp || xp.total <= 0) return null;
  const parts = Object.entries(xp.byStat)
    .sort((a, b) => b[1] - a[1])
    .map(([stat, v]) => `${STAT_LABELS[stat] ?? stat} +${Math.round(v * 10) / 10}`);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/[0.06] px-2 py-0.5 text-[10px] font-mono tabular-nums text-[var(--gold)]"
      title={`${parts.join(" · ")} · across ${xp.count} reps`}
      aria-label={`Earned ${xp.total} mastery XP from relationship work: ${parts.join(", ")}, across ${xp.count} reps`}
    >
      +{xp.total} XP
    </span>
  );
}

interface OpenTask {
  id: string;
  title: string;
  status: string;
  dueDate: Date | string | null;
  loopKind: string;
  promiseTo: string | null;
}

function dueLabel(due: Date | string | null): string | null {
  if (!due) return null;
  const d = typeof due === "string" ? new Date(due) : due;
  const days = Math.round((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days}d`;
}

export function OpenPromisesPanel({
  tasks,
  personName,
}: {
  tasks: OpenTask[];
  personName: string;
}) {
  if (!tasks || tasks.length === 0) {
    return (
      <section
        className="rounded-xl border bg-[var(--bg-raised)] p-4"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <h3 className="font-serif text-base tracking-tight text-[var(--text-primary)] mb-1">
          Open promises
        </h3>
        <p className="text-xs text-[var(--text-tertiary)]">
          No open tasks linked to {personName}. Promises you make to them — via
          a PROMISE loop or the task&apos;s &ldquo;who&rdquo; field — surface here.
        </p>
      </section>
    );
  }
  return (
    <section
      className="rounded-xl border bg-[var(--bg-raised)] p-4"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-serif text-base tracking-tight text-[var(--text-primary)]">
          Open promises to {personName}
        </h3>
        <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
          {tasks.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {tasks.map((t) => {
          const due = dueLabel(t.dueDate);
          const overdue = due?.includes("overdue");
          return (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                {t.title}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {due && (
                  <span
                    className={cn(
                      "text-[10px] font-mono tabular-nums",
                      overdue ? "text-rose-300" : "text-[var(--text-tertiary)]",
                    )}
                  >
                    {due}
                  </span>
                )}
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                  {t.loopKind.toLowerCase()}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
