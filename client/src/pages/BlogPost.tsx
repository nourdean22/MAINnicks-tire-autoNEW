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
import { useRef, useEffect, useMemo } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { getArticleBySlug, BLOG_ARTICLES, type BlogArticle } from "@shared/blog";
import { trpc } from "@/lib/trpc";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Phone, Clock, ChevronRight, ArrowLeft, ArrowRight, Tag } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";

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

  // Loading state — only shows if tRPC query is in flight (static hit renders instantly).
  if (!article && dynamicQuery.isLoading) {
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
          <h1 className="font-semibold font-bold text-4xl text-foreground mb-4">ARTICLE NOT FOUND</h1>
          <p className="text-foreground/60 mb-8">The article you are looking for does not exist.</p>
          <Link href="/blog" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-semibold font-bold text-sm tracking-wide">
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
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.metaDescription,
    image: article.heroImage,
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
        url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp",
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
          <img loading="lazy" src={article.heroImage} alt={article.title} className="w-full h-full object-cover" />
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
            <h1 className="font-semibold font-bold text-3xl sm:text-4xl lg:text-6xl text-foreground leading-[0.95] tracking-tight max-w-4xl">
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

      {/* Article Content */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            {article.sections.map((section, i) => (
              <FadeIn key={i} delay={i * 0.05}>
                <div className="mb-12">
                  <h2 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground tracking-[-0.01em] mb-4">
                    {section.heading}
                  </h2>
                  <p className="text-foreground/70 text-lg leading-relaxed">
                    {section.content}
                  </p>
                </div>
              </FadeIn>
            ))}

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
                  <h3 className="font-semibold font-bold text-lg text-foreground tracking-[-0.01em] mb-3">RELATED SERVICES</h3>
                  <div className="flex flex-wrap gap-3">
                    {article.relatedServices.map(svc => (
                      <Link
                        key={svc}
                        href={svc}
                        className="inline-flex items-center gap-2 bg-primary/10 border border-primary/30 text-primary px-4 py-2 font-semibold font-bold text-xs tracking-wide hover:bg-primary/20 transition-colors"
                      >
                        {svc.replace("/", "").replace("-", " ")}
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    ))}
                  </div>
                </div>
              </FadeIn>
            )}

            {/* CTA */}
            <FadeIn>
              <div className="mt-12 bg-primary/10 border border-primary/30 p-8 text-center">
                <h3 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-3">
                  NEED THIS REPAIR?
                </h3>
                <p className="text-foreground/60 mb-6">
                  Our technicians are ready to help. Call or schedule a drop-off online.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <a href={BUSINESS.phone.href} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-semibold font-bold text-sm tracking-wide hover:bg-primary/90 transition-colors">
                    <Phone className="w-4 h-4" />
                    CALL {BUSINESS.phone.display}
                  </a>
                  <Link href="/booking" className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors">
                    BOOK ONLINE
                  </Link>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Related Articles */}
      {moreRelated.length > 0 && (
        <section className="bg-[oklch(0.055_0.004_260)] py-16 border-t border-border/30">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Keep Reading</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-10">
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
                      <h3 className="font-semibold font-bold text-lg text-foreground tracking-wider group-hover:text-primary transition-colors leading-tight">
                        {rel.title}
                      </h3>
                    </div>
                  </Link>
                </FadeIn>
              ))}
            </div>

            <FadeIn delay={0.2}>
              <div className="mt-8 text-center">
                <Link href="/blog" className="inline-flex items-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors">
                  VIEW ALL ARTICLES
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>
      )}

      <InternalLinks />
</PageLayout>
  );
}
