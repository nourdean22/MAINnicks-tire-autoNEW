import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  PhoneForwarded,
  AlertCircle,
  Edit2,
  Save,
  X,
  CheckCircle2,
} from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { fmtPhone } from "./format";

// ─── Transfer Destination Card ─────────────────────────────
//
// Operator pain point this fixes: managers swap depending on who's on
// shift, and the transferCall destination has historically required
// logging into the VAPI dashboard to change.
//
// Wave-87: this card surfaces the current number + inline edit.
// Wave-88: per-shift presets stored in shop_settings render as
//          one-click chips. "Save current as preset" lets operators
//          build their library — Manager A cell, Manager B cell,
//          Owner cell, etc. The Shop Landline reset chip is always
//          present as a safe fallback even if presets are empty.

const SHOP_LANDLINE_RESET = {
  label: "Shop Landline · Reset",
  number: "+12168620005",
  description: "(216) 862-0005 · always reaches the front counter",
};

export function TransferDestinationCard() {
  const utils = trpc.useUtils();
  const { data: dest, isLoading } = trpc.vapi.getTransferDestination.useQuery(undefined, {
    refetchInterval: 5 * 60_000, // 5 min — operator usually changes once + monitors
  });
  const { data: presets = [] } = trpc.vapi.listTransferPresets.useQuery(undefined, {
    staleTime: 60_000,
  });
  const [editing, setEditing] = useState(false);
  const [draftNumber, setDraftNumber] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState("");

  const setDest = trpc.vapi.setTransferDestination.useMutation({
    onSuccess: (result) => {
      toast.success(`Calls now forward to ${fmtPhone(result.newNumber)}`);
      utils.vapi.getTransferDestination.invalidate();
      setEditing(false);
    },
    onError: (err) => {
      toast.error(`Failed to update: ${err.message.slice(0, 100)}`);
    },
  });

  const savePreset = trpc.vapi.saveTransferPreset.useMutation({
    onSuccess: () => {
      toast.success(`Preset saved: ${newPresetLabel}`);
      utils.vapi.listTransferPresets.invalidate();
      setShowSavePreset(false);
      setNewPresetLabel("");
    },
    onError: (err) => toast.error(`Failed to save preset: ${err.message.slice(0, 80)}`),
  });

  const deletePreset = trpc.vapi.deleteTransferPreset.useMutation({
    onSuccess: () => {
      utils.vapi.listTransferPresets.invalidate();
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message.slice(0, 80)}`),
  });

  const startEdit = () => {
    setDraftNumber(dest?.ok ? dest.currentNumber || "" : "");
    setDraftMessage(dest?.ok ? dest.currentMessage || "" : "");
    setEditing(true);
  };

  // wave-113 — operator-friendly phone normalization. Strips spaces,
  // dashes, parens, dots, then maps:
  //   "+16056916315"   → "+16056916315" (already canonical)
  //   "16056916315"    → "+16056916315"
  //   "6056916315"     → "+16056916315"
  //   anything else    → null (rejected)
  // Removes the "you must type +1" UX friction. Server-side zod regex
  // is unchanged and remains the source of truth.
  const toE164 = (raw: string): string | null => {
    const digits = raw.replace(/[^\d+]/g, "");
    if (/^\+1\d{10}$/.test(digits)) return digits;
    if (/^1\d{10}$/.test(digits)) return `+${digits}`;
    if (/^\d{10}$/.test(digits)) return `+1${digits}`;
    return null;
  };

  // wave-181.x Voice Phase 1 · CRITICAL #1 fix · code-review agent
  // caught three ungated mutations on the LIVE inbound transfer
  // destination. Submit/usePreset/landline-reset all fire setDest
  // immediately · operator fat-finger on a preset on a phone =
  // calls forward to wrong number for the rest of the day = lost
  // revenue. FollowUpTransferCard already uses confirmDialog ·
  // copy that pattern. Shared helper · normalize once · show the
  // normalized destination in the confirm so operator visually
  // verifies BEFORE the mutation fires.
  const confirmAndSetDest = async (e164: string, message?: string) => {
    const ok = await confirmDialog({
      title: "Change inbound transfer destination?",
      message: `Inbound Nick AI calls will now forward to ${fmtPhone(e164)}. Live · takes effect on the next call.`,
      confirmLabel: `Forward to ${fmtPhone(e164)}`,
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    setDest.mutate({ phoneNumber: e164, message });
  };

  const submit = async () => {
    const e164 = toE164(draftNumber);
    if (!e164) {
      toast.error("Invalid number — type a 10-digit US number (e.g. 605-691-6315)");
      return;
    }
    await confirmAndSetDest(e164, draftMessage || undefined);
  };

  const usePreset = async (number: string, message?: string) => {
    await confirmAndSetDest(number, message);
  };

  const handleSavePresetSubmit = () => {
    const label = newPresetLabel.trim();
    if (!label) {
      toast.error("Give the preset a label first");
      return;
    }
    const e164 = toE164(draftNumber);
    if (!e164) {
      toast.error("Type a valid 10-digit US number first");
      return;
    }
    savePreset.mutate({
      label,
      number: e164,
      message: draftMessage || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border/30 rounded p-4">
        <div className="h-4 w-40 bg-foreground/10 animate-pulse rounded mb-2" />
        <div className="h-7 w-56 bg-foreground/15 animate-pulse rounded" />
      </div>
    );
  }

  if (!dest?.ok) {
    return (
      <div className="bg-card border border-red-500/30 rounded p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-bold text-red-400">Transfer destination unknown</div>
          <div className="text-[12px] text-foreground/60 mt-0.5">
            {dest?.error || "VAPI API unreachable. Calls may still be forwarding correctly — check the VAPI dashboard directly."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-primary/20 rounded p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <PhoneForwarded className="w-4 h-4 text-primary/80" />
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-foreground/50">
              Calls forward to
            </span>
          </div>
          {editing ? (
            <div className="space-y-2 mt-1">
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="done"
                  value={draftNumber}
                  onChange={(e) => setDraftNumber(e.target.value)}
                  /* wave-113 — placeholder updated; toE164 normalizer accepts
                     all common US-number shapes (10-digit, 11-digit, formatted) */
                  placeholder="605-691-6315 or +16056916315"
                  className="bg-background border border-border/40 rounded-md px-3 py-2 text-sm font-mono w-56 focus:border-primary focus:outline-none"
                  autoFocus
                  disabled={setDest.isPending}
                />
                <button
                  onClick={submit}
                  disabled={setDest.isPending}
                  className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-md text-xs font-bold tracking-wide hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {setDest.isPending ? (
                    <span className="w-3 h-3 border border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={setDest.isPending}
                  className="inline-flex items-center gap-1.5 text-foreground/60 hover:text-foreground px-2 py-2 text-xs transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
              <input
                type="text"
                value={draftMessage}
                onChange={(e) => setDraftMessage(e.target.value)}
                placeholder="What Nick says before transferring (optional)"
                className="bg-background border border-border/40 rounded-md px-3 py-1.5 text-[12px] w-full max-w-md focus:border-primary focus:outline-none"
                disabled={setDest.isPending}
                maxLength={200}
              />
              <p className="text-[10px] text-foreground/40">
                Format: +1 followed by 10 digits (e.g. +12168620005)
              </p>
            </div>
          ) : (
            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="font-mono font-bold text-2xl tracking-tight text-foreground tabular-nums">
                {dest.currentNumber ? fmtPhone(dest.currentNumber) : "—"}
              </div>
              {dest.currentMessage && (
                <div className="text-[11px] text-foreground/50 italic max-w-md">
                  "{dest.currentMessage.slice(0, 100)}{dest.currentMessage.length > 100 ? "…" : ""}"
                </div>
              )}
            </div>
          )}
        </div>

        {!editing && (
          <button
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 text-foreground/60 hover:text-foreground border border-border/40 hover:border-primary/50 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Change
          </button>
        )}
      </div>

      {/* wave-109: explain that this number doubles as the on-duty alert target */}
      {!editing && dest.currentNumber && (
        <div className="mt-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-md">
          <p className="text-[11px] text-foreground/60 leading-relaxed">
            <strong className="text-foreground/80">Doubles as the on-duty alert number.</strong>{" "}
            Every new booking, lead, callback, and emergency from nickstire.org
            also fires an SMS to this number from 216-862-0005. Change it here
            and alerts auto-route to the new manager within 5 min.
          </p>
        </div>
      )}

      {/* Quick-pick chips when editing — saved presets + landline reset */}
      {editing && (
        <div className="mt-3 pt-3 border-t border-border/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-foreground/40">
              Quick destinations {presets.length > 0 && <span className="text-foreground/30 ml-1">({presets.length})</span>}
            </span>
            {!showSavePreset && (
              <button
                onClick={() => setShowSavePreset(true)}
                /* wave-113 — was direct E.164 regex; now uses toE164 normalizer
                   so the button enables once a valid US number has been typed
                   in any common shape (10-digit, 11-digit, formatted with dashes). */
                disabled={toE164(draftNumber) === null || setDest.isPending}
                className="text-[11px] font-medium tracking-[0.15em] uppercase text-primary hover:underline disabled:opacity-30 disabled:no-underline"
                title="Save the current draft number as a labeled preset"
              >
                + Save current as preset
              </button>
            )}
          </div>

          {/* Inline save-preset prompt */}
          {showSavePreset && (
            <div className="mb-3 p-2.5 rounded bg-primary/5 border border-primary/20 flex items-center gap-2 flex-wrap">
              <input
                type="text"
                placeholder='Label (e.g. "Manager Joe", "Owner cell")'
                value={newPresetLabel}
                onChange={(e) => setNewPresetLabel(e.target.value)}
                maxLength={40}
                autoFocus
                className="bg-background border border-border/40 rounded-md px-2.5 py-1.5 text-xs flex-1 min-w-[180px] focus:border-primary focus:outline-none"
              />
              <button
                onClick={handleSavePresetSubmit}
                disabled={savePreset.isPending}
                className="inline-flex items-center gap-1 bg-primary text-primary-foreground px-2.5 py-1.5 rounded-md text-[11px] font-bold tracking-wide hover:opacity-90 disabled:opacity-50"
              >
                {savePreset.isPending ? (
                  <span className="w-3 h-3 border border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                Save preset
              </button>
              <button
                onClick={() => { setShowSavePreset(false); setNewPresetLabel(""); }}
                className="text-[11px] text-foreground/50 hover:text-foreground px-2 py-1.5"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {/* Saved presets */}
            {presets.map((p) => (
              <div key={p.label} className="relative group">
                <button
                  onClick={() => usePreset(p.number, p.message)}
                  disabled={setDest.isPending}
                  className="text-left bg-background border border-border/40 hover:border-primary/50 rounded-md pl-3 pr-7 py-2 text-xs transition-colors disabled:opacity-50"
                >
                  <div className="font-bold tracking-wide">{p.label}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5 font-mono tabular-nums">
                    {fmtPhone(p.number)}
                  </div>
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirmDialog({
                      title: "Delete preset?",
                      message: `Remove "${p.label}" from your saved presets.`,
                      confirmLabel: "Delete",
                      tone: "danger",
                    })) {
                      deletePreset.mutate({ label: p.label });
                    }
                  }}
                  disabled={deletePreset.isPending}
                  title="Delete preset"
                  aria-label={`Delete preset ${p.label}`}
                  // wave-119 — was hover-only `opacity-0 group-hover:opacity-100`
                  // which made the button permanently invisible on touch (no
                  // hover state on iOS). Now: always visible on mobile, opacity
                  // gate stays on sm+ where hover works. Also bumped target to
                  // 7x7 = 28x28px (still tight; full 44px would dominate the
                  // small preset chip — accepting the tradeoff for visual density).
                  className="absolute top-1 right-1 w-7 h-7 rounded text-foreground/40 hover:text-red-400 hover:bg-red-500/10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {/* Hardcoded landline reset — always present as safe fallback */}
            <button
              onClick={() => usePreset(SHOP_LANDLINE_RESET.number)}
              disabled={setDest.isPending}
              className="text-left bg-background border border-border/40 hover:border-primary/40 rounded-md px-3 py-2 text-xs transition-colors disabled:opacity-50 group"
            >
              <div className="font-bold tracking-wide group-hover:text-primary transition-colors">{SHOP_LANDLINE_RESET.label}</div>
              <div className="text-[10px] text-foreground/50 mt-0.5">{SHOP_LANDLINE_RESET.description}</div>
            </button>
          </div>

          {presets.length === 0 && (
            <p className="text-[10px] text-foreground/40 mt-2 italic">
              No presets saved yet. Type a number above and click "Save current as preset" to build your shift roster.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
