/**
 * /about — Tesla-style About page.
 * Clean, minimal, photography-driven.
 */
import InternalLinks from "@/components/InternalLinks";
import { useRef } from "react";
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, Star, ArrowRight } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";
const DIAG_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp";

export default function About() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000, retry: 1 });
  const rating = googleData?.rating ?? 4.9;
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

}
