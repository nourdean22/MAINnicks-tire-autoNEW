/**
 * NonstopNickTopBar — slim membership band at the absolute top of every
 * PageLayout page (above SiteNavbar), pointing to /nonstop-nick.
 *
 * Deliberately NOT position:fixed — it scrolls away with the page so it
 * never stacks with SiteNavbar + StickyTrustBar as a third persistent
 * strip (see NotificationBar's "avoid stacking two strips + pushing the
 * hero down → LCP cost" note). Static markup, no queries, no state
 * beyond route suppression.
 *
 * Suppressed on the same buying-intent tire routes as NotificationBar
 * (those surfaces own their messaging) and on /nonstop-nick itself
 * (redundant on the page it links to).
 */
import { Link, useLocation } from "wouter";

const SUPPRESS_ON_ROUTES = ["/tires", "/tire-finder", "/nonstop-nick"];

export default function NonstopNickTopBar() {
  const [location] = useLocation();
  if (SUPPRESS_ON_ROUTES.some((r) => location.startsWith(r))) return null;

  return (
    <Link
      href="/nonstop-nick"
      className="flex items-center justify-center gap-2 bg-[#facc15] px-3 py-2 min-h-[44px] text-center active:scale-[0.99] transition-transform"
      data-testid="nonstop-nick-top-bar"
    >
      <span className="text-black text-[11px] sm:text-[12px] font-black uppercase tracking-wide leading-tight">
        Flat fixed for $0 — Nonstop Nick members get the small tire stuff
        covered · $7.99/mo
      </span>
      <span aria-hidden="true" className="text-black font-black text-[12px]">
        &rarr;
      </span>
    </Link>
  );
}
