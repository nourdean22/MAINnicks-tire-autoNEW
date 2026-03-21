/**
 * SeasonalPage — Seasonal car care landing pages for time-sensitive local SEO
 * Targets queries like "winter tires Cleveland" and "summer AC repair Cleveland"
 */

import PageLayout from "@/components/PageLayout";
import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { SEASONAL_PAGES } from "@shared/seasonal";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import BookingForm from "@/components/BookingForm";
import { Phone, ChevronRight, ArrowLeft, Snowflake, Sun, CheckCircle, AlertTriangle, Wrench, Menu, X } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

// ─── NAVBAR ───────────────────────────────────────────
function SeasonalNavbar({ season }: { season: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
  }, []);

  const SeasonIcon = season === "Winter" ? Snowflake : Sun;

// ─── MAIN PAGE ────────────────────────────────────────
export default function SeasonalPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";
  const page = SEASONAL_PAGES.find((s) => s.slug === slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!page) {
  }

  const SeasonIcon = page.season === "Winter" ? Snowflake : Sun;

}
