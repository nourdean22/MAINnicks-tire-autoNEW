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
}: SEOHeadProps) {
  useEffect(() => {
    const canonicalUrl = ogUrl || `${BASE_URL}${canonicalPath}`;
    const defaultOgImage = ogImage || "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/og-share-image-b6xtjfHGwFJnz4MtsoFkCp.png";

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
    return () => {
      const link = document.querySelector('link[rel="canonical"]');
      if (link) link.remove();
    };
  }, [title, description, canonicalPath, ogImage, ogTitle, ogDescription, ogUrl, twitterCard, twitterTitle, twitterDescription, twitterImage]);

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
            {index > 0 && <ChevronRight className="w-3 h-3 text-foreground/30" />}
            {item.href && index < fullItems.length - 1 ? (
              <Link
                href={item.href}
                className="text-[12px] text-foreground/50 hover:text-primary transition-colors"
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
  // Fire analytics event if umami is available
  if (typeof window !== "undefined" && window.umami) {
    window.umami.track("phone_click", { source });
  }
  // Meta Pixel: Track phone call as a Contact conversion event
  import("@/lib/metaPixel").then(({ trackPhoneCall }) => {
    trackPhoneCall({ sourcePage: source });
  });
  // GA4: Track phone call event
  import("@/lib/ga4").then(({ trackPhoneClick: ga4PhoneClick }) => {
    ga4PhoneClick(source, { page: window.location.pathname });
  });
  // Log to database via tRPC for admin dashboard call tracking
  import("@/lib/utm").then(({ getUtmData }) => {
    const utm = getUtmData();
    fetch("/api/trpc/callTracking.logCall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        json: {
          phoneNumber: "(216) 862-0005",
          sourcePage: source,
          sourceElement: "phone_link",
          utmSource: utm.utmSource || null,
          utmMedium: utm.utmMedium || null,
          utmCampaign: utm.utmCampaign || null,
          landingPage: utm.landingPage || null,
          referrer: utm.referrer || null,
        },
      }),
    }).catch(() => { /* silent fail — don't block the call */ });
  });
  // Also fire a custom DOM event for any other tracking
  window.dispatchEvent(new CustomEvent("nick_phone_click", { detail: { source } }));
}

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
