"use client";

import { Bookmark } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { formatTimestamp } from "@/lib/media/timestamp-refs";
import { useMediaDockStore } from "../stores/media-dock-store";

/**
 * SavedMomentsList (BDN-322) — the reopen half of media plan item #7.
 *
 * Self-audit found `reopenTargetFromKey` had no caller: moments could be
 * saved and never reopened. A write-only bookmark is worse than none —
 * the operator builds a habit against something that never pays out.
 *
 * SCOPED TO THE DOCKED MEDIA, and that is the honest scope rather than a
 * reduced one. A moment stores a media id and an offset but NO URL
 * (`reopenTargetFromKey` withholds it deliberately — a `blob:` URL dies
 * with the session). When the media is already in the player the URL is
 * in hand, so every row here is guaranteed to seek. A global bookmark
 * list would have to resolve ids to media it cannot reach and would
 * render entries that silently do nothing when clicked.
 *
 * Clicking drives the same token-based `requestSeek` the transcript pane
 * and timestamp bar use — one seek path across all three surfaces.
 *
 * Renders nothing when there are no moments: an empty "no saved moments"
 * block on every video is noise, and its absence is not information the
 * operator needs.
 */
export function SavedMomentsList() {
  const item = useMediaDockStore((s) => s.item);
  const requestSeek = useMediaDockStore((s) => s.requestSeek);

  const { data, isLoading } = trpc.brain.mediaMoments.useQuery(
    { mediaId: item?.id ?? "" },
    { enabled: Boolean(item?.id) },
  );

  if (!item || isLoading || !data || data.length === 0) return null;

  return (
    <section aria-label="Saved moments" className="border-t border-edge px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-fg-tertiary">
        <Bookmark size={10} /> saved moments
      </div>
      <ol className="space-y-0.5">
        {data.map((m) => (
          <li key={m.key}>
            <button
              onClick={() => requestSeek(m.seconds)}
              className="flex w-full gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-elevated"
              aria-label={`Jump to saved moment at ${formatTimestamp(m.seconds)}`}
            >
              <span className="shrink-0 pt-px font-mono text-[9px] text-fg-tertiary">
                {formatTimestamp(m.seconds)}
              </span>
              <span className="truncate text-[11px] text-fg-secondary">{m.content}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
