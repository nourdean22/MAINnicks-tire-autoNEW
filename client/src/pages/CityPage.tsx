/**
 * CityPage — City-specific landing pages for local SEO
 * Targets "[service] near [city]" search queries to capture suburb traffic
 */

import PageLayout from "@/components/PageLayout";
import { useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { CITIES, type CityData } from "@shared/cities";
import { SERVICES } from "@shared/services";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import BookingForm from "@/components/BookingForm";
import { Phone, MapPin, Star, ChevronRight, ArrowLeft, Navigation, CheckCircle, Menu, X } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { useState } from "react";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import FadeIn from "@/components/FadeIn";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

// ─── NAVBAR ───────────────────────────────────────────
function CityNavbar({ city }: { city: CityData }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
  }, []);


// ─── CITY SCHEMA ──────────────────────────────────────
function CitySchema({ city }: { city: CityData }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: `Nick's Tire & Auto — Serving ${city.name}`,
    description: city.metaDescription,
    url: `https://nickstire.org/${city.slug}`,
    telephone: `+1-${BUSINESS.phone.dashed}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address.street,
      addressLocality: "Cleveland",
      addressRegion: "OH",
      postalCode: "44112",
      addressCountry: "US",
    },
    areaServed: {
      "@type": "City",
      name: city.name,
      containedInPlace: {
        "@type": "State",
        name: "Ohio",
      },
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: String(BUSINESS.reviews.rating),
      reviewCount: String(BUSINESS.reviews.count),
    },
    hasMap: BUSINESS.urls.googleBusiness,
    sameAs: [...BUSINESS.sameAs],
  };

// ─── MAIN PAGE ────────────────────────────────────────
export default function CityPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";
  const city = CITIES.find((c) => c.slug === slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!city) {
  }

  const topServices = SERVICES.slice(0, 6);

