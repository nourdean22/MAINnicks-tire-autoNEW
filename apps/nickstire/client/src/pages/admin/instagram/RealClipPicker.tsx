/**
 * Per-beat "Use real clip" picker for the reel studio (2026-10-18, shop-media-library).
 *
 * Binds a storyboard beat to an approved shop video: sets source "real" and
 * realAssetId (StoryboardBeat in lib/facelessReelStudio.ts). The server binds the
 * registry row's exact bytes (server/services/realShotBinding.ts); a URL never
 * self-asserts real. Only VERTICAL clips are offered because reelAssembly
 * center-crops every beat to 1080x1920, which would cut most of a horizontal frame.
 *
 * The "needs real footage" line reads shared/shotRouter.ts beatGenerationRoute, the
 * same function the server routes on, so the two cannot disagree.
 */
import { useState, type ReactNode } from "react";
import { Film, Play } from "lucide-react";
import { beatGenerationRoute, type ShotSource } from "@shared/shotRouter";
import type { ShopMediaItem } from "@shared/shopMedia";
import { trpc } from "@/lib/trpc";
import { formatClipLength } from "../shared/format";

export interface RealClipBeat {
  beatNumber: number;
  visual?: string | null;
  source?: ShotSource | null;
  realAssetId?: string | null;
}

export type RealClipPatch =
  | { source: "real"; realAssetId: string }
  | { source: undefined; realAssetId: undefined };

const clipTitle = (item: ShopMediaItem) => item.subject?.trim() || `Clip ${item.assetId}`;

function ClipPoster({ item, className }: { item: ShopMediaItem; className: string }) {
  if (!item.url) return <div className={`${className} flex items-center justify-center bg-muted`}><Film className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></div>;
  // #t=0.1 makes iOS Safari paint a first frame without a separate poster image.
  return <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" className={`${className} bg-muted object-cover`} />;
}

export default function RealClipPicker({ beat, onChange }: { beat: RealClipBeat; onChange: (patch: RealClipPatch) => void }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ShopMediaItem | null>(null);
  const clips = trpc.shopMedia.list.useInfiniteQuery(
    { state: "approved", kind: "video", orientation: "vertical", limit: 24 },
    { enabled: open, staleTime: 60_000, getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const items = clips.data?.pages.flatMap((page) => page.items) ?? [];

  const boundId = beat.realAssetId?.trim() || null;
  const bound = boundId ? (chosen?.assetId === boundId ? chosen : items.find((i) => i.assetId === boundId) ?? null) : null;
  const needsFootage = beatGenerationRoute(beat) === "needs_real_footage";

  const pick = (item: ShopMediaItem) => {
    setChosen(item);
    setOpen(false);
    onChange({ source: "real", realAssetId: item.assetId });
  };

  let panel: ReactNode = null;
  if (open) {
    let content: ReactNode;
    if (!clips.data) {
      if (clips.isError || clips.fetchStatus === "paused") {
        content = (
          <div className="space-y-1 text-xs text-amber-500">
            <p>{clips.isError ? "Could not load clips." : "Offline: clips could not load."} This is unknown, not empty.</p>
            <button type="button" onClick={() => void clips.refetch()} className="min-h-12 rounded-md bg-secondary px-3 text-sm text-foreground">Try again</button>
          </div>
        );
      } else {
        content = <p className="text-xs text-muted-foreground">Loading clips...</p>;
      }
    } else if (items.length === 0) {
      content = <p className="text-xs text-muted-foreground">No approved vertical clips yet. Approve some in Shop media.</p>;
    } else {
      content = (
        <>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {items.map((item) => {
              const length = formatClipLength(item.durationMs);
              return (
                <li key={item.assetId}>
                  <button
                    type="button"
                    aria-label={`${clipTitle(item)}${length ? `, ${length}` : ""}`}
                    onClick={() => pick(item)}
                    className={`block w-full overflow-hidden rounded-md border text-left ${item.assetId === boundId ? "border-primary ring-2 ring-primary/40" : "border-border"}`}
                  >
                    <div className="relative">
                      <ClipPoster item={item} className="aspect-[9/16] w-full" />
                      {length && (
                        <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">
                          <Play className="h-2.5 w-2.5" aria-hidden="true" />
                          {length}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 p-1 text-[11px]">{clipTitle(item)}</p>
                  </button>
                </li>
              );
            })}
          </ul>
          {clips.hasNextPage && (
            <button
              type="button"
              onClick={() => void clips.fetchNextPage()}
              disabled={clips.isFetchingNextPage}
              className="min-h-12 w-full rounded-md border border-border text-sm disabled:opacity-60"
            >
              {clips.isFetchingNextPage ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      );
    }
    panel = (
      <section aria-label={`Real clips for beat ${beat.beatNumber}`} className="space-y-2 rounded-md border border-border bg-background p-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">Approved vertical clips</p>
          <button type="button" onClick={() => setOpen(false)} className="min-h-12 px-2 text-sm text-muted-foreground underline">Close</button>
        </div>
        {content}
      </section>
    );
  }

  return (
    <div className="space-y-2">
      {boundId ? (
        <div className="flex items-center gap-2">
          {bound ? <ClipPoster item={bound} className="h-16 w-9 shrink-0 rounded" /> : <Film className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <div className="min-w-0 flex-1 text-xs">
            <p className="truncate font-medium">{bound ? clipTitle(bound) : `Clip ${boundId}`}</p>
            {bound && formatClipLength(bound.durationMs) && <p className="text-muted-foreground">{formatClipLength(bound.durationMs)}</p>}
          </div>
          <button
            type="button"
            onClick={() => { setChosen(null); onChange({ source: undefined, realAssetId: undefined }); }}
            className="min-h-12 shrink-0 px-2 text-sm text-muted-foreground underline"
          >
            Remove clip
          </button>
        </div>
      ) : needsFootage ? (
        <p className="text-xs text-amber-500">Needs real footage. Pick an approved vertical clip, or this beat is held.</p>
      ) : null}
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-12 items-center gap-2 rounded-md border border-border px-3 text-sm">
          <Film className="h-4 w-4" aria-hidden="true" />
          {boundId ? "Change clip" : "Use real clip"}
        </button>
      )}
      {panel}
    </div>
  );
}
