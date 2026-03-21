/*
 * BLOG POST — Individual article page for Nick's Tire & Auto
 * SEO-optimized with JSON-LD Article schema markup
 */

import PageLayout from "@/components/PageLayout";
import { useRef, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { getArticleBySlug, BLOG_ARTICLES } from "@shared/blog";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Phone, Clock, ChevronRight, ArrowLeft, ArrowRight, Tag } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import FadeIn from "@/components/FadeIn";

export default function BlogPost() {
  const [, params] = useRoute("/blog/:slug");
  const [, _setLocation] = useLocation();
  const slug = params?.slug || "";
  const article = getArticleBySlug(slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  // 404 for unknown articles
  if (!article) {
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
        streetAddress: BUSINESS.address.street,
        addressLocality: "Cleveland",
        addressRegion: "OH",
        postalCode: "44112",
      },
      sameAs: [...BUSINESS.sameAs],
    },
  };

}
