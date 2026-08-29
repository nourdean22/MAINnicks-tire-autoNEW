/**
 * Where a reel is allowed to send people.
 *
 * WHY THIS EXISTS, measured rather than asserted. Every post this account has
 * published carried the bare `nickstire.org` homepage as its link, or no link
 * at all, while 175 topic-specific pages sat deployed and prerendered. The
 * reference post was about road salt corroding electrical connections and
 * `/electrical` existed; it linked to the homepage anyway. Funnel result over
 * 30 days: 13,871 views -> 74 profile visits -> ONE website tap.
 *
 * THE COUNT IN THIS HEADER USED TO SAY "eight of them". It was wrong, and it
 * had been repeated into `reelDestinationMap.ts` as well. Measured 2026-08-29:
 * `reel_jobs` holds 30 rows carrying an `igPostId` - 29 distinct, because
 * jobs 750002 and 780001 record the SAME post id - and 26 of those 29 are
 * present in the account's own analytics cache. A hand-typed count in a
 * comment is a cache with no invalidation; prefer a query.
 *
 * ── WHAT A DESTINATION CAN AND CANNOT DO ON INSTAGRAM ────────────────────
 * Verified 2026-08-29 against Meta's own parameter reference for
 * POST /{ig-user-id}/media. The complete accepted set is: access_token,
 * alt_text, audio_name, caption, collaborators, children, cover_url,
 * image_url, is_carousel_item, location_id, media_type, product_tags,
 * share_to_feed, thumb_offset, upload_type, user_tags, trial_params,
 * branded_content_sponsor_ids, is_paid_partnership, is_ai_generated,
 * video_url. There is NO link, url, website, destination or call-to-action
 * parameter, and a URL typed into a Reel caption renders as plain text that
 * viewers cannot tap.
 *
 * So a destination written into caption text is DECORATION at publish time.
 * It is not wired to anything, which is the precise defect class this module
 * was built to remove - it would just be a prettier version of it. A
 * destination's real uses are all OUT of band: the single bio link, a
 * comment-to-DM auto-reply, or a Story link sticker posted alongside.
 *
 * `location_id` is the one per-post, API-settable, genuinely tappable field
 * in that list, and this shop does not use it. That is the real lever for
 * local discovery here - not a caption URL.
 *
 * This module is therefore still correct and still worth having: it validates
 * destinations for the bio link, DM replies and any paid placement, and it
 * stops `/tire-sidewall`-class invented paths reaching a customer. It just
 * does not, and cannot, attach a link to an organic Reel.
 *
 * The first version of the promotability check asked for `landingDestination`
 * as a FREE-TEXT string. Within minutes of writing it, its own author
 * recommended `/tire-sidewall` - a page that does not exist and returns the
 * generic app shell. Free text is not more flexible; it is unvalidated, and the
 * failure it permits is a customer tapping a link into a 404. That is strictly
 * worse than no link.
 *
 * So a destination is a MEMBER OF THE DEPLOYED ROUTE SET, derived here from
 * PRERENDER_ROUTES - never a hand-copied list, because a duplicated array is a
 * document that goes stale and then lies.
 *
 * THE DEPLOYED/DECLARED DISTINCTION IS THE POINT. `ALL_ROUTES` includes entries
 * with `prerender: false`; those are declared but not built to static HTML.
 * Gating on `PRERENDER_ROUTES` means a destination is only valid if the page is
 * actually built. Drift between PRERENDER_ROUTES and the files on disk is
 * already a hard failure: `pnpm prerender:check` (scripts/check-prerender.mjs)
 * exits non-zero when an expected page is MISSING. This module therefore does
 * not re-implement that check; it depends on it, and the canary asserts the
 * dependency so nobody quietly gates on ALL_ROUTES instead.
 *
 * AN SPA THAT RETURNS 200 FOR EVERYTHING IS A LYING SURFACE. `/tire-sidewall`,
 * `/tire-pressure` and `/uneven-tire-wear` all answer HTTP 200 on nickstire.org
 * and none of them exist - the app serves the shell for any unmatched path. Any
 * live verification MUST discriminate by page-specific <title>, never by status
 * code. scripts/verify-reel-destinations.mjs does exactly that.
 */
import { PRERENDER_ROUTES } from "./routes";

/** Deployed, prerendered paths. Derived - never hand-listed. */
export const DEPLOYED_DESTINATIONS: readonly string[] = PRERENDER_ROUTES.map((r) => r.path);

const DEPLOYED_SET = new Set(DEPLOYED_DESTINATIONS);

/**
 * Reduce a declared destination to a comparable path.
 * Accepts a bare path or an absolute URL; strips query and hash, and drops a
 * trailing slash so "/brakes/" and "/brakes" are the same destination.
 */
export const ALLOWED_ORIGIN_HOSTS: readonly string[] = ["nickstire.org", "www.nickstire.org"];

export function normalizeDestination(dest: string | null | undefined): string | null {
  const d = (dest ?? "").trim();
  if (!d) return null;
  let path = d;
  if (/^https?:\/\//i.test(d)) {
    try {
      const u = new URL(d);
      // An absolute URL must point at Nick's. Stripping the origin before
      // validating meant https://example.com/brakes normalised to /brakes and
      // was certified as deployed - an off-site link wearing a valid pathname.
      if (!ALLOWED_ORIGIN_HOSTS.includes(u.hostname.toLowerCase())) return null;
      path = u.pathname;
    } catch {
      return null;
    }
  } else {
    path = d.split(/[?#]/)[0];
  }
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

/** True when the destination resolves to the site root, query and hash ignored. */
export function isHomepagePath(dest: string | null | undefined): boolean {
  const p = normalizeDestination(dest);
  return p === "/" || p === "";
}

/** True when the path is a deployed, prerendered page. */
export function isDeployedDestination(dest: string | null | undefined): boolean {
  const p = normalizeDestination(dest);
  return p !== null && DEPLOYED_SET.has(p);
}

/**
 * Why this destination may not be used, or null when it is fine.
 *
 * Written to be read by a human at the moment they are blocked, because the
 * person hitting this is usually mid-task and needs the fix, not a code.
 */
export function destinationProblem(dest: string | null | undefined): string | null {
  const p = normalizeDestination(dest);
  if (p === null) {
    return "no landing destination is declared. Pick the page that answers the question the reel asks.";
  }
  if (isHomepagePath(p)) {
    return (
      "the homepage is not a landing destination. Every post this account has published linked to " +
      "nickstire.org and it produced 74 profile visits and ONE website tap from 13,871 views - a viewer " +
      "who just watched a reel about one problem should land on the page about that problem, not on a " +
      "page that asks them to start searching again."
    );
  }
  if (!DEPLOYED_SET.has(p)) {
    return (
      `"${p}" is not a deployed page. It is not in PRERENDER_ROUTES, so nothing is built for it and a ` +
      "viewer tapping it gets the generic app shell - the site answers HTTP 200 for ANY path, so a link " +
      "that looks fine in a browser can still be a dead end. Choose a path from the deployed set " +
      "(shared/routes.ts), or leave the destination unset and let the pack stay blocked."
    );
  }
  return null;
}

/**
 * Candidate destinations whose path or title mentions every one of `terms`.
 * A helper for humans choosing a destination - deliberately NOT an automatic
 * assigner, because a plausible-looking match that is topically wrong is the
 * lying surface this whole module exists to prevent.
 */
export function suggestDestinations(terms: string[], limit = 5): Array<{ path: string; title: string }> {
  const needles = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (!needles.length) return [];
  return PRERENDER_ROUTES.filter((r) => {
    const hay = `${r.path} ${r.title}`.toLowerCase();
    return needles.every((n) => hay.includes(n));
  })
    .slice(0, limit)
    .map((r) => ({ path: r.path, title: r.title }));
}
