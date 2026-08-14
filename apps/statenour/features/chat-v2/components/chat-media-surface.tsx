"use client";

import { useEffect, useRef } from "react";
import { Music } from "lucide-react";
import { useMediaDockStore } from "../stores/media-dock-store";

/**
 * MediaPlayerSurface (BDN-315) — the ONE media element.
 *
 * Extracted from ChatMediaDock when the desktop focus panel (media plan
 * #6) arrived. Both surfaces need identical seek, resume and
 * position-recording behavior, and two copies of that logic would drift
 * — the focus panel would quietly stop honoring a transcript timestamp,
 * or record positions the dock never reads.
 *
 * MUTUAL EXCLUSION IS THE CALLER'S JOB, AND IT IS NOT OPTIONAL.
 * Exactly one of dock / focus panel may mount this at a time. Mounting
 * both puts two <video> elements on the same source — the "two elements
 * producing audio" defect review already caught once on the BDN-311
 * pop-out. The store's `focused` flag is the discriminator and each
 * surface checks it before rendering.
 *
 * Switching surfaces remounts the element and therefore resets its
 * currentTime. That is survivable only because onTimeUpdate has been
 * writing `resumeAt` continuously, so the new mount restores within a
 * timeupdate tick (~250ms). The resume mechanism built for the dock is
 * what makes the focus panel cheap.
 */
export function MediaPlayerSurface({ className }: { className?: string }) {
  const item = useMediaDockStore((s) => s.item);
  const seek = useMediaDockStore((s) => s.seek);
  const resumeAt = useMediaDockStore((s) => s.resumeAt);
  const playNext = useMediaDockStore((s) => s.playNext);
  const consumeSeek = useMediaDockStore((s) => s.consumeSeek);
  const rememberPosition = useMediaDockStore((s) => s.rememberPosition);

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const itemId = item?.id;

  // Apply a pending seek. Keyed on the request object so an identical
  // repeat timestamp still fires — see SeekRequest in the store.
  useEffect(() => {
    if (!seek || !mediaRef.current) return;
    mediaRef.current.currentTime = seek.seconds;
    void mediaRef.current.play().catch(() => {
      // Autoplay policy can reject a programmatic play() when the seek
      // did not originate from a gesture. The seek still applied; the
      // operator presses play. Never surface this as an error.
    });
    consumeSeek();
  }, [seek, consumeSeek]);

  // Restore the previous offset when this item mounts — including on a
  // dock↔focus switch, which is a remount.
  useEffect(() => {
    if (!itemId || !mediaRef.current) return;
    const offset = resumeAt[itemId];
    if (offset && offset > 0) mediaRef.current.currentTime = offset;
    // resumeAt is intentionally NOT a dependency: this must run once per
    // item, and including it would re-seek on every position write —
    // pinning playback to wherever it last reported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  if (!item) return null;

  const onTimeUpdate = () => {
    const el = mediaRef.current;
    if (el && itemId) rememberPosition(itemId, el.currentTime);
  };

  if (item.kind === "video") {
    return (
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        src={item.url}
        controls
        playsInline
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onEnded={playNext}
        className={className}
        aria-label={item.title}
      />
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-glass bg-[var(--bg-elevated)] px-3 py-2">
      <Music size={14} className="shrink-0 text-fg-tertiary" />
      <audio
        ref={mediaRef as React.RefObject<HTMLAudioElement>}
        src={item.url}
        controls
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onEnded={playNext}
        className="w-full"
        aria-label={item.title}
      />
    </div>
  );
}
