/**
 * The only editor of the online tire markup that every website tire price uses (gatewayTire.updateMarkup).
 * Tires is also open to front_desk and tech, so the card renders for owner and manager only, matching the
 * server, which resolves both the read and the save to settings.manage (shared/adminPermissions.ts).
 *
 * It reads the saved value first (gatewayTire.markup: percent, when, by whom) and keeps Save disabled until
 * that read succeeds: replacing a value nobody can see was the defect this card had until 2026-10-25.
 * A save throws on failure (onError); a save whose re-read failed is saved, with the new value unknown.
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

const EDITORS = new Set(["owner", "manager"]);
const SCOPE = "website tire prices only; does not change the counter's prices.";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** " · set Oct 25 by nour", or the parts that are known. */
function setBy(updatedAt: string | null, updatedBy: string | null): string {
  const when = updatedAt ? ` ${shortDate(updatedAt)}` : "";
  const who = updatedBy ? ` by ${updatedBy.split("@")[0]}` : "";
  return when || who ? ` · set${when}${who}` : "";
}

export default function TireMarkupCard() {
  const { data: security } = trpc.adminSecurity.status.useQuery();
  const editor = !!security && EDITORS.has(security.adminRole);
  const markup = trpc.gatewayTire.markup.useQuery(undefined, { enabled: editor });
  // null = not editing: the input shows the saved value.
  const [draft, setDraft] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const updateMarkup = trpc.gatewayTire.updateMarkup.useMutation({
    onSuccess: async (r) => {
      setFailed(null);
      if (r.available && r.percent !== null) toast.success(`Markup saved: ${r.percent}%`);
      else setFailed("Saved, but the new value couldn't be read back: unknown.");
      await markup.refetch();
      setDraft(null);
    },
    // A money-affecting setting: a failed save must be visible.
    onError: (err: { message: string }) => setFailed(`The markup was not saved: ${err.message}`),
  });

  if (!editor) return null;

  const read = markup.data;
  const readOk = !markup.isError && read?.available === true;
  const readFailed = markup.isError || read?.available === false;
  const saved = readOk && read.available ? read.percent : null;
  const savedText = saved === null ? "" : String(saved);
  const value = draft ?? savedText;
  const dirty = draft !== null && draft !== savedText;
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 300;
  const canSave = readOk && dirty && valid && !updateMarkup.isPending;

  let current: string;
  if (readFailed) current = "Current markup unknown: couldn't load.";
  else if (!read || !read.available) current = "Reading the saved markup.";
  else if (read.percent !== null)
    current = `Current online tire markup: ${read.percent}% over wholesale (100 means cost times 2)${setBy(read.updatedAt, read.updatedBy)} · ${SCOPE}`;
  else if (read.note)
    current = `The saved markup can't be read (${read.note})${setBy(read.updatedAt, read.updatedBy)} · ${SCOPE}`;
  else current = `No online markup saved yet; the pricing path uses its built-in default. Applies to ${SCOPE}`;

  async function save() {
    if (!canSave) return;
    const ok = await confirmDialog({
      title: saved === null ? `Set online tire markup to ${parsed}%?` : `Change online tire markup from ${saved}% to ${parsed}%?`,
      message: "Website tire prices become wholesale cost plus this markup, for new searches right away. Counter prices do not change.",
      confirmLabel: "Save markup",
    });
    if (ok) updateMarkup.mutate({ markup: parsed });
  }

  return (
    <section className="mt-6 rounded-lg border border-border/40 bg-card p-4" aria-labelledby="tire-markup-title">
      <h2 id="tire-markup-title" className="text-sm font-semibold">Online tire markup</h2>
      <p className={`mt-1 text-sm ${readFailed ? "text-amber-400" : "text-muted-foreground"}`}>{current}</p>
      {readFailed && (
        <button
          type="button"
          onClick={() => void markup.refetch()}
          className="mt-2 min-h-12 px-4 rounded-md border border-border/40 text-sm font-semibold"
        >
          Retry reading the markup
        </button>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="tire-markup" className="sr-only">Markup percent</label>
        <input
          id="tire-markup"
          type="number"
          inputMode="decimal"
          min={0}
          max={300}
          step={1}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          className="h-12 w-28 rounded-md border border-border/40 bg-background px-3 text-base tabular-nums"
        />
        <span className="text-sm text-muted-foreground">%</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="min-h-12 px-4 rounded-md border border-border/40 text-sm font-semibold disabled:opacity-50"
        >
          {updateMarkup.isPending ? "Saving" : "Save"}
        </button>
        {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
      </div>
      {value.trim() !== "" && !valid && <p className="mt-2 text-sm text-amber-400">Enter a number from 0 to 300.</p>}
      {failed && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-red-400" role="alert">
          <span>{failed}</span>
          {dirty && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              className="min-h-12 min-w-12 px-4 rounded-md border border-border/40 text-foreground/85 disabled:opacity-50"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </section>
  );
}
