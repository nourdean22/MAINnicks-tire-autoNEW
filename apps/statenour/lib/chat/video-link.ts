/**
 * U3 (2026-10-31) · video links in a chat message, recognised so they can play in place.
 *
 * YouTube and Vimeo get a tap-to-load player (see components/chat/video-link-facade.tsx): nothing
 * is fetched from either until the tap. Instagram and TikTok get a link card only; their embeds
 * need third-party scripts. IDs are matched strictly, so a look-alike URL never becomes an iframe.
 */
export type VideoLink =
  | { kind: "youtube"; id: string; url: string }
  | { kind: "vimeo"; id: string; url: string }
  | { kind: "instagram" | "tiktok"; url: string };

export const MAX_VIDEO_LINKS = 3;
const URL_RE = /https?:\/\/[^\s<>()"'\]]+/gi;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseVideoLink(raw: string): VideoLink | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const url = u.toString();
  if (host === "youtube.com" || host === "music.youtube.com") {
    const id = u.pathname === "/watch" ? u.searchParams.get("v") : u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
    return id && YT_ID.test(id) ? { kind: "youtube", id, url } : null;
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return YT_ID.test(id) ? { kind: "youtube", id, url } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.match(/^\/(?:video\/)?(\d{6,12})(?:\/|$)/)?.[1];
    return id ? { kind: "vimeo", id, url } : null;
  }
  if (host === "instagram.com" && /^\/(?:p|reel|reels|tv)\//.test(u.pathname)) return { kind: "instagram", url };
  if ((host === "tiktok.com" && /\/video\/\d+/.test(u.pathname)) || host === "vm.tiktok.com") return { kind: "tiktok", url };
  return null;
}

/** Each distinct video link in the text, in order, at most MAX_VIDEO_LINKS. */
export function findVideoLinks(text: string): VideoLink[] {
  const out: VideoLink[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const link = parseVideoLink(m[0].replace(/[.,;:!?]+$/, ""));
    if (!link) continue;
    const key = link.kind === "youtube" || link.kind === "vimeo" ? `${link.kind}:${link.id}` : link.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
    if (out.length >= MAX_VIDEO_LINKS) break;
  }
  return out;
}

/** The player URL a tap loads: the privacy-enhanced YouTube host, Vimeo with do-not-track. */
export function embedUrl(link: Extract<VideoLink, { id: string }>): string {
  return link.kind === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${link.id}?autoplay=1&rel=0`
    : `https://player.vimeo.com/video/${link.id}?autoplay=1&dnt=1`;
}
