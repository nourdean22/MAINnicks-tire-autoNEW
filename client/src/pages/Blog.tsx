/*
 * BLOG / TIPS — SEO content hub for Nick's Tire & Auto
 * Lists all maintenance articles with category filtering
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useRef } from "react";
import { Link } from "wouter";
import { BLOG_ARTICLES } from "@shared/blog";
import { SEOHead, Breadcrumbs, SkipToContent, trackPhoneClick } from "@/components/SEO";
import { Phone, Clock, ChevronRight, ArrowRight, Menu, X, MapPin } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { useState, useEffect } from "react";

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

// Get unique categories
const categories = ["All", ...Array.from(new Set(BLOG_ARTICLES.map(a => a.category)))];

export default function Blog() {
  const [activeCategory, setActiveCategory] = useState("All");

  const filtered = activeCategory === "All"
    ? BLOG_ARTICLES
    : BLOG_ARTICLES.filter(a => a.category === activeCategory);

  return (
    <PageLayout activeHref="/blog" showChat={true}>
      <SEOHead
        title="Auto Repair Tips & Maintenance Blog | Nick's Tire & Auto Cleveland"
        description="Expert auto repair tips, maintenance guides, and car care advice from Nick's Tire & Auto in Cleveland. Learn about brakes, tires, diagnostics, emissions, and more."
        canonicalPath="/blog"
      />
      
      
      

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-20 section-darker">
        <div className="container">
          <FadeIn>
            <Breadcrumbs items={[{ label: "Blog & Tips" }]} />
          </FadeIn>

          <FadeIn delay={0.1}>
            <span className="font-mono text-nick-blue-light text-sm tracking-wide">Mechanic Tips & Advice</span>
            <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground mt-3 tracking-tight leading-[0.9]">
              AUTO REPAIR<br />
              <span className="text-gradient-yellow">TIPS & BLOG</span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="mt-6 text-lg text-foreground/70 max-w-2xl leading-relaxed">
              Helpful maintenance advice from our technicians. We explain common car problems in plain language so you know what to expect when something goes wrong.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Category Filter */}
      <section className="section-dark border-b border-nick-blue/10 sticky top-16 lg:top-20 z-40 backdrop-blur-md bg-nick-dark/95">
        <div className="container py-4">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 font-mono text-xs tracking-wider uppercase whitespace-nowrap rounded-md transition-colors ${
                  activeCategory === cat
                    ? "bg-nick-yellow text-nick-dark font-bold"
                    : "bg-card/80 border border-nick-blue/15 text-foreground/60 hover:text-nick-yellow hover:border-nick-yellow/30"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Articles Grid */}
      <section className="section-dark py-16 lg:py-20 flex-1">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((article, i) => (
              <FadeIn key={article.slug} delay={i * 0.08}>
                <Link href={`/blog/${article.slug}`} className="group block card-vibrant bg-card/80 rounded-lg overflow-hidden h-full">
                  <div className="aspect-[16/9] overflow-hidden">
                    <img
                      src={article.heroImage}
                      alt={article.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="font-mono text-xs text-nick-blue-light tracking-wider uppercase">{article.category}</span>
                      <span className="text-foreground/20">|</span>
                      <span className="font-mono text-xs text-foreground/40 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {article.readTime}
                      </span>
                    </div>
                    <h2 className="font-semibold font-bold text-xl text-foreground tracking-wider group-hover:text-nick-yellow transition-colors mb-3 leading-tight">
                      {article.title}
                    </h2>
                    <p className="text-foreground/60 text-sm leading-relaxed line-clamp-3">
                      {article.excerpt}
                    </p>
                    <div className="mt-4 flex items-center gap-2 text-nick-yellow font-semibold font-bold text-xs tracking-wider uppercase">
                      READ MORE
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </Link>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="section-darker py-16 border-t border-nick-blue/10">
        
        <div className="container text-center pt-12">
          <FadeIn>
            <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground tracking-tight mb-4">
              NEED A REPAIR?
            </h2>
            <p className="text-foreground/60 text-lg mb-8 max-w-xl mx-auto">
              If something does not feel right with your vehicle, bring it in. We will diagnose the problem and explain your options.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href="tel:2168620005" className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors">
                <Phone className="w-5 h-5" />
                CALL NOW
              </a>
              <Link href="/#contact" className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wider uppercase hover:bg-nick-blue/10 hover:border-nick-blue transition-colors">
                BOOK ONLINE
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Mini Footer */}
      
      <InternalLinks title="Our Services" />
    </PageLayout>
  );
}
