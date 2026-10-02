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

import { useCallback, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  PERSON_ROLES,
  PERSON_ROLE_OPTIONS,
} from "@/lib/brain/person-roles";

// Single source of truth (shared with createPerson tRPC enum + the AI
// classifier prompt). Was a local copy that had drifted out of sync.
const ROLES = PERSON_ROLES;

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
    phone: string | null;
    email: string | null;
  };
  onSaved?: (personId: string) => void;
}

type FullPersonHydration = {
  birthday?: string | null;
  anniversary?: string | null;
  cadenceDays?: number | null;
  leverageNotes?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
};

const PERSON_DIALOG_CLASS =
  "fixed inset-x-0 bottom-0 z-[51] max-h-[90dvh] overflow-y-auto rounded-t-float border-t border-edge-default bg-overlay pb-[env(safe-area-inset-bottom,0px)] outline-none shadow-l2 lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-overlay lg:border";

export function PersonEditDrawer(props: PersonEditDrawerProps) {
  if (!props.open) return null;

  // Create mode has no existing profile to hydrate. Edit mode gates the
  // stateful form on the full profile read so hidden fields (birthday,
  // anniversary, cadence, phone/email) cannot open blank and then be
  // accidentally overwritten with null on Save.
  if (!props.personId) {
    return <PersonEditDrawerBody {...props} source={null} />;
  }
  return <PersonEditProfileGate {...props} personId={props.personId} />;
}

function PersonEditProfileGate(props: PersonEditDrawerProps & { personId: string }) {
  const fetched = trpc.task.personProfile.useQuery({ personId: props.personId });
  const p = fetched.data?.person as FullPersonHydration | undefined;

  if (fetched.isLoading) {
    return (
      <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) props.onClose(); }}>
        <DialogContent
          unstyled
          showCloseButton={false}
          overlayClassName="z-50 bg-canvas/60"
          className={PERSON_DIALOG_CLASS}
        >
          <div className="flex min-h-40 items-center justify-center gap-2 px-4 text-sm text-[var(--text-secondary)]">
            <Loader2 size={16} className="animate-spin text-fg-tertiary" />
            Loading full profile…
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (fetched.isError || !p) {
    return (
      <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) props.onClose(); }}>
        <DialogContent
          unstyled
          showCloseButton={false}
          overlayClassName="z-50 bg-canvas/60"
          className={PERSON_DIALOG_CLASS}
        >
          <div className="space-y-3 p-4">
            <DialogTitle className="text-sm font-bold text-[var(--text-primary)]">
              Full profile unavailable
            </DialogTitle>
            <p className="text-xs leading-5 text-[var(--text-secondary)]">
              Editing is paused so missing birthday, anniversary, cadence, phone, or email values cannot be overwritten by a partial snapshot.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={props.onClose}
                className="min-h-11 px-3 text-xs text-[var(--text-secondary)]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void fetched.refetch()}
                className="min-h-11 rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary hover:border-edge-strong hover:text-fg"
              >
                Retry
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const mergedInitial = props.initial
    ? {
        ...props.initial,
        birthday: p.birthday ?? props.initial.birthday,
        anniversary: p.anniversary ?? props.initial.anniversary,
        cadenceDays: p.cadenceDays ?? props.initial.cadenceDays,
        leverageNotes: p.leverageNotes ?? props.initial.leverageNotes,
        phone: p.phone ?? props.initial.phone,
        email: p.email ?? props.initial.email,
      }
    : props.initial;

  return (
    <PersonEditDrawerBody
      {...props}
      initial={mergedInitial}
      source={p.source ?? null}
    />
  );
}

function PersonEditDrawerBody({
  onClose,
  personId,
  initial,
  onSaved,
  source,
}: PersonEditDrawerProps & { source?: string | null }) {
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
  const [phone, setPhone] = useState(() => initial?.phone ?? "");
  const [email, setEmail] = useState(() => initial?.email ?? "");

  const createMutation = trpc.task.createPerson.useMutation();
  const updateMutation = trpc.task.updatePerson.useMutation();
  const softDeleteMutation = trpc.task.softDeletePerson.useMutation();

  const submitting =
    createMutation.isPending ||
    updateMutation.isPending ||
    softDeleteMutation.isPending;

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
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
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
          role: role as typeof ROLES[number],
          relationship: relationship.trim(),
          leverageNotes: leverageNotes.trim() || null,
          birthday: birthday.trim() || null,
          anniversary: anniversary.trim() || null,
          cadenceDays: cadence,
          phone: phone.trim() || null,
          email: email.trim() || null,
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
    phone,
    email,
    personId,
    createMutation,
    updateMutation,
    onSaved,
    onClose,
  ]);

  // PWA-safe two-tap delete. window.confirm() is SILENTLY suppressed in iOS
  // standalone PWAs (the operator's actual environment) — it returns false so
  // the delete never fired. First tap arms (button → "tap to confirm"), second
  // tap within 4s deletes. Soft-delete is reversible (revive via Nick), so a
  // two-tap inline confirm is safe + avoids a broken modal-on-modal.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const handleSoftDelete = useCallback(async () => {
    if (!personId) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    setConfirmingDelete(false);
    try {
      await softDeleteMutation.mutateAsync({ personId });
      toast.success(`Deleted ${initial?.name ?? "person"}.`);
      onSaved?.(personId);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    }
  }, [personId, confirmingDelete, initial, softDeleteMutation, onSaved, onClose]);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onClose();
      }}
    >
      <DialogContent
        unstyled
        showCloseButton={false}
        overlayClassName="z-50 bg-canvas/60"
        className={PERSON_DIALOG_CLASS}
      >
        <header className="sticky top-0 z-10 bg-overlay flex items-center gap-2 border-b border-edge-default px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
              {isCreate ? "add person" : "edit person"}
            </p>
            <DialogTitle className="mt-0.5 truncate text-[15px] font-semibold text-fg">
              {isCreate ? "new profile" : initial?.name ?? "edit"}
            </DialogTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="close"
            className="inline-flex h-11 w-11 items-center justify-center rounded-control text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover"
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
              {PERSON_ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
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
            <Field label="phone">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={submitting} placeholder="(216) 555-0123" className={inputCls} />
            </Field>
            <Field label="email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} placeholder="name@email.com" className={inputCls} />
            </Field>
          </div>

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

        {!isCreate && source && (
          <p className="px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            origin · {source}
          </p>
        )}

        <footer className="sticky bottom-0 z-10 bg-overlay flex items-center gap-2 border-t border-edge-default px-4 py-3">
          {!isCreate && (
            <button
              type="button"
              onClick={handleSoftDelete}
              disabled={submitting}
              aria-label={
                confirmingDelete
                  ? `confirm delete ${initial?.name ?? "person"}`
                  : `delete ${initial?.name ?? "person"}`
              }
              className={cn(
                "inline-flex items-center gap-1.5 min-h-[44px] px-2 -mx-2 text-[13px] font-medium disabled:opacity-50",
                confirmingDelete
                  ? "text-rose-300 font-semibold"
                  : "text-rose-300/90 hover:text-rose-300",
              )}
            >
              <Trash2 size={13} strokeWidth={1.75} />
              {confirmingDelete ? "Tap to confirm" : "Delete"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ml-auto inline-flex items-center min-h-[44px] px-2 text-[13px] font-medium text-fg-tertiary hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting || !name.trim()}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-control bg-accent px-4 py-2 text-[14px] font-semibold text-[var(--text-inverse)] hover:bg-accent-hover",
              "disabled:opacity-50 transition-colors duration-[var(--motion-state)]",
            )}
          >
            {submitting && <Loader2 size={12} className="animate-spin" strokeWidth={2} />}
            {isCreate ? "Create" : "Save"}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

// wave-AB.d · mobile · 16px font prevents iOS Safari zoom-on-focus ·
// 44px min-h meets Apple HIG tap target for selects + inputs.
const inputCls =
  "w-full min-h-[44px] rounded-control border border-edge-default bg-content px-2.5 py-2 text-[16px] text-fg placeholder:text-fg-tertiary focus:border-accent focus:outline-none transition-colors disabled:opacity-50";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}
