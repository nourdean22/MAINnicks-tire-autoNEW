/**
 * /specials — Coupons & Special Offers page
 * Shows active promotions with countdown timers and mobile-friendly "show this coupon" display.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, Tag, Timer, Gift, Percent, ChevronRight, Copy, Check, Scissors } from "lucide-react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { QueryError } from "@/components/QueryState";
import FadeIn from "@/components/FadeIn";

// ─── COUNTDOWN TIMER ───────────────────────────────────
function CountdownTimer({ expiresAt }: { expiresAt: string | Date | null }) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!expiresAt) return;
    const target = new Date(expiresAt).getTime();

    const tick = () => {
      const now = Date.now();
      const diff = target - now;
      if (diff <= 0) {
        setExpired(true);
        return;
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };

    tick();
    const interval = setInterval(tick, 1000);
  }, [expiresAt]);

  if (!expiresAt) return null;
  if (expired) return <span className="font-mono text-red-400 text-xs tracking-wider">EXPIRED</span>;

// ─── COUPON CARD ───────────────────────────────────────
function CouponCard({ coupon }: { coupon: any }) {
  const [showCoupon, setShowCoupon] = useState(false);
  const [copied, setCopied] = useState(false);

  const discountDisplay = coupon.discountType === "dollar"
    ? `$${coupon.discountValue} OFF`
    : coupon.discountType === "percent"
    ? `${coupon.discountValue}% OFF`
    : "FREE";

  const copyCode = () => {
    if (coupon.code) {
      navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
  };

// ─── HARDCODED SEASONAL SPECIALS (always shown) ────────
const SEASONAL_SPECIALS = [
  {
    id: -1,
    title: "Spring Brake Inspection",
    description: "Winter roads take a toll on your brakes. Get a free visual brake inspection this spring. We check pads, rotors, calipers, and brake lines — and show you exactly what we find.",
    discountType: "free" as const,
    discountValue: 0,
    code: null,
    applicableServices: "Brakes",
    terms: "Visual inspection only. Additional diagnostics may apply.",
    isFeatured: 1,
    expiresAt: null,
  },
  {
    id: -2,
    title: "Oil Change Special",
    description: "Conventional oil change with filter replacement. Quick, affordable, done right. Includes a complimentary multi-point vehicle inspection.",
    discountType: "dollar" as const,
    discountValue: 10,
    code: "OIL10",
    applicableServices: "Oil Change",
    terms: "Conventional oil only. Synthetic upgrade available at additional cost.",
    isFeatured: 0,
    expiresAt: null,
  },
  {
    id: -3,
    title: "Check Engine Light Diagnostic",
    description: "Check engine light on? Do not ignore it. We use advanced OBD-II diagnostics to pinpoint the exact cause — no guessing, no unnecessary repairs.",
    discountType: "dollar" as const,
    discountValue: 25,
    code: "DIAG25",
    applicableServices: "Diagnostics",
    terms: "Diagnostic fee applied toward repair if service is performed.",
    isFeatured: 0,
    expiresAt: null,
  },
  {
    id: -4,
    title: "Refer a Friend — Both Save $25",
    description: "Know someone who needs honest auto repair? Refer them to Nick's and you both get $25 off your next service. Real rewards for real trust.",
    discountType: "dollar" as const,
    discountValue: 25,
    code: "REFER25",
    applicableServices: "all",
    terms: "Referee must be a new customer. Both parties receive $25 off services of $75+.",
    isFeatured: 0,
    expiresAt: null,
  },
];

export default function SpecialsPage() {
  const { data: dbCoupons, isLoading , isError, error } = trpc.coupons.active.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Merge DB coupons with seasonal specials, DB coupons first
  const allCoupons = useMemo(() => {
    const db = dbCoupons ?? [];
    // Filter out expired DB coupons
    const activeDbs = db.filter((c: any) => !c.expiresAt || new Date(c.expiresAt).getTime() > Date.now());
    return [...activeDbs, ...SEASONAL_SPECIALS];
  }, [dbCoupons]);

  const featuredCoupons = allCoupons.filter((c: any) => c.isFeatured);
  const regularCoupons = allCoupons.filter((c: any) => !c.isFeatured);

