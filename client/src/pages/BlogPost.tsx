/*
 * BLOG POST — Individual article page for Nick's Tire & Auto
 * SEO-optimized with JSON-LD Article schema markup
 */

import { useRef, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { getArticleBySlug, BLOG_ARTICLES } from "@shared/blog";
import NotificationBar from "@/components/NotificationBar";
import { SEOHead, Breadcrumbs, SkipToContent, trackPhoneClick } from "@/components/SEO";
import { Phone, Clock, ChevronRight, ArrowLeft, ArrowRight, Tag, Menu, X, MapPin } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { useState } from "react";

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

function PostNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed ${scrolled ? "top-0" : "top-[40px]"} left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-nick-dark/95 backdrop-blur-md shadow-lg" : "bg-transparent"}`}>
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
          <Link href="/blog" className="flex items-center gap-1 font-heading text-sm tracking-widest uppercase text-foreground/60 hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
            All Articles
          </Link>
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
            <Link href="/blog" onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors py-2">
              All Articles
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

export default function BlogPost() {
  const [, params] = useRoute("/blog/:slug");
  const [, setLocation] = useLocation();
  const slug = params?.slug || "";
  const article = getArticleBySlug(slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  // 404 for unknown articles
  if (!article) {
    return (
      <div className="min-h-screen bg-nick-dark flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-heading font-bold text-4xl text-foreground mb-4">ARTICLE NOT FOUND</h1>
          <p className="text-foreground/60 mb-8">The article you are looking for does not exist.</p>
          <Link href="/blog" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-heading font-bold text-sm tracking-wider uppercase">
            <ArrowLeft className="w-4 h-4" />
            BACK TO BLOG
          </Link>
        </div>
      </div>
    );
  }

  // Get related articles (same category, different slug)
  const related = BLOG_ARTICLES.filter(a => a.slug !== article.slug && a.category === article.category).slice(0, 2);
  // If not enough same-category, fill with others
  const moreRelated = related.length < 2
    ? [...related, ...BLOG_ARTICLES.filter(a => a.slug !== article.slug && a.category !== article.category).slice(0, 2 - related.length)]
    : related;

  // JSON-LD Article schema
  const jsonLd = {
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
        streetAddress: "17625 Euclid Ave",
        addressLocality: "Cleveland",
        addressRegion: "OH",
        postalCode: "44112",
      },
    },
  };

  return (
    <div className="min-h-screen flex flex-col bg-nick-dark">
      <SEOHead
        title={article.metaTitle}
        description={article.metaDescription}
        canonicalPath={`/blog/${article.slug}`}
        ogImage={article.heroImage}
      />
      <SkipToContent />
      <NotificationBar />
      <PostNavbar />

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="relative min-h-[50vh] lg:min-h-[60vh] flex items-end overflow-hidden">
        <div className="absolute inset-0">
          <img src={article.heroImage} alt={article.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-nick-dark via-nick-dark/80 to-nick-dark/40" />
        </div>

        <div className="relative container pb-16 pt-32 lg:pb-20">
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <Link href="/" className="font-mono text-xs text-foreground/50 hover:text-primary transition-colors">Home</Link>
              <ChevronRight className="w-3 h-3 text-foreground/30" />
              <Link href="/blog" className="font-mono text-xs text-foreground/50 hover:text-primary transition-colors">Blog</Link>
              <ChevronRight className="w-3 h-3 text-foreground/30" />
              <span className="font-mono text-xs text-primary">{article.category}</span>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="flex items-center gap-4 mb-4">
              <span className="font-mono text-sm text-primary tracking-widest uppercase">{article.category}</span>
              <span className="text-foreground/20">|</span>
              <span className="font-mono text-sm text-foreground/50 flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {article.readTime}
              </span>
              <span className="text-foreground/20">|</span>
              <span className="font-mono text-sm text-foreground/50">
                {new Date(article.publishDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </span>
            </div>
            <h1 className="font-heading font-bold text-3xl sm:text-4xl lg:text-6xl text-foreground leading-[0.95] tracking-tight max-w-4xl">
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
      <section className="section-dark py-16 lg:py-20">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            {article.sections.map((section, i) => (
              <FadeIn key={i} delay={i * 0.05}>
                <div className="mb-12">
                  <h2 className="font-heading font-bold text-2xl lg:text-3xl text-foreground tracking-wider mb-4">
                    {section.heading}
                  </h2>
                  <p className="text-foreground/70 text-lg leading-relaxed">
                    {section.content}
                  </p>
                </div>
              </FadeIn>
            ))}

            {/* Tags */}
            <FadeIn>
              <div className="border-t border-border/30 pt-8 mt-12">
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag className="w-4 h-4 text-foreground/40" />
                  {article.tags.map(tag => (
                    <span key={tag} className="px-3 py-1 bg-card border border-border/30 font-mono text-xs text-foreground/50">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </FadeIn>

            {/* Related Service Links */}
            {article.relatedServices.length > 0 && (
              <FadeIn>
                <div className="mt-8 bg-card border border-primary/20 p-6">
                  <h3 className="font-heading font-bold text-lg text-foreground tracking-wider mb-3">RELATED SERVICES</h3>
                  <div className="flex flex-wrap gap-3">
                    {article.relatedServices.map(svc => (
                      <Link
                        key={svc}
                        href={svc}
                        className="inline-flex items-center gap-2 bg-primary/10 border border-primary/30 text-primary px-4 py-2 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/20 transition-colors"
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
                <h3 className="font-heading font-bold text-2xl text-foreground tracking-wider mb-3">
                  NEED THIS REPAIR?
                </h3>
                <p className="text-foreground/60 mb-6">
                  Our technicians are ready to help. Call or book online for an appointment.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <a href="tel:2168620005" className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors">
                    <Phone className="w-4 h-4" />
                    CALL (216) 862-0005
                  </a>
                  <Link href="/#contact" className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase hover:border-primary hover:text-primary transition-colors">
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
        <section className="section-darker py-16 border-t border-border/30">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-widest uppercase">Keep Reading</span>
              <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-10">
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
                        <span className="font-mono text-xs text-primary tracking-wider uppercase">{rel.category}</span>
                        <span className="font-mono text-xs text-foreground/40 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {rel.readTime}
                        </span>
                      </div>
                      <h3 className="font-heading font-bold text-lg text-foreground tracking-wider group-hover:text-primary transition-colors leading-tight">
                        {rel.title}
                      </h3>
                    </div>
                  </Link>
                </FadeIn>
              ))}
            </div>

            <FadeIn delay={0.2}>
              <div className="mt-8 text-center">
                <Link href="/blog" className="inline-flex items-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase hover:border-primary hover:text-primary transition-colors">
                  VIEW ALL ARTICLES
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>
      )}

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
