/**
 * NonstopNickTopBar — slim membership band above the navbar row, pointing
 * to /nonstop-nick.
 *
 * 2026-07-04 overlap fix · the bar used to be a STATIC element in
 * PageLayout above the fixed SiteNavbar — but a static bar in flow and a
 * `fixed top-0` navbar both paint in the same top strip at scroll-top,
 * so the nav wordmark/links collided with the bar text (operator
 * screenshot, visible on every non-suppressed route since the bar
 * shipped). The bar now renders INSIDE SiteNavbar's fixed <nav>, above
 * the 60px row, and collapses away once the page scrolls (`collapsed`
 * comes from the navbar's existing scrolled state) — so it still reads
 * as "scrolls away with the page" and never becomes a third persistent
 * strip (the original LCP/stacking concern). Because it overlays the
 * hero instead of sitting in flow, it pushes nothing down — strictly
 * better for LCP than the old static placement.
 *
 * Suppressed on the same buying-intent tire routes as NotificationBar
 * (those surfaces own their messaging — /tires has its own in-page
 * membership section) and on /nonstop-nick itself (redundant on the
 * page it links to).
 */
import { Link, useLocation } from "wouter";

const SUPPRESS_ON_ROUTES = ["/tires", "/tire-finder", "/nonstop-nick"];

export default function NonstopNickTopBar({
  collapsed = false,
}: {
  collapsed?: boolean;
}) {
  const [location] = useLocation();
  if (SUPPRESS_ON_ROUTES.some((r) => location.startsWith(r))) return null;

  return (
    <div
      className={`overflow-hidden transition-all duration-300 ${
        collapsed ? "max-h-0 opacity-0" : "max-h-12 opacity-100"
      }`}
      aria-hidden={collapsed}
    >
      <Link
        href="/nonstop-nick"
        className="flex items-center justify-center gap-2 bg-[#facc15] px-3 py-2 min-h-[44px] text-center active:scale-[0.99] transition-transform"
        data-testid="nonstop-nick-top-bar"
        tabIndex={collapsed ? -1 : 0}
      >
        <span className="text-black text-[11px] sm:text-[12px] font-black uppercase tracking-wide leading-tight">
          Stuck in the Euclid Ave line? Nonstop Nick members pull up anytime —
          flats fixed for $0 · $7.99/mo
        </span>
        <span aria-hidden="true" className="text-black font-black text-[12px]">
          &rarr;
        </span>
      </Link>
    </div>
  );
}
