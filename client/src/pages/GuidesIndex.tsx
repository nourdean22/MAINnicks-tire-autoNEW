/*
 * GUIDES INDEX — Listing page for all guides at /guides
 * Organized by category with search + filter
 */

import PageLayout from "@/components/PageLayout";
import { useRef, useState, useMemo } from "react";
import { Link } from "wouter";
import { GUIDES, GUIDE_CATEGORY_LABELS, type GuideCategory } from "@shared/guides";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Search, BookOpen, ChevronRight } from "lucide-react";
import { motion, useInView } from "framer-motion";
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

const ALL_CATEGORIES: GuideCategory[] = [
  "tire-guide",
  "maintenance",
  "cleveland-local",
  "cost-guide",
  "safety",
  "buying-guide",
];

export default function GuidesIndex() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<GuideCategory | "all">("all");

  const filtered = useMemo(() => {
    let result = GUIDES;
    if (activeCategory !== "all") {
      result = result.filter(g => g.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(g =>
        g.title.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [search, activeCategory]);

  // Group by category for display when showing all
  const grouped = useMemo(() => {
    if (activeCategory !== "all") return null;
    const map = new Map<GuideCategory, typeof GUIDES>();
    for (const guide of filtered) {
      const arr = map.get(guide.category) || [];
      arr.push(guide);
      map.set(guide.category, arr);
    }
    return map;
  }, [filtered, activeCategory]);

  // JSON-LD
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Auto Repair Guides | Nick's Tire & Auto",
    description: "Expert auto repair guides from Cleveland's trusted mechanics. Tire guides, maintenance tips, cost guides, and local Cleveland advice.",
    url: "https://nickstire.org/guides",
  };

  return (
    <PageLayout activeHref="/guides" showChat={true}>
      <SEOHead
        title="Auto Repair Guides | Nick's Tire & Auto Cleveland"
        description="Expert auto repair guides from Cleveland's trusted mechanics. Tire guides, maintenance tips, cost breakdowns, and local Cleveland advice for every vehicle owner."
        canonicalPath="/guides"
      />
      <Breadcrumbs items={[{ label: "Guides" }]} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-24">
        <div className="container">
          <FadeIn>
            <span className="font-mono text-primary text-sm tracking-wide">Expert Knowledge</span>
            <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-6xl text-foreground mt-3 tracking-tight leading-[0.95]">
              AUTO REPAIR GUIDES
            </h1>
            <p className="mt-6 text-lg text-foreground/70 max-w-2xl leading-relaxed">
              Honest, mechanic-grade guides written by Cleveland's trusted auto repair team. Everything you need to know about tires, maintenance, costs, and car care.
            </p>
          </FadeIn>

          {/* Search + Filter */}
          <FadeIn delay={0.1}>
            <div className="mt-10 flex flex-col gap-4">
              {/* Search bar */}
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/30" />
                <input
                  type="text"
                  placeholder="Search guides..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-card border border-border/30 text-foreground text-sm placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              {/* Category filters */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setActiveCategory("all")}
                  className={`px-4 py-2 text-xs font-semibold tracking-wide border transition-colors ${
                    activeCategory === "all"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border/30 text-foreground/50 hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  ALL ({GUIDES.length})
                </button>
                {ALL_CATEGORIES.map(cat => {
                  const count = GUIDES.filter(g => g.category === cat).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`px-4 py-2 text-xs font-semibold tracking-wide border transition-colors ${
                        activeCategory === cat
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border/30 text-foreground/50 hover:border-primary/30 hover:text-foreground"
                      }`}
                    >
                      {GUIDE_CATEGORY_LABELS[cat].toUpperCase()} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Guide listings */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container">
          {filtered.length === 0 && (
            <FadeIn>
              <div className="text-center py-16">
                <p className="text-foreground/50 text-lg">No guides match your search. Try a different term.</p>
              </div>
            </FadeIn>
          )}

          {/* Grouped by category view */}
          {grouped && activeCategory === "all" && filtered.length > 0 && (
            <>
              {ALL_CATEGORIES.map(cat => {
                const guides = grouped.get(cat);
                if (!guides || guides.length === 0) return null;
                return (
                  <div key={cat} className="mb-16 last:mb-0">
                    <FadeIn>
                      <h2 className="font-semibold font-bold text-2xl text-foreground tracking-tight mb-6 flex items-center gap-3">
                        <BookOpen className="w-5 h-5 text-primary" />
                        {GUIDE_CATEGORY_LABELS[cat].toUpperCase()}
                      </h2>
                    </FadeIn>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {guides.map((guide, i) => (
                        <FadeIn key={guide.slug} delay={i * 0.05}>
                          <Link
                            href={`/guides/${guide.slug}`}
                            className="group flex items-start justify-between p-5 bg-card border border-border/30 hover:border-primary/30 transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors leading-tight line-clamp-2">
                                {guide.title.replace(/ \| Nick.*$/, "")}
                              </h3>
                              <p className="mt-1.5 text-xs text-foreground/40 line-clamp-2">
                                {guide.description}
                              </p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-foreground/20 group-hover:text-primary shrink-0 ml-3 mt-0.5 transition-colors" />
                          </Link>
                        </FadeIn>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Flat filtered view */}
          {activeCategory !== "all" && filtered.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((guide, i) => (
                <FadeIn key={guide.slug} delay={i * 0.05}>
                  <Link
                    href={`/guides/${guide.slug}`}
                    className="group flex items-start justify-between p-5 bg-card border border-border/30 hover:border-primary/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="w-3 h-3 text-primary" />
                        <span className="text-[11px] text-primary tracking-wide">
                          {GUIDE_CATEGORY_LABELS[guide.category]}
                        </span>
                      </div>
                      <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors leading-tight line-clamp-2">
                        {guide.title.replace(/ \| Nick.*$/, "")}
                      </h3>
                      <p className="mt-1.5 text-xs text-foreground/40 line-clamp-2">
                        {guide.description}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-foreground/20 group-hover:text-primary shrink-0 ml-3 mt-0.5 transition-colors" />
                  </Link>
                </FadeIn>
              ))}
            </div>
          )}
        </div>
      </section>

      <InternalLinks />
    </PageLayout>
  );
}
