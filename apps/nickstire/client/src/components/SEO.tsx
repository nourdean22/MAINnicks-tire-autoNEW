/**
 * SEO Component — Manages canonical tags, breadcrumbs, and meta tags
 * Used across all pages for consistent SEO implementation.
 */

import { useEffect } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";

// Extend Window interface to include umami
declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: Record<string, unknown>) => void;
    };
  }
}

// Domain is configurable via SITE_URL env var (set on Railway).
// Vite exposes it as import.meta.env.VITE_SITE_URL at build time.
const BASE_URL = import.meta.env.VITE_SITE_URL || "https://nickstire.org";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface SEOHeadProps {
  title: string;
  description: string;
  canonicalPath: string; // e.g. "/tires" or "/" or "/blog/my-article"
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogUrl?: string;
  twitterCard?: "summary" | "summary_large_image";
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  /** Set to "noindex, nofollow" for pages that should not appear in search results (e.g. ad landing pages, internal tools) */
  robots?: string;
}

/**
 * Sets document title, meta description, and canonical link tag.
 * Call once per page in a useEffect or at the top of the page component.
 */
export function SEOHead({
  title,
  description,
  canonicalPath,
  ogImage,
  ogTitle,
  ogDescription,
  ogUrl,
  twitterCard = "summary_large_image",
  twitterTitle,
  twitterDescription,
  twitterImage,
  robots,
}: SEOHeadProps) {
  useEffect(() => {
    const canonicalUrl = ogUrl || `${BASE_URL}${canonicalPath}`;
    // 2026-05-06 wave-16 · default OG image is the full-sign storefront
    // shot for social/messaging shares — strongest first-impression visual.
    // 2026-09-07 · same photo, but as /og-image.jpg: a 1200x630 JPEG. Link
    // preview bots (facebookexternalhit, Twitterbot, LinkedIn, iMessage) read
    // the PRERENDERED page, i.e. this tag, not index.html's — and a 1672x941
    // WebP is cropped by the 1.91:1 card and not decoded by every previewer.
    // Keep this in step with index.html's og:image.
    const defaultOgImage = ogImage || `${BASE_URL}/og-image.jpg`;

    // Title
    document.title = title;

    // Helper: upsert a <meta> tag by selector
    function upsertMeta(selector: string, attr: "name" | "property", attrValue: string, content: string) {
      let el = document.querySelector(selector);
      if (el) {
        el.setAttribute("content", content);
      } else {
        el = document.createElement("meta");
        el.setAttribute(attr, attrValue);
        el.setAttribute("content", content);
        document.head.appendChild(el);
      }
    }

    // Meta description
    upsertMeta('meta[name="description"]', "name", "description", description);

    // Robots directive (override index.html default when specified)
    if (robots) {
      upsertMeta('meta[name="robots"]', "name", "robots", robots);
    }

    // Canonical link
    let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (canonicalLink) {
      canonicalLink.href = canonicalUrl;
    } else {
      canonicalLink = document.createElement("link");
      canonicalLink.rel = "canonical";
      canonicalLink.href = canonicalUrl;
      document.head.appendChild(canonicalLink);
    }

    // Open Graph tags
    upsertMeta('meta[property="og:type"]', "property", "og:type", "website");
    upsertMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    upsertMeta('meta[property="og:title"]', "property", "og:title", ogTitle || title);
    upsertMeta('meta[property="og:description"]', "property", "og:description", ogDescription || description);
    upsertMeta('meta[property="og:image"]', "property", "og:image", defaultOgImage);
    upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", "Nick's Tire & Auto");

    // Twitter Card tags
    upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", twitterCard);
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", twitterTitle || ogTitle || title);
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", twitterDescription || ogDescription || description);
    upsertMeta('meta[name="twitter:image"]', "name", "twitter:image", twitterImage || defaultOgImage);

    // Cleanup: remove canonical on unmount so next page can set its own
    // Also reset robots to default indexable state to prevent noindex from persisting across routes
    return () => {
      const link = document.querySelector('link[rel="canonical"]');
      if (link) link.remove();
      if (robots) {
        const robotsMeta = document.querySelector('meta[name="robots"]');
        if (robotsMeta) {
          robotsMeta.setAttribute("content", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1");
        }
      }
    };
  }, [title, description, canonicalPath, ogImage, ogTitle, ogDescription, ogUrl, twitterCard, twitterTitle, twitterDescription, twitterImage, robots]);

  return null;
}

/**
 * Breadcrumb navigation with BreadcrumbList JSON-LD schema.
 * Renders both the visible breadcrumb trail and the structured data.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  // Build the full breadcrumb chain starting with Home
  const fullItems: BreadcrumbItem[] = [
    { label: "Home", href: "/" },
    ...items,
  ];

  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: fullItems.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      ...(item.href ? { item: `${BASE_URL}${item.href}` } : {}),
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 flex-wrap">
        {fullItems.map((item, index) => (
          <span key={index} className="flex items-center gap-2">
            {index > 0 && <ChevronRight className="w-3 h-3 text-foreground/60" />}
            {item.href && index < fullItems.length - 1 ? (
              <Link
                href={item.href}
                className="text-[12px] text-foreground/70 hover:text-primary transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className="text-[12px] text-primary">{item.label}</span>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}

/**
 * Click-to-call tracking wrapper.
 * Fires analytics events AND logs to the database for admin dashboard visibility.
 */
export function trackPhoneClick(source: string) {
  // 2026-05-07 wave-45 · design-spells haptic feedback: short 25ms
  // vibration on tap (mobile only — Vibration API is no-op on desktop).
  // Fits the EUCLID GRIT brand register because it's a tactile mechanical
  // signal, not a digital ping. The Cleveland-tough analog: pressing a
  // physical button on a tool. Try/catch because some browsers (iOS
  // Safari) don't expose vibrate; failing silently is correct.
  if (typeof window !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(25);
    } catch {
      // ignored — not all browsers permit vibration
    }
  }
  // Fire analytics event if umami is available
  if (typeof window !== "undefined" && window.umami) {
    window.umami.track("phone_click", { source });
  }
  // GA4: Track phone call event
  import("@/lib/ga4").then(({ trackPhoneClick: ga4PhoneClick }) => {
    ga4PhoneClick(source, { page: window.location.pathname });
  });
  // Meta Pixel Contact event, then the DB row — chained so the row carries
  // the SAME event_id the pixel fired (journey-join wave 2026-06).
  // trackPhoneCall has always generated + returned this id; it was
  // discarded, which made pixel<->CAPI Contact dedup and click-row joins
  // structurally impossible. sessionId = the localStorage visitor id every
  // other captured surface stores.
  //
  // BUG FIX (May 2026): client previously sent `sourceElement` but the
  // server schema validates `clickElement` (matches the column name in
  // call_events). The mismatched field name was being silently dropped
  // by zod's nullish() — so call_events rows had clickElement=NULL across
  // the entire history. Renamed to clickElement + added userAgent so
  // device-type analytics actually populate.
  Promise.all([import("@/lib/metaPixel"), import("@/lib/utm")]).then(([{ trackPhoneCall }, { getUtmData }]) => {
    const eventId = trackPhoneCall({ sourcePage: source });
    const utm = getUtmData();
    fetch("/api/trpc/callTracking.logCall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        json: {
          phoneNumber: "(216) 862-0005",
          sourcePage: source,
          clickElement: "phone_link",
          utmSource: utm.utmSource || null,
          utmMedium: utm.utmMedium || null,
          utmCampaign: utm.utmCampaign || null,
          landingPage: utm.landingPage || null,
          referrer: utm.referrer || null,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
          sessionId: getCachedSessionId(),
          eventId: eventId || null,
        },
      }),
    }).catch(() => { /* silent fail — don't block the call */ });
  }).catch(() => { /* import blocked — never block the call */ });
  // Also fire a custom DOM event for any other tracking
  window.dispatchEvent(new CustomEvent("nick_phone_click", { detail: { source } }));
}

/**
 * Generic event-tracking wrapper for non-phone customer-side
 * conversions. Fires umami + GA4 + a DOM event so consumers can
 * subscribe without coupling to a specific provider.
 *
 * Use for: PhotoRibbon photo views, sticky-CTA Hold-A-Bay clicks,
 * scroll-depth milestones, anywhere we want signal but a DB row is
 * overkill.
 *
 * PII GUARDRAIL (attribution-wave 2026-06): NEVER pass customer name,
 * phone, email, VIN, or message text in `data`. It is forwarded verbatim
 * to GA4 + umami (third parties) AND persisted via customerEvents.log,
 * which has NO server-side sanitization. Safe payload = labels only:
 * source/surface, CTA label, page type, service slug.
 */
export function trackEvent(
  eventName: string,
  data?: Record<string, string | number | boolean>,
) {
  if (typeof window !== "undefined" && window.umami) {
    try {
      window.umami.track(eventName, data ?? {});
    } catch {
      /* umami can throw on SSR or teardown — silent fail */
    }
  }
  // GA4: best-effort via window.gtag if loaded. Type-narrowed to the
  // small window-typed surface the rest of the codebase already uses.
  if (
    typeof window !== "undefined" &&
    typeof (window as Window & { gtag?: (...args: unknown[]) => void }).gtag === "function"
  ) {
    try {
      (window as Window & { gtag: (...args: unknown[]) => void }).gtag(
        "event",
        eventName,
        {
          ...data,
          page_path: window.location.pathname,
        },
      );
    } catch {
      /* analytics blocked — fine */
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("nick_event", { detail: { eventName, data } }),
    );
  }

  // Persist to DB via tRPC for the admin dashboard. Best-effort —
  // analytics blockers, network issues, or session expiry must not
  // break the customer-facing UX. Same pattern as trackPhoneClick.
  if (typeof window !== "undefined") {
    import("@/lib/utm").then(({ getUtmData }) => {
      const utm = getUtmData();
      const sessionId = getCachedSessionId();
      fetch("/api/trpc/customerEvents.log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          json: {
            eventName,
            eventData: data ?? {},
            sourcePage: window.location.pathname,
            utmSource: utm.utmSource || null,
            utmMedium: utm.utmMedium || null,
            utmCampaign: utm.utmCampaign || null,
            referrer: utm.referrer || null,
            userAgent: navigator.userAgent.slice(0, 500),
            sessionId,
          },
        }),
      }).catch(() => { /* silent fail — never block UX on analytics */ });
    }).catch(() => { /* utm import blocked — fine */ });
  }
}

// journey-join wave 2026-06 — the visitor-id generator moved to
// @/lib/session (single source of truth: trackEvent, trackPhoneClick, and
// getUtmData all read the SAME localStorage key so every captured surface
// joins on one exact key). Same behavior, same key, module-cached there.
import { getSessionId as getCachedSessionId } from "@/lib/session";

/**
 * Skip navigation link — renders as first focusable element.
 * Only visible when focused via keyboard.
 */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-md focus:font-heading focus:font-bold focus:text-sm focus:tracking-wider"
    >
      Skip to main content
    </a>
  );
}
