import { Instagram, Play } from "lucide-react";

interface InstagramTilePost {
  type: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  mediaProductType?: string | null;
}

const VIDEO_FILE = /\.(mp4|mov|webm|m4v)(\?|#|$)/i;

/**
 * Media for one tile of Home's Instagram strip: a facade, never a <video>.
 *
 * Each tile is a link to Instagram and nothing plays inline. A <video
 * preload="metadata"> with no poster made browsers fetch the whole 14-18 MB
 * reel, about 50 MB per homepage view and 86% of nickstire's outbound traffic
 * on 2026-10-30 (railway-audit, Railway HTTP logs). Facade pattern, as in
 * lite-youtube-embed and Lighthouse "third-party facades": a static poster plus
 * a play badge; the real media loads only on intent, the tap to Instagram.
 */
export function InstagramTileMedia({ post }: { post: InstagramTilePost }) {
  // A video file never goes into an <img>: the DB fallback can label a reel "post" or "carousel".
  const isVideo = post.type === "VIDEO" || post.mediaProductType === "REELS" || VIDEO_FILE.test(post.mediaUrl ?? "");
  const image = post.thumbnailUrl || (!isVideo ? post.mediaUrl : undefined);
  return (
    <>
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div
          data-testid="instagram-tile-placeholder"
          className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(253,185,19,0.14),transparent_45%),#0A0A0A]"
        >
          <Instagram className="h-10 w-10 text-nick-yellow/70" />
        </div>
      )}
      {isVideo ? (
        <span
          data-testid="instagram-tile-play"
          aria-hidden="true"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
        >
          <Play className="h-4 w-4 fill-current" />
        </span>
      ) : null}
    </>
  );
}
