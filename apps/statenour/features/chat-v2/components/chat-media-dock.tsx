"use client";

import { ChevronDown, ChevronUp, PanelRight, SkipForward, X } from "lucide-react";
import { useMediaDockStore } from "../stores/media-dock-store";
import { MediaPlayerSurface } from "./chat-media-surface";
import { SaveMomentButton } from "./media-save-moment";

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
 * every control has a label. Touch targets are 48x48px minimum — the
 * figure AGENTS.md actually specifies. The first version of this file
 * used 44px (the iOS HIG number) and cited the repo rule while missing
 * it by 4px; review caught it. This renders on the operator's phone, so
 * the difference is real, not pedantic.
 */
export function ChatMediaDock() {
  const item = useMediaDockStore((s) => s.item);
  const queue = useMediaDockStore((s) => s.queue);
  const expanded = useMediaDockStore((s) => s.expanded);
  const focused = useMediaDockStore((s) => s.focused);
  const toggleExpanded = useMediaDockStore((s) => s.toggleExpanded);
  const setFocused = useMediaDockStore((s) => s.setFocused);
  const close = useMediaDockStore((s) => s.close);
  const playNext = useMediaDockStore((s) => s.playNext);

  // BDN-315 · when the desktop focus panel owns the player, the dock
  // renders NOTHING. Two surfaces mounting MediaPlayerSurface would put
  // two <video> elements on one source — the defect review caught on the
  // BDN-311 pop-out.
  if (!item || focused) return null;

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
            className="flex h-12 w-12 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-fg"
            aria-label="Play next in queue"
            title="Next"
          >
            <SkipForward size={16} />
          </button>
        ) : null}

        {/* BDN-316 · explicit save. Never an effect. */}
        <SaveMomentButton />

        {/* Desktop only — a 384px side panel would cover the whole
            conversation on a phone, which is why the dock IS the mobile
            answer and this control simply does not exist there. */}
        <button
          onClick={() => setFocused(true)}
          className="hidden h-12 w-12 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-fg md:flex"
          aria-label="Open in the focus panel"
          title="Focus panel"
        >
          <PanelRight size={16} />
        </button>

        {isVideo ? (
          <button
            onClick={toggleExpanded}
            className="flex h-12 w-12 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-fg"
            aria-label={expanded ? "Collapse player" : "Expand player"}
            aria-expanded={expanded}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        ) : null}

        <button
          onClick={close}
          className="flex h-12 w-12 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-red-400"
          aria-label="Close player"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-3 pb-2 sm:px-4">
        <MediaPlayerSurface
          className={`w-full rounded-lg border border-glass bg-black transition-[max-height] duration-200 ${
            expanded ? "max-h-[60vh]" : "max-h-40"
          }`}
        />
      </div>
    </section>
  );
}
