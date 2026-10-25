/**
 * The only editor of the live tire markup that every public tire price uses
 * (gatewayTire.updateMarkup). It sat under owner/manager-only Settings >
 * Integrations > Tire search until that tab was cut on 2026-10-19 (admin prune
 * W1); it lives in the Tires section now. Tires is also open to front_desk and
 * tech, so the card renders for owner and manager only, matching the server,
 * which resolves the save to settings.manage (shared/adminPermissions.ts).
 *
 * The server does not report the current value, so the card says so instead of
 * pre-filling a number that may be wrong. A save the server refused
 * ({ success: false } when the database is unreachable) is never "saved".
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

const EDITORS = new Set(["owner", "manager"]);

export default function TireMarkupCard() {
  const { data: security } = trpc.adminSecurity.status.useQuery();
  const [value, setValue] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const updateMarkup = trpc.gatewayTire.updateMarkup.useMutation({
    onSuccess: (r) => {
      if (r.available) {
        setFailed(null);
        toast.success(`Markup saved: ${r.percent}%`);
      } else {
        setFailed(r.message);
        toast.error(r.message);
      }
    },
    // A money-affecting setting: a failed save must be visible.
    onError: (err: { message: string }) => setFailed(`The markup was not saved: ${err.message}`),
  });

  if (!security || !EDITORS.has(security.adminRole)) return null;

  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 300;

  async function save() {
    if (!valid) return;
    const ok = await confirmDialog({
      title: `Set tire markup to ${parsed}%?`,
      message: "Every public tire price is wholesale cost plus this markup. It applies to new searches right away.",
      confirmLabel: "Save markup",
    });
    if (ok) updateMarkup.mutate({ markup: parsed });
  }

  return (
    <section className="mt-6 rounded-lg border border-border/40 bg-card p-4" aria-labelledby="tire-markup-title">
      <h2 id="tire-markup-title" className="text-sm font-semibold">Default tire markup</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Percent over wholesale for every public tire price (100 means cost times 2). The current value is not shown here; saving replaces it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="tire-markup" className="sr-only">Markup percent</label>
        <input
          id="tire-markup"
          type="number"
          inputMode="decimal"
          min={0}
          max={300}
          step={1}
          placeholder="100"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-12 w-28 rounded-md border border-border/40 bg-background px-3 text-base tabular-nums"
        />
        <span className="text-sm text-muted-foreground">%</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!valid || updateMarkup.isPending}
          className="min-h-12 px-4 rounded-md border border-border/40 text-sm font-semibold disabled:opacity-50"
        >
          {updateMarkup.isPending ? "Saving" : "Save"}
        </button>
      </div>
      {value.trim() !== "" && !valid && <p className="mt-2 text-xs text-amber-400">Enter a number from 0 to 300.</p>}
      {failed && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-red-400" role="alert">
          <span>{failed}</span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || updateMarkup.isPending}
            className="min-h-12 min-w-12 px-4 rounded-md border border-border/40 text-foreground/85 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
