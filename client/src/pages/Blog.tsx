/*
 * BLOG / TIPS — SEO content hub for Nick's Tire & Auto
 * Lists all maintenance articles with category filtering
 */

import { useRef } from "react";
import { Link } from "wouter";
import { BLOG_ARTICLES } from "@shared/blog";
import NotificationBar from "@/components/NotificationBar";
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

function BlogNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed ${scrolled ? "top-0" : "top-[40px]"} left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-nick-dark/95 backdrop-blur-md shadow-lg" : "bg-nick-dark/80 backdrop-blur-sm"}`}>
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-sm">
            <span className="font-heading font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-muted-foreground text-xs tracking-widest uppercase">Cleveland, Ohio</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6">
          <Link href="/" className="font-heading text-sm tracking-widest uppercase text-foreground/60 hover:text-primary transition-colors">
            Home
          </Link>
          <Link href="/#services" className="font-heading text-sm tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors">
            Services
          </Link>
          <span className="font-heading text-sm tracking-widest uppercase text-primary">
            Blog
          </span>
          <a href="tel:2168620005" className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors">
            <Phone className="w-4 h-4" />
            (216) 862-0005
          </a>
        </div>

        <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden text-foreground p-2">
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden bg-nick-dark/98 backdrop-blur-md border-t border-border">
          <div className="container py-6 flex flex-col gap-4">
            <Link href="/" onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors py-2">
              Home
            </Link>
            <Link href="/#services" onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors py-2">
              Services
            </Link>
            <a href="tel:2168620005" className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 font-heading font-bold text-sm tracking-wider uppercase mt-2">
              <Phone className="w-4 h-4" />
              (216) 862-0005
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

// Get unique categories
const categories = ["All", ...Array.from(new Set(BLOG_ARTICLES.map(a => a.category)))];

export default function Blog() {
  const [activeCategory, setActiveCategory] = useState("All");

  const filtered = activeCategory === "All"
    ? BLOG_ARTICLES
    : BLOG_ARTICLES.filter(a => a.category === activeCategory);

  // Set page title
  useEffect(() => {
    document.title = "Auto Repair Tips & Maintenance Blog | Nick's Tire & Auto Cleveland";
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-nick-dark">
      <NotificationBar />
      <BlogNavbar />

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-20 section-darker">
        <div className="container">
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <Link href="/" className="font-mono text-xs text-foreground/50 hover:text-primary transition-colors">
                Home
              </Link>
              <ChevronRight className="w-3 h-3 text-foreground/30" />
              <span className="font-mono text-xs text-primary">Blog & Tips</span>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <span className="font-mono text-primary text-sm tracking-widest uppercase">Mechanic Tips & Advice</span>
            <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground mt-3 tracking-tight leading-[0.9]">
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
      <section className="section-dark border-b border-border/30 sticky top-16 lg:top-20 z-40 backdrop-blur-md bg-nick-dark/95">
        <div className="container py-4">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 font-mono text-xs tracking-wider uppercase whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
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
                <Link href={`/blog/${article.slug}`} className="group block bg-card border border-border/30 overflow-hidden hover:border-primary/30 transition-colors h-full">
                  <div className="aspect-[16/9] overflow-hidden">
                    <img
                      src={article.heroImage}
                      alt={article.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="font-mono text-xs text-primary tracking-wider uppercase">{article.category}</span>
                      <span className="text-foreground/20">|</span>
                      <span className="font-mono text-xs text-foreground/40 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {article.readTime}
                      </span>
                    </div>
                    <h2 className="font-heading font-bold text-xl text-foreground tracking-wider group-hover:text-primary transition-colors mb-3 leading-tight">
                      {article.title}
                    </h2>
                    <p className="text-foreground/60 text-sm leading-relaxed line-clamp-3">
                      {article.excerpt}
                    </p>
                    <div className="mt-4 flex items-center gap-2 text-primary font-heading font-bold text-xs tracking-wider uppercase">
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
      <section className="section-darker py-16 border-t border-border/30">
        <div className="container text-center">
          <FadeIn>
            <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground tracking-tight mb-4">
              NEED A REPAIR?
            </h2>
            <p className="text-foreground/60 text-lg mb-8 max-w-xl mx-auto">
              If something does not feel right with your vehicle, bring it in. We will diagnose the problem and explain your options.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href="tel:2168620005" className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:bg-primary/90 transition-colors">
                <Phone className="w-5 h-5" />
                CALL NOW
              </a>
              <Link href="/#contact" className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:border-primary hover:text-primary transition-colors">
                BOOK ONLINE
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Mini Footer */}
      <footer className="section-dark border-t border-border/30 py-8">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm">
              <span className="font-heading font-bold text-primary-foreground text-sm">N</span>
            </div>
            <span className="font-heading font-bold text-primary tracking-wider text-sm">NICK'S TIRE & AUTO</span>
          </div>
          <div className="flex items-center gap-4 text-foreground/40 text-xs font-mono">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> 17625 Euclid Ave, Cleveland, OH</span>
            <a href="tel:2168620005" className="hover:text-primary transition-colors">(216) 862-0005</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
