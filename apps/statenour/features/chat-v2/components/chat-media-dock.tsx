"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Music, SkipForward, X } from "lucide-react";
import { useMediaDockStore } from "../stores/media-dock-store";

/**
 * ChatMediaDock (BDN-311) — media plan item #2, persistent player.
 *
 * Sits between the message list and the composer, so playback survives
 * scrolling, streaming replies, and drawer navigation. Collapsed it is a
 * strip; expanded it is a theater panel. It renders nothing when nothing
 * is docked, so the chat layout is untouched in the common case.
 *
 * STILL NO PLAYER DEPENDENCY.
 * The originating plan proposed Vidstack/Media Chrome and this is the
 * item where that was said to earn itself. It does not, yet. Everything
 * the dock needs — play/pause, scrub, volume, fullscreen,
 * Picture-in-Picture, caption tracks, playback rate — is native on the
 * <video> element. What a library would add beyond this is chapters and
 * a custom skin. Chapters belong to item #3 (transcript + timestamps),
 * and that is the honest moment to re-evaluate: adopt it when the feature
 * needs it, not because a plan named it.
 *
 * The one genuinely non-native behavior is RESUME, and it is ~10 lines:
 * seek to the stored offset on mount, record position as it plays.
 *
 * Accessibility: the strip is a landmark region with a live title, and
 * every control has a label. Touch targets are 44px minimum per the
 * iOS-PWA primitives rule — this renders on the operator's phone.
 */
export function ChatMediaDock() {
  const item = useMediaDockStore((s) => s.item);
  const queue = useMediaDockStore((s) => s.queue);
  const expanded = useMediaDockStore((s) => s.expanded);
  const seek = useMediaDockStore((s) => s.seek);
  const resumeAt = useMediaDockStore((s) => s.resumeAt);
  const toggleExpanded = useMediaDockStore((s) => s.toggleExpanded);
  const close = useMediaDockStore((s) => s.close);
  const playNext = useMediaDockStore((s) => s.playNext);
  const consumeSeek = useMediaDockStore((s) => s.consumeSeek);
  const rememberPosition = useMediaDockStore((s) => s.rememberPosition);

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  // Apply a pending seek. Keyed on seek?.token so an identical repeat
  // timestamp still fires — see the SeekRequest note in the store.
  useEffect(() => {
    if (!seek || !mediaRef.current) return;
    mediaRef.current.currentTime = seek.seconds;
    void mediaRef.current.play().catch(() => {
      // Autoplay policy can reject a programmatic play() when the seek
      // did not originate from a gesture. The seek itself still applied;
      // the operator presses play. Never surface this as an error.
    });
    consumeSeek();
  }, [seek, consumeSeek]);

  // Restore the previous offset when this item mounts.
  const itemId = item?.id;
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

  const isVideo = item.kind === "video";

  return (
    <section
      aria-label={`Media player — ${item.title}`}
      className="relative z-10 border-t border-edge bg-void/95 backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 px-3 pt-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-fg-secondary">{item.title}</div>
          {queue.length > 0 ? (
            <div className="text-[9px] text-fg-tertiary">{queue.length} queued</div>
          ) : null}
        </div>

        {queue.length > 0 ? (
          <button
            onClick={playNext}
            className="flex h-11 w-11 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-fg"
            aria-label="Play next in queue"
            title="Next"
          >
            <SkipForward size={16} />
          </button>
        ) : null}

        {isVideo ? (
          <button
            onClick={toggleExpanded}
            className="flex h-11 w-11 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-fg"
            aria-label={expanded ? "Collapse player" : "Expand player"}
            aria-expanded={expanded}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        ) : null}

        <button
          onClick={close}
          className="flex h-11 w-11 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-red-400"
          aria-label="Close player"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-3 pb-2 sm:px-4">
        {isVideo ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={item.url}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            onEnded={playNext}
            className={`w-full rounded-lg border border-glass bg-black transition-[max-height] duration-200 ${
              expanded ? "max-h-[60vh]" : "max-h-40"
            }`}
            aria-label={item.title}
          />
        ) : (
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
        )}
      </div>
    </section>
  );
}
