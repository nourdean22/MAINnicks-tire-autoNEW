"use client";

/**
 * PersonEditDrawer · Wave AB.b · 2026-05-28.
 *
 * Bottom-sheet (mobile) / center modal (desktop) for editing a
 * PersonProfile's basic fields:
 *
 *   · name (typo fix or formal change)
 *   · role (the curated dropdown)
 *   · relationship (free text · 1-2 sentences)
 *   · leverageNotes (strategic positioning · operator-facing only)
 *   · birthday + anniversary (ISO date format)
 *   · cadenceDays (target check-in cadence)
 *
 * Plus a soft-delete button (revivable). All writes route through the
 * Wave AB.b tRPC mutations (updatePerson · softDeletePerson).
 *
 * Used by:
 *   · Person row "Edit" button in the dossier surface
 *   · Add person flow (when opened with no personId, becomes a create form)
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

const ROLES = [
  "acquaintance",
  "friend",
  "close_friend",
  "family",
  "romantic",
  "ex_romantic",
  "mentor",
  "mentee",
  "advisor",
  "customer",
  "vendor",
  "employee",
  "competitor",
  "rival",
  "enemy",
  "ex_friend",
  "network_only",
] as const;

interface PersonEditDrawerProps {
  open: boolean;
  onClose: () => void;
  /** When set, the drawer is in EDIT mode. When null, it's CREATE. */
  personId: string | null;
  initial?: {
    name: string;
    role: string;
    relationship: string;
    leverageNotes: string | null;
    birthday: string | null;
    anniversary: string | null;
    cadenceDays: number | null;
  };
  onSaved?: (personId: string) => void;
}

export function PersonEditDrawer(props: PersonEditDrawerProps) {
  if (!props.open) return null;
  // wave-AB.b-audit · the parent passes a key=`${personId ?? "new"}` on
  // this component so React remounts the inner state-bearing body when
  // the operator switches target (or hops between create + edit). This
  // sidesteps the react-hooks/set-state-in-effect rule · we don't need
  // a sync-state effect because the form fields are seeded by the
  // useState initializers on each fresh mount.
  return <PersonEditDrawerBody {...props} />;
}

function PersonEditDrawerBody({
  onClose,
  personId,
  initial,
  onSaved,
}: PersonEditDrawerProps) {
  const isCreate = personId === null;
  const [name, setName] = useState(() => initial?.name ?? "");
  const [role, setRole] = useState(() => initial?.role ?? "acquaintance");
  const [relationship, setRelationship] = useState(
    () => initial?.relationship ?? "",
  );
  const [leverageNotes, setLeverageNotes] = useState(
    () => initial?.leverageNotes ?? "",
  );
  const [birthday, setBirthday] = useState(() => initial?.birthday ?? "");
  const [anniversary, setAnniversary] = useState(
    () => initial?.anniversary ?? "",
  );
  const [cadenceDays, setCadenceDays] = useState<string>(() =>
    initial?.cadenceDays !== null && initial?.cadenceDays !== undefined
      ? String(initial.cadenceDays)
      : "",
  );

  const createMutation = trpc.task.createPerson.useMutation();
  const updateMutation = trpc.task.updatePerson.useMutation();
  const softDeleteMutation = trpc.task.softDeletePerson.useMutation();

  const submitting =
    createMutation.isPending ||
    updateMutation.isPending ||
    softDeleteMutation.isPending;

  // Esc close · wave-AB.b-audit · the body only mounts when open=true
  // (the outer PersonEditDrawer wrapper short-circuits null on open=false)
  // so no `open` dep is needed · effect runs once per mount.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Name is required.");
      return;
    }
    const cadence = cadenceDays.trim() ? Number(cadenceDays) : null;
    if (cadence !== null && (!Number.isFinite(cadence) || cadence < 1 || cadence > 365)) {
      toast.error("Cadence must be 1-365 days.");
      return;
    }
    try {
      if (isCreate) {
        const res = await createMutation.mutateAsync({
          name: trimmedName,
          role: role as typeof ROLES[number],
          relationship: relationship.trim(),
          leverageNotes: leverageNotes.trim() || undefined,
          birthday: birthday.trim() || undefined,
          anniversary: anniversary.trim() || undefined,
          cadenceDays: cadence ?? undefined,
        });
        toast.success(
          res.matched
            ? `Merged into existing profile "${trimmedName}".`
            : `Created profile for ${trimmedName}.`,
        );
        onSaved?.(res.personId);
        onClose();
      } else {
        await updateMutation.mutateAsync({
          personId: personId!,
          name: trimmedName,
          role,
          relationship: relationship.trim(),
          leverageNotes: leverageNotes.trim() || null,
          birthday: birthday.trim() || null,
          anniversary: anniversary.trim() || null,
          cadenceDays: cadence,
        });
        toast.success(`Updated ${trimmedName}.`);
        onSaved?.(personId!);
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    }
  }, [
    isCreate,
    name,
    role,
    relationship,
    leverageNotes,
    birthday,
    anniversary,
    cadenceDays,
    personId,
    createMutation,
    updateMutation,
    onSaved,
    onClose,
  ]);

  const handleSoftDelete = useCallback(async () => {
    if (!personId) return;
    const confirmed = window.confirm(
      `Soft-delete ${initial?.name ?? "this person"}? Their ledger + dossier stay in the DB · you can revive later.`,
    );
    if (!confirmed) return;
    try {
      await softDeleteMutation.mutateAsync({ personId });
      toast.success(`Soft-deleted ${initial?.name ?? "person"}.`);
      onSaved?.(personId);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    }
    // wave-AB.b-audit · React Compiler inferred `initial` as the dep
    // instead of the manually-listed `initial?.name` · listing the
    // parent object directly so the compiler can preserve memoization.
  }, [personId, initial, softDeleteMutation, onSaved, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isCreate ? "add person" : "edit person"}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full lg:max-w-lg bg-[var(--bg-base)] border-t lg:border border-[var(--gold)]/30 rounded-t-2xl lg:rounded-2xl",
          "shadow-[0_-20px_60px_rgba(0,0,0,0.5),0_0_40px_rgba(253,185,19,0.1)]",
          "max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]",
        )}
      >
        <header className="sticky top-0 z-10 bg-[var(--bg-base)] flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
              {isCreate ? "add person" : "edit person"}
            </p>
            <h2 className="text-[14px] font-bold text-[var(--text-primary)] truncate mt-0.5">
              {isCreate ? "new profile" : initial?.name ?? "edit"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/15"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div className="px-4 py-3 space-y-3">
          <Field label="name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              placeholder="full name"
              className={inputCls}
            />
          </Field>

          <Field label="role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
              className={inputCls}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>

          <Field label="relationship">
            <textarea
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="how they relate · 1-2 sentences"
              className={cn(inputCls, "resize-none")}
            />
          </Field>

          <Field label="leverage notes">
            <textarea
              value={leverageNotes}
              onChange={(e) => setLeverageNotes(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="strategic positioning · operator-only · what makes them tick"
              className={cn(inputCls, "resize-none")}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="birthday · YYYY-MM-DD">
              <input
                type="text"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                disabled={submitting}
                placeholder="1985-03-14"
                className={inputCls}
              />
            </Field>
            <Field label="anniversary · YYYY-MM-DD">
              <input
                type="text"
                value={anniversary}
                onChange={(e) => setAnniversary(e.target.value)}
                disabled={submitting}
                placeholder="2017-09-22"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="cadence · days (target check-in interval)">
            <input
              type="number"
              min={1}
              max={365}
              value={cadenceDays}
              onChange={(e) => setCadenceDays(e.target.value)}
              disabled={submitting}
              placeholder="e.g. 14"
              className={inputCls}
            />
          </Field>
        </div>

        <footer className="sticky bottom-0 z-10 bg-[var(--bg-base)] flex items-center gap-2 border-t border-[var(--border-default)] px-4 py-3">
          {!isCreate && (
            <button
              type="button"
              onClick={handleSoftDelete}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-rose-300/80 hover:text-rose-300 disabled:opacity-50"
            >
              <Trash2 size={11} strokeWidth={1.75} />
              soft-delete
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ml-auto text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-50"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting || !name.trim()}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15 px-3 py-2 text-[12px] font-medium",
              "disabled:opacity-50 transition-colors",
            )}
          >
            {submitting && <Loader2 size={12} className="animate-spin" strokeWidth={2} />}
            {isCreate ? "create" : "save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// wave-AB.d · mobile · 16px font prevents iOS Safari zoom-on-focus ·
// 44px min-h meets Apple HIG tap target for selects + inputs.
const inputCls =
  "w-full min-h-[44px] rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.06] px-2.5 py-2 text-[16px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/70 focus:border-[var(--gold)]/40 focus:outline-none transition-colors disabled:opacity-50";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {label}
      </span>
      {children}
    </label>
  );
}
