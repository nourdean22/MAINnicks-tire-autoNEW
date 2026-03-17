/**
 * SEO Component — Manages canonical tags, breadcrumbs, and meta tags
 * Used across all pages for consistent SEO implementation.
 */

import { useEffect } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";

const BASE_URL = "https://nickstire.org";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface SEOHeadProps {
  title: string;
  description: string;
  canonicalPath: string; // e.g. "/tires" or "/" or "/blog/my-article"
  ogImage?: string;
}

/**
 * Sets document title, meta description, and canonical link tag.
 * Call once per page in a useEffect or at the top of the page component.
 */
export function SEOHead({ title, description, canonicalPath, ogImage }: SEOHeadProps) {
  useEffect(() => {
    // Title
    document.title = title;

    // Meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute("content", description);
    } else {
      const meta = document.createElement("meta");
      meta.name = "description";
      meta.content = description;
      document.head.appendChild(meta);
    }

    // Canonical link
    const canonicalUrl = `${BASE_URL}${canonicalPath}`;
    let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (canonicalLink) {
      canonicalLink.href = canonicalUrl;
    } else {
      canonicalLink = document.createElement("link");
      canonicalLink.rel = "canonical";
      canonicalLink.href = canonicalUrl;
      document.head.appendChild(canonicalLink);
    }

    // OG URL
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) {
      ogUrl.setAttribute("content", canonicalUrl);
    }

    // OG Title
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      ogTitle.setAttribute("content", title);
    }

    // OG Description
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) {
      ogDesc.setAttribute("content", description);
    }

    // OG Image (if provided)
    if (ogImage) {
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) {
        ogImg.setAttribute("content", ogImage);
      }
    }

    // Twitter Title
    const twTitle = document.querySelector('meta[name="twitter:title"]');
    if (twTitle) {
      twTitle.setAttribute("content", title);
    }

    // Twitter Description
    const twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) {
      twDesc.setAttribute("content", description);
    }

    // Cleanup: remove canonical on unmount so next page can set its own
    return () => {
      const link = document.querySelector('link[rel="canonical"]');
      if (link) link.remove();
    };
  }, [title, description, canonicalPath, ogImage]);

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
                className="font-mono text-xs text-foreground/50 hover:text-primary transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className="font-mono text-xs text-primary">{item.label}</span>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}

/**
 * Click-to-call tracking wrapper.
 * Fires a custom event for analytics when a phone link is clicked.
 */
export function trackPhoneClick(source: string) {
  // Fire analytics event if umami is available
  if (typeof window !== "undefined" && (window as any).umami) {
    (window as any).umami.track("phone_click", { source });
  }
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
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:bg-nick-yellow focus:text-nick-dark focus:px-4 focus:py-2 focus:rounded-md focus:font-heading focus:font-bold focus:text-sm focus:tracking-wider"
    >
      Skip to main content
    </a>
  );
}
