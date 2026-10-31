"use client";

/**
 * U3 (2026-10-31) · videos play inside the chat, only after a tap.
 *
 * A YouTube or Vimeo link shows a plain Play card: no thumbnail, no script, no request to either
 * host until Nour taps it (the homepage's MP4 preload cost 50 MB a view; the same mistake is not
 * repeated here). The tap mounts the privacy-enhanced player, which may start playing because the
 * tap is the user gesture. Instagram and TikTok get a link card: their embeds need their scripts.
 */
import { useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { embedUrl, findVideoLinks, type VideoLink } from "@/lib/chat/video-link";

const LABEL: Record<VideoLink["kind"], string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  instagram: "Instagram",
  tiktok: "TikTok",
};

function Facade({ link }: { link: Extract<VideoLink, { id: string }> }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-surface border border-edge-subtle bg-black">
        <iframe
          src={embedUrl(link)}
          title={`${LABEL[link.kind]} video`}
          className="h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Play ${LABEL[link.kind]} video here`}
      className="flex min-h-11 w-full items-center gap-3 rounded-surface border border-edge-subtle bg-surface px-3 py-2.5 text-left text-[13px] text-fg-secondary hover:border-edge-strong hover:text-fg"
    >
      <Play size={16} aria-hidden />
      <span className="flex-1 truncate">Play {LABEL[link.kind]} video here</span>
    </button>
  );
}

export function VideoLinks({ text }: { text: string }) {
  const links = findVideoLinks(text);
  if (links.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {links.map((link) =>
        link.kind === "youtube" || link.kind === "vimeo" ? (
          <Facade key={`${link.kind}:${link.id}`} link={link} />
        ) : (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center gap-3 rounded-surface border border-edge-subtle bg-surface px-3 py-2.5 text-[13px] text-fg-secondary hover:border-edge-strong hover:text-fg"
          >
            <ExternalLink size={16} aria-hidden />
            <span className="flex-1 truncate">Open on {LABEL[link.kind]}</span>
          </a>
        ),
      )}
    </div>
  );
}
