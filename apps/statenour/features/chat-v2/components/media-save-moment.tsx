"use client";

import { useState } from "react";
import { Bookmark, Check } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { formatTimestamp } from "@/lib/media/timestamp-refs";
import { toMemoryCandidate } from "@/lib/media/media-moment";
import { useMediaDockStore } from "../stores/media-dock-store";

/**
 * SaveMomentButton (BDN-316) — media plan item #7.
 *
 * Saves the current playback position as a BrainMemory row, with an
 * optional note, via the incumbent `brain.recordMemory` mutation (which
 * upserts by category+key, so a re-save reinforces).
 *
 * THIS IS A BUTTON AND ONLY A BUTTON.
 * The plan's boundary: "do not automatically turn every watched video
 * into permanent memory. Require an explicit 'Save to memory' action."
 * The dock already records `resumeAt` on every timeupdate, so an
 * autosave would have been three lines — which is exactly why the
 * restraint has to be deliberate and written down. Watching is not
 * remembering.
 *
 * NO PROMPT()/CONFIRM(). Both are silently suppressed in the standalone
 * iOS PWA — the repo's most-recurring bug class. The note field is an
 * inline expandable, mirroring the FollowUpButton pattern the
 * nickstire-ios-pwa-primitives skill prescribes for text capture.
 *
 * The position comes from the store's `resumeAt`, not from a ref: the
 * player element lives in whichever surface is mounted (dock or focus
 * panel), and reaching across for it would couple this button to that
 * choice. `resumeAt` is already the shared truth both surfaces write.
 */
export function SaveMomentButton() {
  const item = useMediaDockStore((s) => s.item);
  const resumeAt = useMediaDockStore((s) => s.resumeAt);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const record = trpc.brain.recordMemory.useMutation({
    onSuccess: () => {
      setJustSaved(true);
      setOpen(false);
      setNote("");
      toast.success("Moment saved to brain");
    },
    onError: (err) => {
      // Fail LOUD. A bookmark that silently didn't save is worse than
      // no bookmark — the operator believes it is there.
      toast.error(`Couldn't save the moment: ${err.message}`, { duration: 5000 });
    },
  });

  if (!item) return null;

  const seconds = resumeAt[item.id] ?? 0;
  const stamp = formatTimestamp(seconds);

  const save = () => {
    const candidate = toMemoryCandidate({
      mediaId: item.id,
      mediaTitle: item.title,
      seconds,
      note: note.trim() || undefined,
    });
    record.mutate({
      category: candidate.category,
      key: candidate.key,
      content: candidate.content,
      source: candidate.source,
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => {
          setJustSaved(false);
          setOpen(true);
        }}
        className="flex h-12 w-12 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-fg"
        aria-label={`Save this moment at ${stamp}`}
        title={`Save ${stamp} to brain`}
      >
        {justSaved ? <Check size={16} className="text-emerald-400" /> : <Bookmark size={16} />}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] text-fg-tertiary">{stamp}</span>
      <input
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="why this moment (optional)"
        aria-label="Note for this moment"
        className="h-12 min-w-0 flex-1 rounded-md border border-glass bg-transparent px-2 text-[11px] text-fg placeholder:text-fg-tertiary"
      />
      <button
        onClick={save}
        disabled={record.isPending}
        className="flex h-12 min-w-12 items-center justify-center rounded-md px-2 text-[11px] text-fg-secondary transition-colors hover:text-fg disabled:opacity-50"
        aria-label="Save moment"
      >
        {record.isPending ? "…" : "Save"}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="flex h-12 min-w-12 items-center justify-center rounded-md px-2 text-[11px] text-fg-tertiary transition-colors hover:text-fg"
        aria-label="Cancel"
      >
        Cancel
      </button>
    </div>
  );
}
