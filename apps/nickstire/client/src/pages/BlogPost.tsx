/*
 * BLOG POST — Individual article page for Nick's Tire & Auto
 *
 * SEO-optimized with JSON-LD Article + BreadcrumbList schema markup.
 *
 * Two content sources:
 *   1. Static registry — @shared/blog (hand-authored, instant render)
 *   2. Dynamic articles — trpc.content.articleBySlug (DB-seeded, fallback)
 *
 * Lookup order: static first (zero network), then tRPC dynamic fallback.
 * Dynamic articles are normalized into the same shape the renderer expects
 * so the rest of the page stays source-agnostic.
 */

import PageLayout from "@/components/PageLayout";
import { useRef, useEffect, useMemo, useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { getArticleBySlug, BLOG_ARTICLES, type BlogArticle } from "@shared/blog";
import { trpc } from "@/lib/trpc";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import {
  Phone, Clock, ChevronRight, ArrowLeft, ArrowRight, Tag,
  ListTree, AlertTriangle, ShieldCheck, MessageSquare, CreditCard,
  BookOpen,
} from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Slugify a heading for in-page anchors. Used by TableOfContents + section IDs.
 * Lowercase, alphanumeric+dash, trimmed.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

/**
 * TableOfContents — sticky-on-desktop sidebar for posts with 3+ sections.
 * Highlights the active section as the user scrolls.
 */
function TableOfContents({ sections }: { sections: { heading: string }[] }) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const ids = sections.map((s) => slugify(s.heading)).filter(Boolean);
    if (ids.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 3) return null;

  return (
    <nav className="sticky top-24 hidden lg:block">
      <div className="bg-card/40 border border-border/30 rounded-xl p-4">
        <div className="flex items-center gap-2 text-foreground/40 text-xs uppercase tracking-[0.18em] font-bold mb-3">
          <ListTree className="w-3.5 h-3.5" />
          On this page
        </div>
        <ul className="space-y-1.5 text-sm">
          {sections.map((s, i) => {
            const id = slugify(s.heading);
            const active = activeId === id;
            return (
              <li key={i}>
                <a
                  href={`#${id}`}
                  className={`block py-1 px-2 rounded transition-colors leading-snug border-l-2 ${
                    active
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-foreground/55 hover:text-foreground hover:bg-card/60"
                  }`}
                >
                  {s.heading}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/**
 * Map a blog category → the most relevant service slug for CTAs and the
 * cost-of-waiting/anchor copy. Keeps the in-content CTA contextual.
 */
const CATEGORY_TO_SERVICE: Record<string, { slug: string; label: string; pitch: string }> = {
  Brakes: { slug: "brakes", label: "Brake Service", pitch: "Free brake check. Pads from $129/axle. Pictures of worn parts before any replacement." },
  Tires: { slug: "tires", label: "Tires & Wheels", pitch: "Free mount + balance + valve stems. New + inspected used tires from $25/installed. Walk-ins welcome." },
  Diagnostics: { slug: "diagnostics", label: "Check Engine Light", pitch: "Free OBD-II code scan. $95 deeper check credited to repair if you say yes. We test before we replace." },
  Maintenance: { slug: "oil-change", label: "Oil Change & Maintenance", pitch: "Full conventional oil change from $29.99. Free 27-point check every visit." },
  Emissions: { slug: "emissions", label: "Emissions / E-Check", pitch: "Free pre-test before you waste a state appointment. We catch the actual cause, not just the code." },
  Electrical: { slug: "diagnostics", label: "Electrical Check", pitch: "Battery, alternator, starter testing free with any repair. Wiring + parasitic-draw work at $120/hr." },
  Transmission: { slug: "transmission", label: "Transmission Service", pitch: "Fluid + filter from $179. Full check before any major work — we tell you if a rebuild beats a repair." },
};

/* ─── PILLAR CALLOUT — hub-and-spoke topology activator ─────────
 *
 * Each blog article gets an automatic outbound link to the pillar
 * article that covers its topic broadly. This activates the hub-
 * and-spoke topology built in waves 35-37 — the three pillars
 * (Tire Guide / Auto Repair Manual / Pothole-Salt Damage Guide)
 * gain ~30+ inbound internal links instantly, without editing
 * any of the existing supporting articles.
 *
 * Map: category → pillar slug. If the article IS the pillar, the
 * callout is suppressed.
 */
const CATEGORY_TO_PILLAR: Record<string, { slug: string; title: string; subtitle: string }> = {
  "Tires": {
    slug: "complete-cleveland-tire-guide",
    title: "The Complete Cleveland Tire Guide",
    subtitle: "Sidewall numbers, used vs new math, free-services traps, and the Cleveland pothole reality — the full 2,500-word pillar.",
  },
  "Brake Repair": {
    slug: "cleveland-auto-repair-owners-manual",
    title: "The Cleveland Auto Repair Owner's Manual",
    subtitle: "The honest sequence of what to fix when, the recommended-services trap, and how to read a brake-job quote without getting upsold.",
  },
  "Diagnostics": {
    slug: "cleveland-auto-repair-owners-manual",
    title: "The Cleveland Auto Repair Owner's Manual",
    subtitle: "Check engine light, transmission fluid vs gearbox, battery vs alternator — the check-vs-parts-cannon distinction.",
  },
  "Engine Repair": {
    slug: "cleveland-auto-repair-owners-manual",
    title: "The Cleveland Auto Repair Owner's Manual",
    subtitle: "From oil-change math to electrical diagnosis to the recommended-services trap — the full 3,000-word pillar.",
  },
  "Emissions": {
    slug: "cleveland-auto-repair-owners-manual",
    title: "The Cleveland Auto Repair Owner's Manual",
    subtitle: "How to read a check-engine-light quote, the check-vs-parts-cannon distinction, and the full 3,000-word repair pillar.",
  },
  "Transmission": {
    slug: "cleveland-auto-repair-owners-manual",
    title: "The Cleveland Auto Repair Owner's Manual",
    subtitle: "Why 8 of 10 'transmission problems' are actually fluid or sensor issues — plus the full repair pillar.",
  },
  "Auto Repair": {
    slug: "cleveland-auto-repair-owners-manual",
    title: "The Cleveland Auto Repair Owner's Manual",
    subtitle: "The full 3,000-word repair pillar — brakes, oil, suspension, electrical, and the honest sequence of what to fix when.",
  },
  "Cleveland-Specific": {
    slug: "cleveland-pothole-salt-damage-guide",
    title: "The Cleveland Pothole + Salt Damage Guide",
    subtitle: "What 30,000 tons of road salt + freeze-thaw + lake-effect actually do to cars — the visual diagnose-it-yourself guide.",
  },
  "Fleet Services": {
    slug: "cleveland-auto-repair-owners-manual",
    title: "The Cleveland Auto Repair Owner's Manual",
    subtitle: "The full repair pillar — useful for any fleet manager assessing service vendors and recommended-services lists.",
  },
};

interface PillarCalloutProps {
  category: string;
  /** Slug of the current article — used to suppress the callout on the pillar itself */
  currentSlug: string;
}

function PillarCallout({ category, currentSlug }: PillarCalloutProps) {
  const pillar = CATEGORY_TO_PILLAR[category];
  if (!pillar) return null;
  if (pillar.slug === currentSlug) return null;

  return (
    <FadeIn>
      <div className="mt-12 rounded-[1.5rem] p-[3px] bg-[#FDB913]/[0.06] ring-1 ring-[#FDB913]/30">
        <div className="bg-[#141414] rounded-[calc(1.5rem-3px)] p-6 lg:p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-[#FDB913]/15 text-[#FDB913] flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[#FDB913] font-bold mb-1">
                Read the full pillar
              </p>
              <h3 className="font-heading text-xl sm:text-2xl font-extrabold text-foreground tracking-tight uppercase leading-tight mb-2">
                {pillar.title}
              </h3>
              <p className="text-foreground/65 text-sm sm:text-base leading-relaxed mb-4 body-pretty">
                {pillar.subtitle}
              </p>
              <Link
                href={`/blog/${pillar.slug}`}
                className="group inline-flex items-center gap-2 bg-[#FDB913] text-[#0A0A0A] px-5 py-2.5 rounded-md font-bold text-sm transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_4px_20px_rgba(253,185,19,0.4)] active:scale-[0.98]"
              >
                Read the full guide
                <ArrowRight className="w-4 h-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

/**
 * MidArticleCTA — a single, contextual conversion block injected after
 * the second section. Tied to the post's category so the offer is relevant.
 */
function MidArticleCTA({ category }: { category: string }) {
  const svc = CATEGORY_TO_SERVICE[category] || {
    slug: "general-repair",
    label: "Cleveland's Local Mechanic",
    pitch: "Free written estimate. 12-month parts / 90-day labor warranty. $10-down financing. Walk-ins welcome 7 days.",
  };
  return (
    <FadeIn>
      <div className="my-10 bg-gradient-to-br from-primary/[0.07] via-primary/[0.03] to-transparent border border-primary/30 rounded-2xl p-6 lg:p-7">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-primary font-bold mb-1">
              While you're here
            </div>
            <h3 className="font-semibold text-foreground text-lg leading-tight mb-2">
              Need {svc.label.toLowerCase()}? Read the rest later.
            </h3>
            <p className="text-foreground/65 text-sm leading-relaxed mb-4">
              {svc.pitch}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/booking?service=${encodeURIComponent(svc.slug)}`}
                className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-md font-semibold text-xs uppercase tracking-wider hover:opacity-90 transition-opacity"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Book {svc.label}
              </Link>
              <Link
                href={`/${svc.slug}`}
                className="inline-flex items-center gap-1.5 border border-primary/40 text-primary px-4 py-2 rounded-md font-semibold text-xs uppercase tracking-wider hover:bg-primary/10 transition-colors"
              >
                Learn more
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <a
                href={BUSINESS.phone.href}
                className="inline-flex items-center gap-1.5 text-foreground/55 px-3 py-2 text-xs font-semibold hover:text-primary transition-colors"
              >
                <Phone className="w-3.5 h-3.5" />
                {BUSINESS.phone.display}
              </a>
            </div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

/**
 * UpgradedBottomCTA — replaces the generic "Need this repair?" footer with
 * the same conversion frame used elsewhere: anchor (price), trust (warranty),
 * dual CTA, and a financing fallback. Category-aware copy.
 */
function UpgradedBottomCTA({ category }: { category: string }) {
  const svc = CATEGORY_TO_SERVICE[category] || {
    slug: "general-repair",
    label: "this repair",
    pitch: "Free written estimate before any work. 12-month parts / 90-day labor warranty.",
  };
  return (
    <div className="mt-12 bg-card border border-primary/30 rounded-2xl p-7 lg:p-9">
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-center">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-rose-500/40 bg-rose-500/5 text-rose-300 text-[10px] font-bold tracking-widest uppercase mb-3">
            <AlertTriangle className="w-3 h-3" />
            Don't postpone — it gets bigger
          </div>
          <h3 className="font-heading text-2xl lg:text-3xl font-bold text-foreground tracking-tight uppercase leading-tight mb-2">
            Bring it in. We'll show you the problem before we fix it.
          </h3>
          <p className="text-foreground/65 text-sm leading-relaxed">
            {svc.pitch} Free Uber within 5 miles if you drop off. Walk-ins welcome 7 days a week.
          </p>
          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-[13px] text-foreground/70">
            <li className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-primary" /> 12-mo parts / 90-day labor warranty</li>
            <li className="flex items-center gap-2"><CreditCard className="w-3.5 h-3.5 text-primary" /> $10-down financing available</li>
            <li className="flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-primary" /> Most repairs same/next day</li>
            <li className="flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5 text-primary" /> Text updates throughout</li>
          </ul>
        </div>
        <div className="space-y-2.5">
          <Link
            href={`/booking?service=${encodeURIComponent(svc.slug)}`}
            className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-4 rounded-md font-bold text-sm tracking-widest uppercase hover:opacity-90 transition-opacity"
          >
            <MessageSquare className="w-4 h-4" />
            Book {svc.label}
          </Link>
          <a
            href={BUSINESS.phone.href}
            className="w-full inline-flex items-center justify-center gap-2 border-2 border-foreground/25 text-foreground px-6 py-4 rounded-md font-bold text-sm tracking-widest uppercase hover:border-primary hover:text-primary transition-colors"
          >
            <Phone className="w-4 h-4" />
            Call {BUSINESS.phone.display}
          </a>
          <Link
            href="/financing"
            className="block text-center text-foreground/50 hover:text-primary text-[12px] uppercase tracking-wider font-semibold pt-2 transition-colors"
          >
            Or check $10-down financing →
          </Link>
        </div>
      </div>
    </div>
  );
}

// Shape used by the renderer. Both static and dynamic articles get normalized here.
type NormalizedArticle = Pick<
  BlogArticle,
  "slug" | "title" | "category" | "readTime" | "publishDate" | "excerpt" |
  "heroImage" | "metaTitle" | "metaDescription" | "tags" | "relatedServices" | "sections"
>;

/**
 * Safely parse a JSON string from the DB. Returns fallback if parse fails
 * or the result doesn't match the expected shape.
 */
function safeJsonArray<T>(raw: string | null | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Normalize a dynamic_articles row into the same shape as static BLOG_ARTICLES.
 * Handles both `{heading, body}` (old seed scripts) and `{heading, content}` (schema).
 */
function normalizeDynamic(row: {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  category: string;
  readTime: string;
  heroImage: string;
  excerpt: string;
  sectionsJson: string;
  relatedServicesJson: string;
  tagsJson: string;
  publishDate: string;
}): NormalizedArticle {
  const rawSections = safeJsonArray<{ heading?: string; content?: string; body?: string }>(
    row.sectionsJson,
    []
  );
  return {
    slug: row.slug,
    title: row.title,
    category: row.category,
    readTime: row.readTime,
    publishDate: row.publishDate,
    excerpt: row.excerpt,
    heroImage: row.heroImage,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    tags: safeJsonArray<string>(row.tagsJson, []),
    // Normalize relatedServices to start with `/` so they resolve as absolute
    // routes from any blog post path. Static BLOG_ARTICLES stores these with
    // leading slashes; dynamic seed scripts wrote without. This unifies both.
    relatedServices: safeJsonArray<string>(row.relatedServicesJson, []).map((s) =>
      s.startsWith("/") ? s : `/${s}`
    ),
    sections: rawSections.map((s) => ({
      heading: s.heading ?? "",
      // Support both shapes so older seeded rows still render.
      content: s.content ?? s.body ?? "",
    })),
  };
}

export default function BlogPost() {
  const [, params] = useRoute("/blog/:slug");
  const [, _setLocation] = useLocation();
  const slug = params?.slug || "";

  // Static first — zero-network, SSR-friendly.
  const staticArticle = getArticleBySlug(slug);

  // Dynamic fallback — only fires when static miss. Keeps payload small.
  const dynamicQuery = trpc.content.articleBySlug.useQuery(
    { slug },
    {
      enabled: !staticArticle && slug.length > 0,
      staleTime: 30 * 60 * 1000, // 30 min — blog posts rarely change
      retry: 1,
    }
  );

  // Unified article object. useMemo avoids re-normalizing on every re-render.
  const article: NormalizedArticle | null = useMemo(() => {
    if (staticArticle) return staticArticle;
    const row = dynamicQuery.data;
    if (!row) return null;
    return normalizeDynamic(row);
  }, [staticArticle, dynamicQuery.data]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  // Loading state — also covers `isFetching` so we don't briefly flash 404
  // while the query is in its initial fetch window (`enabled` just flipped
  // true, isLoading is false but data hasn't returned yet).
  if (!article && (dynamicQuery.isLoading || dynamicQuery.isFetching)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-foreground/50 text-sm font-mono tracking-wide">LOADING ARTICLE...</div>
        </div>
      </div>
    );
  }

  // 404 — neither static nor dynamic found this slug.
  if (!article) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-bold text-4xl text-foreground mb-4">ARTICLE NOT FOUND</h1>
          <p className="text-foreground/60 mb-8">The article you are looking for does not exist.</p>
          <Link href="/blog" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-bold text-sm tracking-wide">
            <ArrowLeft className="w-4 h-4" />
            BACK TO BLOG
          </Link>
        </div>
      </div>
    );
  }

  // Related articles — pull from static registry. Keeps cross-linking predictable
  // and ensures the reader is nudged toward hand-tuned content.
  const related = BLOG_ARTICLES.filter(a => a.slug !== article.slug && a.category === article.category).slice(0, 2);
  const moreRelated = related.length < 2
    ? [...related, ...BLOG_ARTICLES.filter(a => a.slug !== article.slug && a.category !== article.category).slice(0, 2 - related.length)]
    : related;

  // JSON-LD Article schema — tells Google this is a news/blog article with proper
  // metadata (author, publisher, dates). Big factor in rich-result eligibility.
  //
  // `image` MUST be an absolute URL per Google's Article schema spec. Static
  // articles use CloudFront URLs (already absolute), but dynamic articles
  // could store a relative path — prefix with the canonical origin in that
  // case so the rich result doesn't get dropped.
  const heroImageAbsolute = /^https?:\/\//.test(article.heroImage)
    ? article.heroImage
    : `https://nickstire.org${article.heroImage.startsWith("/") ? "" : "/"}${article.heroImage}`;

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.metaDescription,
    image: heroImageAbsolute,
    datePublished: article.publishDate,
    dateModified: article.publishDate,
    author: {
      "@type": "Organization",
      name: "Nick's Tire & Auto",
      url: "https://nickstire.org",
    },
    publisher: {
      "@type": "Organization",
      name: "Nick's Tire & Auto",
      url: "https://nickstire.org",
      logo: {
        "@type": "ImageObject",
        url: `${BUSINESS.urls.website}/icon-512x512.png`,
      },
      address: {
        "@type": "PostalAddress",
        streetAddress: BUSINESS.address.street,
        addressLocality: "Cleveland",
        addressRegion: "OH",
        postalCode: "44112",
      },
      sameAs: [...BUSINESS.sameAs],
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://nickstire.org/blog/${article.slug}`,
    },
    articleSection: article.category,
    keywords: article.tags.join(", "),
  };

  // BreadcrumbList schema — helps Google show the breadcrumb trail in SERPs,
  // which boosts click-through rate and signals site structure.
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://nickstire.org/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: "https://nickstire.org/blog",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: article.title,
        item: `https://nickstire.org/blog/${article.slug}`,
      },
    ],
  };

  return (
    <PageLayout activeHref="/blog" showChat={true}>
      <SEOHead
        title={article.metaTitle}
        description={article.metaDescription}
        canonicalPath={`/blog/${article.slug}`}
        ogImage={article.heroImage}
      />
      <Breadcrumbs items={[{ label: "Blog", href: "/blog" }, { label: "Article" }]} />


      {/* JSON-LD — Article + BreadcrumbList. Two separate script tags is preferred
          over combining into @graph; Google parses both reliably. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* Hero */}
      <section className="relative min-h-[50vh] lg:min-h-[60vh] flex items-end overflow-hidden">
        <div className="absolute inset-0">
          {/* LCP fix · article hero */}
          <img loading="eager" fetchPriority="high" decoding="async" width="1600" height="900" src={article.heroImage} alt={`${article.title} — auto repair guide from Nick's Tire & Auto Cleveland`} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
        </div>

        <div className="relative container pb-16 pt-32 lg:pb-20">
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <Link href="/" className="text-[12px] text-foreground/50 hover:text-primary transition-colors">Home</Link>
              <ChevronRight className="w-3 h-3 text-foreground/30" />
              <Link href="/blog" className="text-[12px] text-foreground/50 hover:text-primary transition-colors">Blog</Link>
              <ChevronRight className="w-3 h-3 text-foreground/30" />
              <span className="text-[12px] text-primary">{article.category}</span>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="flex items-center gap-4 mb-4">
              <span className="text-[13px] text-primary tracking-wide">{article.category}</span>
              <span className="text-foreground/20">|</span>
              <span className="text-[13px] text-foreground/50 flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {article.readTime}
              </span>
              <span className="text-foreground/20">|</span>
              <span className="text-[13px] text-foreground/50">
                {new Date(article.publishDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </span>
            </div>
            <h1 className="font-bold text-3xl sm:text-4xl lg:text-6xl text-foreground leading-[0.95] tracking-tight max-w-4xl">
              {article.title.toUpperCase()}
            </h1>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="mt-6 text-lg text-foreground/70 max-w-2xl leading-relaxed">
              {article.excerpt}
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Article Content — 2-column on lg with sticky TOC sidebar */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10 max-w-5xl mx-auto">
            {/* Left rail — sticky TOC (auto-hides under 3 sections) */}
            <aside>
              <TableOfContents sections={article.sections} />
            </aside>

            {/* Article body */}
            <div className="max-w-3xl">
              {article.sections.map((section, i) => (
                <FadeIn key={i} delay={i * 0.05}>
                  <div className="mb-12">
                    <h2
                      id={slugify(section.heading)}
                      className="font-bold text-2xl lg:text-3xl text-foreground tracking-[-0.01em] mb-4 scroll-mt-24"
                    >
                      {section.heading}
                    </h2>
                    <p className="text-foreground/70 text-lg leading-relaxed">
                      {section.content}
                    </p>
                  </div>

                  {/* Mid-article CTA after 2nd section, only on posts with 4+ sections */}
                  {i === 1 && article.sections.length >= 4 && (
                    <MidArticleCTA category={article.category} />
                  )}
                </FadeIn>
              ))}

              {/* 2026-05-06 wave-38 · Pillar callout — auto-cross-link
                  every supporting article to its corresponding pillar.
                  Sits after article body + before Tags so it reads as
                  natural editorial flow ("liked this? here's the full
                  guide") rather than an ad. Suppresses on the pillar
                  itself. Activates the hub-and-spoke topology built
                  in waves 35-37. */}
              <PillarCallout category={article.category} currentSlug={article.slug} />

              {/* Tags */}
              {article.tags.length > 0 && (
                <FadeIn>
                  <div className="border-t border-border/30 pt-8 mt-12">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Tag className="w-4 h-4 text-foreground/40" />
                      {article.tags.map(tag => (
                        <span key={tag} className="px-3 py-1 bg-card border border-border/30 text-[12px] text-foreground/50">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </FadeIn>
              )}

              {/* Related Service Links */}
              {article.relatedServices.length > 0 && (
                <FadeIn>
                  <div className="mt-8 bg-card border border-primary/20 p-6">
                    <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] mb-3">RELATED SERVICES</h3>
                    <div className="flex flex-wrap gap-3">
                      {article.relatedServices.map(svc => (
                        <Link
                          key={svc}
                          href={svc}
                          className="inline-flex items-center gap-2 bg-primary/10 border border-primary/30 text-primary px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/20 transition-colors"
                        >
                          {/* Strip leading slash + replace ALL hyphens with spaces.
                              Was `.replace("-", " ")` which only replaced the FIRST
                              hyphen — `/synthetic-oil-change` rendered as
                              "synthetic oil-change", `/pre-purchase-inspection` as
                              "pre purchase-inspection". */}
                          {svc.replace(/^\//, "").replace(/-/g, " ")}
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      ))}
                    </div>
                  </div>
                </FadeIn>
              )}

              {/* Upgraded bottom CTA — anchor + trust + dual button + financing */}
              <FadeIn>
                <UpgradedBottomCTA category={article.category} />
              </FadeIn>
            </div>
          </div>
        </div>
      </section>

      {/* Related Articles */}
      {moreRelated.length > 0 && (
        <section className="bg-[oklch(0.055_0.004_260)] py-16 border-t border-border/30">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Keep Reading</span>
              <h2 className="font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-10">
                MORE TIPS
              </h2>
            </FadeIn>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {moreRelated.map((rel, i) => (
                <FadeIn key={rel.slug} delay={i * 0.1}>
                  <Link href={`/blog/${rel.slug}`} className="group block bg-card border border-border/30 overflow-hidden hover:border-primary/30 transition-colors">
                    <div className="aspect-[16/9] overflow-hidden">
                      <img
                        src={rel.heroImage}
                        alt={rel.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                    <div className="p-6">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-[12px] text-primary tracking-wide">{rel.category}</span>
                        <span className="text-[12px] text-foreground/40 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {rel.readTime}
                        </span>
                      </div>
                      <h3 className="font-bold text-lg text-foreground tracking-wider group-hover:text-primary transition-colors leading-tight">
                        {rel.title}
                      </h3>
                    </div>
                  </Link>
                </FadeIn>
              ))}
            </div>

            <FadeIn delay={0.2}>
              <div className="mt-8 text-center">
                <Link href="/blog" className="inline-flex items-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors">
                  VIEW ALL ARTICLES
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>
      )}

    </PageLayout>
  );
}
