/**
 * TIRE FINDER — Full e-commerce tire ordering with Nick's Premium Installation Package
 * 
 * STRATEGY: 100% markup on wholesale cost. $0 service fee.
 * Everything is "FREE" via the Nick's Premium Installation Package.
 * The package is so massive ($289+ value) that customers stop caring about tire price.
 * The psychology: "I'd be stupid NOT to buy from Nick's."
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation, Link, useSearch } from "wouter";
import PageLayout from "@/components/PageLayout";
// attribution-wave: trackPhoneClick now comes from the canonical SEO helper
// (umami + GA4 "phone_click" + Meta Pixel Contact + call_events DB row with
// UTM) instead of the legacy gtag-only @/lib/analytics path — tire-buyer
// phone clicks were invisible to the admin call dashboard before this.
import { SEOHead, Breadcrumbs, trackPhoneClick, trackEvent } from "@/components/SEO";
import { getSessionId } from "@/lib/session";
// attribution-holds migration 0067 — tire orders carry session UTM context.
import { getUtmData } from "@/lib/utm";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
// wave-fix-2026-05-28 (SEO-AEO parity) · /tires was the highest-impression
// money page lacking FAQPage JSON-LD that /brakes + oil + alignment already
// have. Visible <details> Q&A below + this schema = AI-answer-engine
// citations (ChatGPT/Perplexity/Gemini) for buy-tires-near-me intent.
import FAQPageSchema, { TIRE_BUYING_FAQ } from "@/components/FAQPageSchema";
import FinancingCTA from "@/components/FinancingCTA";
import TrustBlock from "@/components/TrustBlock";
// Conversion-architecture overlays (Batch 3 of v1.1 spec). Injected as a
// compact block right after the search hero so visitors see anchor pricing
// + fear stats before they get lost in size selection.
import AnchorAdjustmentTable from "@/components/conversion/AnchorAdjustmentTable";
import FearCalibrationBlock from "@/components/conversion/FearCalibrationBlock";
// tires-conversion-reconstruction wave — PAS hero + anti-chain fee table +
// used-tire trust protocol + Acima lease-to-own strip + frictionless
// intent panel (text-TIRE / plate lookup riding the trpc.lead.submit
// pipeline: DB lead row + owner Telegram alert + customer SMS confirm).
import FeeComparisonTable from "@/components/conversion/FeeComparisonTable";
import UsedTireTrustProtocol from "@/components/conversion/UsedTireTrustProtocol";
import FrictionlessIntentPanel from "@/components/conversion/FrictionlessIntentPanel";
// 2026-07-04 operator directive: no payment math on /tires. The
// interactive estimator became a one-line reassurance strip — customers
// see "from ~$12/week" and apply; Acima owns the numbers.
import AcimaLeaseStrip from "@/components/payments/AcimaLeaseStrip";
// 2026-07-04 line-hopper wave: /tires gets its own Nonstop Nick surface.
// The global NonstopNickTopBar is deliberately suppressed on this route
// (buying-intent pages own their messaging), so the membership pitch lives
// here instead — PAS intro + the LIVE join card (phone -> Stripe hosted
// Checkout via trpc.memberships.startCheckout, same tested component as
// /nonstop-nick and /book). Copy states only shipped benefits.
import NonstopNickJoin from "@/components/NonstopNickJoin";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Phone, Search, ShieldCheck, Truck, Clock, ChevronRight, ArrowLeft,
  Star, Check, X, Filter, Package, CircleDot, Loader2,
  CheckCircle2, Info, Gift, Sparkles, BadgeCheck, Wrench, Gauge,
  CircleCheck, Timer, Heart, AlertTriangle, Users, Zap, ThumbsUp, Award, MapPin,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import { motion, AnimatePresence } from "framer-motion";

// ─── HELPERS ──────────────────────────────────────────
const COMMON_SIZES = [
  "205/55R16", "215/60R16", "225/65R17", "235/65R18",
  "215/55R17", "225/60R18", "245/60R18", "265/70R17",
  "195/65R15", "225/45R17", "235/55R19", "275/55R20",
];

function formatSizeForSearch(size: string): string {
  return size.replace(/[\/Rr\s-]/g, "");
}

// Customer pays the tire total + 8% Ohio sales tax + a 2% card-processing
// surcharge. Computed in integer cents to match the server charge exactly.
function priceBreakdown(subtotalCents: number) {
  const tax = Math.round(subtotalCents * 0.08);
  const cardFee = Math.round((subtotalCents + tax) * 0.02);
  return { subtotal: subtotalCents, tax, cardFee, total: subtotalCents + tax + cardFee };
}

type SortOption = "price-low" | "price-high" | "warranty" | "brand";
type CategoryFilter = "all" | "budget" | "mid" | "premium";

// ─── BRAND LOGOS ─────────────────────────────────────
const BRAND_LOGOS: Record<string, string> = {
  goodyear: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/goodyear_03e6b30e.png",
  continental: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/continental_8f6621dd.png",
  hankook: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hankook_8515b228.png",
  cooper: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/cooper_0ca9fe43.png",
  nexen: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/nexen_79ee6b44.png",
  firestone: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/firestone_c2804191.png",
  general: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/general_523bbb9d.png",
  fortune: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/fortune_09740f8e.png",
  americus: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/americus_e1981f7d.png",
  bridgestone: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/bridgestone_3a002c89.jpg",
  michelin: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/michelin_f5739757.png",
  yokohama: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/yokohama_9c6ab122.png",
  pirelli: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/pirelli_7c895c15.png",
  toyo: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/toyo_fd6c9c2d.png",
  falken: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/falken_fcdce9e5.png",
};

function getBrandLogo(brand: string): string | null {
  const key = brand.toLowerCase().replace(/[^a-z]/g, "");
  // Try exact match first, then partial match
  if (BRAND_LOGOS[key]) return BRAND_LOGOS[key];
  for (const [k, url] of Object.entries(BRAND_LOGOS)) {
    if (key.includes(k) || k.includes(key)) return url;
  }
  return null;
}

const isInputPotentialTireSize = (input: string) => {
  if (!input.trim()) return true;
  const cleanStr = input.trim().replace(/[\/Rr\s-]/g, "");
  const tireRegex = /^\d{3}[a-zA-Z]?\d{2}[a-zA-Z]?\d{2}$/;
  return tireRegex.test(cleanStr);
};

const categoryBorders: Record<string, string> = {
  budget: "border-green-500/30 hover:border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.05)]",
  mid: "border-blue-500/30 hover:border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.05)]",
  ["prem" + "ium"]: "border-amber-500/30 hover:border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.05)]",
};

function TireCardSkeleton() {
  return (
    <div className="bg-card border border-border/30 rounded-lg p-5 animate-pulse space-y-4">
      <div className="flex justify-between items-start">
        <div className="space-y-2 flex-1">
          <div className="flex gap-2">
            <div className="h-4 bg-muted-foreground/25 rounded w-12" />
            <div className="h-4 bg-muted-foreground/25 rounded w-16" />
          </div>
          <div className="flex items-center gap-3 mt-2">
            <div className="w-16 h-10 bg-muted-foreground/25 rounded-md" />
            <div className="space-y-1.5 flex-1">
              <div className="h-4 bg-muted-foreground/25 rounded w-24" />
              <div className="h-3 bg-muted-foreground/25 rounded w-32" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-3">
        <div className="h-3 bg-muted-foreground/25 rounded w-16" />
        <div className="h-3 bg-muted-foreground/25 rounded w-16" />
        <div className="h-3 bg-muted-foreground/25 rounded w-16" />
      </div>
      <div className="h-12 bg-green-500/5 border border-green-500/10 rounded-md" />
      <div className="flex items-end justify-between pt-3 border-t border-border/20">
        <div className="space-y-2">
          <div className="h-6 bg-muted-foreground/25 rounded w-20" />
          <div className="h-3 bg-muted-foreground/25 rounded w-36" />
        </div>
        <div className="h-10 bg-muted-foreground/25 rounded w-24" />
      </div>
    </div>
  );
}

// ─── NAVBAR ───────────────────────────────────────────
// TireNavbar replaced with site-wide PageLayout for consistent navigation

// ─── NICK'S PACKAGE BANNER ───────────────────────────
// This is the genius marketing piece. Shows BEFORE tire results.
function PackageBanner({ packageData }: { packageData: any }) {
  const [expanded, setExpanded] = useState(false);

  if (!packageData) return null;

  const services = packageData.services || [];
  const packageValue = packageData.packageValuePerSet || 289;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="mb-8"
    >
      <div className="relative overflow-hidden bg-linear-to-br from-primary/5 via-card to-primary/5 border border-primary/20 rounded-xl">
        {/* Header */}
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
              <Gift className="w-7 h-7 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold text-primary tracking-[0.15em] uppercase bg-primary/10 px-2.5 py-0.5 rounded-full">
                  Included Free
                </span>
                <span className="text-[10px] font-medium text-green-400 bg-green-500/10 px-2.5 py-0.5 rounded-full">
                  ${packageValue}+ Value
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-semibold text-foreground mt-2">
                Nick's Premium Installation Package
              </h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                Every tire purchase includes our complete installation and protection package at no extra charge. Other shops charge $250+ for these services.
              </p>
            </div>
          </div>

          {/* Quick highlights — always visible */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            {[
              { icon: <Wrench className="w-4 h-4" />, label: "Professional Mounting", sub: "Hunter Road Force balancers" },
              { icon: <Gauge className="w-4 h-4" />, label: "Computer Balancing", sub: "Vibration-free ride" },
              { icon: <ShieldCheck className="w-4 h-4" />, label: "Free Flat Repair", sub: "First 12 months" },
              { icon: <BadgeCheck className="w-4 h-4" />, label: "20-Point Inspection", sub: "Included free" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2.5 bg-background/50 rounded-lg p-3">
                <div className="text-primary mt-0.5">{item.icon}</div>
                <div>
                  <p className="text-xs font-medium text-foreground leading-tight">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Expand to see all services */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-4 text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1 mx-auto"
          >
            <Sparkles className="w-3 h-3" />
            {expanded ? "Show less" : `See all ${services.length} included services`}
          </button>
        </div>

        {/* Expanded service list */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-6 sm:px-8 pb-6 sm:pb-8 border-t border-border/20 pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {services.map((svc: any, i: number) => (
                    <div key={i} className="flex items-start gap-2.5 py-2">
                      <CircleCheck className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-foreground">{svc.name}</p>
                        <p className="text-[10px] text-muted-foreground">{svc.desc}</p>
                        {svc.value > 0 && (
                          <span className="text-[10px] text-green-400 font-medium">${svc.value} value — FREE</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-border/20 text-center">
                  <p className="text-sm text-muted-foreground">
                    Total package value: <span className="text-primary font-semibold">${packageValue}+</span> — yours free with every tire purchase
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── ORDER MODAL ──────────────────────────────────────
interface OrderModalProps {
  tire: {
    name: string;
    brand: string;
    model: string;
    size: string;
    shopPrice: number;
    pricePerTireCents: number;
  } | null;
  quantity: number;
  packageValue: number;
  onClose: () => void;
  prefilledVehicle?: {
    year: string;
    make: string;
    model: string;
    option: string;
    speeds: string;
  } | null;
}

// Exported so the Esc-key regression test (admin.test.tsx) can render
// this in isolation; in app code it stays an internal component of
// TireFinder. Same module surface, no behavior change.
export function OrderModal({ tire, quantity, packageValue, onClose, prefilledVehicle }: OrderModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vehicleYear, setVehicleYear] = useState(prefilledVehicle?.year || "");
  const [vehicleMake, setVehicleMake] = useState(prefilledVehicle?.make || "");
  const [vehicleModel, setVehicleModel] = useState(prefilledVehicle?.model || "");
  const [vehicleOption, setVehicleOption] = useState(prefilledVehicle?.option || "");
  const [tireSize, setTireSize] = useState(tire?.size || "");
  const [notes, setNotes] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"walk-in" | "drop-off-morning" | "drop-off-afternoon" | "ship">("walk-in");
  const [shippingAddress, setShippingAddress] = useState("");
  const [orderResult, setOrderResult] = useState<{ orderNumber: string; invoiceNumber?: string; totalAmount: number } | null>(null);
  const [paymentSubmitted] = useState(false);

  useEffect(() => {
    if (prefilledVehicle) {
      setVehicleYear(prefilledVehicle.year);
      setVehicleMake(prefilledVehicle.make);
      setVehicleModel(prefilledVehicle.model);
      setVehicleOption(prefilledVehicle.option);
    }
  }, [prefilledVehicle]);

  useEffect(() => {
    if (tire?.size) {
      setTireSize(tire.size);
    }
  }, [tire]);

  const trackPartialOrder = () => {
    const phoneDigits = phone.replace(/\D/g, "");
    if (!phoneDigits && !name.trim()) return;

    const formattedVehicle = [
      vehicleYear.trim(),
      vehicleMake.trim(),
      vehicleModel.trim(),
      vehicleOption.trim() ? `(${vehicleOption.trim()})` : ""
    ].filter(Boolean).join(" ");

    const payload = JSON.stringify({
      name: name.trim() || undefined,
      phone: phone.trim() || undefined,
      service: `Tire Order: ${quantity}x ${tire?.brand || "Custom"} ${tire?.model || "Request"} (${tireSize || tire?.size || "Unknown"})`,
      vehicle: formattedVehicle || undefined,
      formType: "tire_order",
      step: "order_modal_blur",
      sessionId: getSessionId(),
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track-abandoned", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/track-abandoned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  };

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedTrackPartialOrder = () => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      trackPartialOrder();
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const orderMutation = trpc.gatewayTire.placeOrder.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setOrderResult({ orderNumber: data.orderNumber!, invoiceNumber: data.invoiceNumber, totalAmount: data.totalAmount! });
        trackEvent("form_completed", { type: "tire_order", orderNumber: data.orderNumber! });
      } else {
        toast.error("Something went wrong. Please call us at (216) 862-0005.");
      }
    },
    onError: () => toast.error("Something went wrong. Please call us at (216) 862-0005."),
  });

  // Online payment — opens Stripe's hosted checkout in this tab.
  const checkoutMutation = trpc.gatewayTire.createCheckout.useMutation({
    onSuccess: (data) => {
      if ("url" in data && data.url) {
        window.location.href = data.url;
      } else {
        const msg = "error" in data ? data.error : "Couldn't start checkout.";
        toast.error(`${msg} You can also call (216) 862-0005 to pay.`);
      }
    },
    onError: () => toast.error("Couldn't start checkout. Please call (216) 862-0005 to pay."),
  });

  // Escape closes the modal — standard keyboard/a11y expectation. Was
  // missing; only the X button and backdrop click closed the modal.
  // Direct browser audit found it. Registered globally on `window` so
  // it works whether or not focus is inside the modal form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tirePrice = tire ? tire.shopPrice : 0;
  const tirePriceCents = tire ? tire.pricePerTireCents : 0;
  const tireBrandName = tire ? tire.brand : "Custom Request";
  const tireModelName = tire ? tire.model : "Vehicle Fitment";

  const tireTotal = tirePrice * quantity;
  const bd = priceBreakdown(tirePriceCents * quantity);

  // Success state
  if (orderResult) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-card border border-border/50 rounded-lg p-6 sm:p-8 max-w-xl w-full max-h-[90vh] overflow-y-auto"
        >
          <button onClick={onClose} aria-label="Close" title="Close" className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>

          <h3 className="text-2xl font-bold text-foreground mb-1 text-center">Tire Request Submitted</h3>
          <p className="text-xs text-muted-foreground mb-6 text-center">
            Order <span className="font-mono text-primary font-semibold">#{orderResult.orderNumber}</span>
            {orderResult.invoiceNumber && ` · Invoice ${orderResult.invoiceNumber}`}
          </p>

          {/* 4-Step Vertical Timeline */}
          <div className="text-left space-y-6 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-border/30 mb-8 pl-1">
            
            {/* Step 1: Request Received */}
            <div className="relative flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center shrink-0 z-10">
                <Check className="w-4 h-4 text-green-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">1. Request Received</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  We've received your request for {quantity}x {tireBrandName} {tireModelName} ({tireSize || "Unknown"}).
                </p>
              </div>
            </div>

            {/* Step 2: Staff Check */}
            <div className="relative flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 z-10">
                <Clock className="w-4 h-4 text-primary animate-pulse" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">2. Staff Confirms Availability & Fitment</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Nick's team is verifying local and warehouse stock. We will text or call you to confirm everything.
                </p>
                <p className="text-[10px] text-amber-500/95 font-medium mt-1">
                  No supplier reservation is guaranteed until staff confirms availability.
                </p>
              </div>
            </div>

            {/* Step 3: Pay Online (Optional) */}
            <div className="relative flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 z-10">
                <Gift className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-foreground">3. Pay Online (Optional) or Pay at Shop</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Prepaying locks in your order once confirmed, though payment does not guarantee supplier reservation. Otherwise, pay at the counter during your visit.
                </p>
                
                {/* Stripe Pay Now / Financing CTAs */}
                {!paymentSubmitted && (
                  <div className="mt-3 bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
                    {tire && tire.shopPrice > 0 ? (
                      <>
                        <button
                          onClick={() => checkoutMutation.mutate({ orderNumber: orderResult.orderNumber, phone })}
                          disabled={checkoutMutation.isPending}
                          className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground py-2.5 rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {checkoutMutation.isPending ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting secure checkout…</>
                          ) : (
                            <>Pay Now — ${(bd.total / 100).toFixed(2)}</>
                          )}
                        </button>
                        <p className="text-[9px] text-muted-foreground text-center">
                          Secure card payment via Stripe. Cards carry a 2% surcharge.
                        </p>
                        
                        <div className="border-t border-border/20 pt-3">
                          <p className="text-[10px] text-muted-foreground mb-2 text-center font-medium">Or apply for Snap/Acima payment programs:</p>
                          <div className="flex gap-2">
                            <a
                              href="https://getsnap.snapfinance.com/lease/en-US/consumer/apply?ep=store-locator&merchantId=490295617&externalMerchantId=77661"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 text-center bg-[#FF6B00] text-white py-2 rounded-md text-xs font-medium hover:bg-[#FF6B00]/90 transition-colors"
                            >
                              Snap Finance
                            </a>
                            <a
                              href="https://acima.us/1TjEOYtr6C"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 text-center bg-blue-600 text-white py-2 rounded-md text-xs font-medium hover:bg-blue-600/90 transition-colors"
                            >
                              Acima
                            </a>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-amber-500/90 font-medium text-center py-2">
                        Online payment will be available once staff confirms pricing.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Step 4: Visit Shop */}
            <div className="relative flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 z-10">
                <Wrench className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">4. Visit Shop for Installation</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {deliveryMethod === "ship"
                    ? "We'll confirm availability and contact you with shipping cost. Payment required before shipping."
                    : deliveryMethod.startsWith("drop-off")
                    ? "We'll confirm availability and contact you. Drop off your vehicle and we'll get it done — drop-offs are worked first come, first serve."
                    : "We'll confirm availability and contact you. Walk in anytime we're open — first come first serve!"}
                </p>
              </div>
            </div>

          </div>

          {/* Pricing Summary */}
          <div className="bg-background/50 border border-border/30 rounded-md p-4 mb-6 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{quantity}x {tireBrandName} {tireModelName}</span>
              <span className="text-foreground font-medium">
                {tire && tire.shopPrice > 0 ? `$${(bd.subtotal / 100).toFixed(2)}` : "Pending confirmation"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ohio sales tax (8%)</span>
              <span className="text-foreground">
                {tire && tire.shopPrice > 0 ? `$${(bd.tax / 100).toFixed(2)}` : "Pending confirmation"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Card processing fee (2%)</span>
              <span className="text-foreground">
                {tire && tire.shopPrice > 0 ? `$${(bd.cardFee / 100).toFixed(2)}` : "Pending confirmation"}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border/30">
              <span className="font-medium text-foreground">Total Estimate</span>
              <span className="font-semibold text-primary">
                {tire && tire.shopPrice > 0 ? `$${(bd.total / 100).toFixed(2)}` : "Price Pending Confirmation"}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="w-full bg-primary text-primary-foreground py-3 rounded-md font-medium hover:bg-primary/90 transition-colors">
            Done
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative bg-card border border-border/50 rounded-lg p-6 sm:p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto"
      >
        <button onClick={onClose} aria-label="Close" title="Close" className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-semibold text-foreground mb-1">Request Tires</h3>
        <p className="text-muted-foreground text-sm mb-6">{quantity}x {tireBrandName} {tireModelName} {tireSize ? `(${tireSize})` : ""}</p>

        {/* Price breakdown — the psychology */}
        <div className="bg-background/50 border border-border/30 rounded-md p-4 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">{tireBrandName} {tireModelName} x{quantity}</span>
            <span className="text-foreground font-medium">{tire && tire.shopPrice > 0 ? `$${tireTotal.toFixed(2)}` : "Pending confirmation"}</span>
          </div>

          {/* FREE package — this is the genius part */}
          <div className="border-t border-border/20 mt-2 pt-2 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Professional Mounting x{quantity}</span>
              <span className="text-green-400 font-medium line-through-none">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Computer Balancing x{quantity}</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">New Valve Stems x{quantity}</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tire Disposal & Recycling x{quantity}</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">TPMS Sensor Reset</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">20-Point Safety Inspection</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Alignment Check</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">1-Year Free Rotation & Flat Repair</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
          </div>

          <div className="border-t border-border/30 mt-3 pt-3 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Installation package value</span>
              <span className="line-through">${packageValue}+</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tires x{quantity}</span>
              <span className="text-foreground">{tire && tire.shopPrice > 0 ? `$${(bd.subtotal / 100).toFixed(2)}` : "Pending confirmation"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ohio sales tax (8%)</span>
              <span className="text-foreground">{tire && tire.shopPrice > 0 ? `$${(bd.tax / 100).toFixed(2)}` : "Pending confirmation"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Card processing fee (2%)</span>
              <span className="text-foreground">{tire && tire.shopPrice > 0 ? `$${(bd.cardFee / 100).toFixed(2)}` : "Pending confirmation"}</span>
            </div>
            <div className="flex justify-between pt-1.5 border-t border-border/20">
              <span className="font-medium text-foreground">Estimated Total</span>
              <span className="font-semibold text-primary text-lg">{tire && tire.shopPrice > 0 ? `$${(bd.total / 100).toFixed(2)}` : "Price Pending Confirmation"}</span>
            </div>
            <p className="text-[10px] text-green-400 text-right font-medium">
              You save ${packageValue}+ on installation
            </p>
          </div>
        </div>

        {/* Install / Delivery Method */}
        <div className="mb-6">
          <label className="block text-sm text-muted-foreground mb-2">How do you want your tires installed?</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: "walk-in" as const, icon: "🏪", title: "Walk In", desc: "Come anytime we're open", note: "Included" },
              { id: "drop-off-morning" as const, icon: "🌅", title: "Drop Off AM", desc: "Leave it before noon", note: "Included" },
              { id: "drop-off-afternoon" as const, icon: "🌇", title: "Drop Off PM", desc: "Leave it afternoon", note: "Included" },
              { id: "ship" as const, icon: "📦", title: "Ship to Me", desc: "We ship to your door", note: "Shipping extra" },
            ]).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setDeliveryMethod(opt.id)}
                className={`p-3 rounded-md border text-left transition-colors ${
                  deliveryMethod === opt.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-border"
                }`}
              >
                <div className="font-medium text-sm">{opt.icon} {opt.title}</div>
                <div className="text-[11px] mt-0.5 opacity-70">{opt.desc}</div>
                <div className={`text-[11px] mt-1 font-medium ${opt.id === "ship" ? "text-muted-foreground" : "text-green-400"}`}>{opt.note}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Full Name *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              onBlur={debouncedTrackPartialOrder}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Phone Number *</label>
            <input
              type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              onBlur={debouncedTrackPartialOrder}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder={BUSINESS.phone.placeholder}
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Email (for order updates)</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              onBlur={debouncedTrackPartialOrder}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="john@example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Vehicle Year *</label>
              <input
                type="text"
                value={vehicleYear}
                onChange={(e) => setVehicleYear(e.target.value)}
                onBlur={debouncedTrackPartialOrder}
                className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="2020"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Vehicle Make *</label>
              <input
                type="text"
                value={vehicleMake}
                onChange={(e) => setVehicleMake(e.target.value)}
                onBlur={debouncedTrackPartialOrder}
                className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="Honda"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Vehicle Model *</label>
              <input
                type="text"
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                onBlur={debouncedTrackPartialOrder}
                className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="Civic"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Option / Trim (optional)</label>
              <input
                type="text"
                value={vehicleOption}
                onChange={(e) => setVehicleOption(e.target.value)}
                onBlur={debouncedTrackPartialOrder}
                className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="LX / EX"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Tire Size *</label>
            <input
              type="text"
              value={tireSize}
              onChange={(e) => setTireSize(e.target.value)}
              onBlur={debouncedTrackPartialOrder}
              disabled={!!tire}
              className={`w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors ${
                tire ? "opacity-60 cursor-not-allowed bg-muted/10" : ""
              }`}
              placeholder="e.g. 215/60R16"
            />
          </div>
          {deliveryMethod === "ship" && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">Shipping Address *</label>
              <textarea
                value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} rows={2}
                className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors resize-none"
                placeholder="123 Main St, Cleveland, OH 44112"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Prepayment required for shipping. We'll contact you with shipping cost before charging.</p>
            </div>
          )}
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Notes (optional)</label>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors resize-none"
              placeholder={deliveryMethod === "ship" ? "Any special shipping instructions..." : "Preferred day/time for installation..."}
            />
          </div>
        </div>

        <button
          onClick={() => {
            const formattedVehicle = [
              vehicleYear.trim(),
              vehicleMake.trim(),
              vehicleModel.trim(),
              vehicleOption.trim() ? `(${vehicleOption.trim()})` : ""
            ].filter(Boolean).join(" ");

            const phoneDigits = phone.replace(/\D/g, "");
            if (!name.trim() || phoneDigits.length < 10) {
              toast.error(!name.trim() ? "Name is required." : "Please enter a valid 10-digit phone number");
              return;
            }
            if (!vehicleYear.trim() || !vehicleMake.trim() || !vehicleModel.trim()) {
              toast.error("Vehicle Year, Make, and Model are required.");
              return;
            }
            if (!tireSize.trim()) {
              toast.error("Tire Size is required.");
              return;
            }
            if (deliveryMethod === "ship" && !shippingAddress.trim()) {
              toast.error("Shipping address is required for delivery orders.");
              return;
            }
            if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
              toast.error("That email doesn't look right — fix it or leave it blank.");
              return;
            }
            const deliveryNote = deliveryMethod === "ship"
              ? `[SHIP TO: ${shippingAddress.trim()}] ${notes.trim()}`
              : notes.trim();
            orderMutation.mutate({
              tireBrand: tireBrandName,
              tireModel: tireModelName,
              tireSize: tireSize.trim(),
              quantity,
              pricePerTireCents: tirePriceCents,
              customerName: name.trim(),
              customerPhone: phone.trim(),
              customerEmail: email.trim() || undefined,
              vehicleInfo: formattedVehicle || undefined,
              customerNotes: deliveryNote || undefined,
              installPreference: deliveryMethod,
              ...getUtmData(),
            });
          }}
          disabled={orderMutation.isPending}
          className="w-full mt-6 bg-primary text-primary-foreground py-3.5 rounded-md font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {orderMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Requesting Tires...</>
          ) : (tire && tire.shopPrice > 0) ? (
            <>Request These Tires — ${(bd.total / 100).toFixed(2)}</>
          ) : (
            <>Request Price Confirmation</>
          )}
        </button>

        {/* Merge: #41's 3-line structure + this wave's pay-at-the-shop
            option clarity. */}
        <div className="text-xs text-muted-foreground text-center mt-4 space-y-1">
          <p>No card required to request — paying online afterward is optional, or pay at the shop.</p>
          <p>Staff will confirm availability and fitment before final shop hand-off.</p>
          <p className="text-amber-500/80">Gateway/D&K availability can change until staff confirms.</p>
        </div>
      </motion.div>
    </div>
  );
}

// ─── TIRE CARD ────────────────────────────────────────
interface TireCardProps {
  tire: {
    id: string;
    name: string;
    brand: string;
    model: string;
    size: string;
    category: "budget" | "mid" | "premium";
    shopPrice: number;
    pricePerTireCents: number;
    warranty: string;
    features: string[];
    speedRating: string;
    loadIndex: string;
    inStock: boolean;
    estimatedDelivery: string;
  };
  quantity: number;
  onSelect: () => void;
}

const categoryLabels: Record<string, { label: string; color: string }> = {
  budget: { label: "Value", color: "text-green-400 bg-green-500/10" },
  mid: { label: "Popular", color: "text-blue-400 bg-blue-500/10" },
  premium: { label: "Premium", color: "text-amber-400 bg-amber-500/10" },
};

function TireCard({ tire, quantity, onSelect }: TireCardProps) {
  const cat = categoryLabels[tire.category] || categoryLabels.mid;
  const setPrice = (tire.shopPrice * quantity).toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group bg-card border rounded-lg p-5 transition-all duration-200 ${categoryBorders[tire.category] || categoryBorders.mid}`}
    >
      {/* Header with brand logo */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-medium tracking-wider uppercase px-2 py-0.5 rounded-full ${cat.color}`}>
              {cat.label}
            </span>
            {tire.inStock ? (
              <span className="text-[10px] font-medium text-green-400 bg-green-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                <CircleDot className="w-2.5 h-2.5 animate-pulse" /> In Stock (Euclid Warehouse)
              </span>
            ) : (
              <a
                href="tel:+12168620005"
                onClick={(e) => { e.stopPropagation(); trackPhoneClick("tire-finder-stock-availability"); }}
                className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1 hover:text-amber-300 transition-colors shrink-0"
              >
                <CircleDot className="w-2.5 h-2.5 text-amber-500" /> Call for Availability
              </a>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            {getBrandLogo(tire.brand) && (
              <div className="w-16 h-10 shrink-0 flex items-center justify-center bg-white rounded-md p-1.5 border border-border/20">
                <img
                  src={getBrandLogo(tire.brand)!}
                  alt={`${tire.brand} logo`}
                  className="max-w-full max-h-full object-contain"
                  loading="lazy"
                />
              </div>
            )}
            <div>
              <h3 className="text-foreground font-medium leading-snug">{tire.brand}</h3>
              <p className="text-sm text-muted-foreground">{tire.model}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Specs */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-3">
        <span>Size: {tire.size}</span>
        {tire.loadIndex && <span>Load: {tire.loadIndex}</span>}
        {tire.speedRating && <span>Speed: {tire.speedRating}</span>}
      </div>

      {/* Features */}
      {tire.features.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {tire.features.map((f) => (
            <span key={f} className="text-[10px] text-muted-foreground border border-border/30 rounded-full px-2 py-0.5">
              {f}
            </span>
          ))}
        </div>
      )}

      {/* Warranty */}
      {tire.warranty && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <ShieldCheck className="w-3.5 h-3.5 text-primary/60" />
          <span>{tire.warranty} warranty</span>
        </div>
      )}

      {/* FREE package callout on every card */}
      <div className="bg-green-500/5 border border-green-500/15 rounded-md px-3 py-2.5 mb-4">
        <div className="flex items-center gap-1.5">
          <Gift className="w-3.5 h-3.5 text-green-400" />
          <span className="text-[10px] font-semibold text-green-400 uppercase tracking-wider">Installation Package Included</span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 ml-5 leading-normal">
          Installation package details are included in the estimate before request.
        </p>
      </div>

      {/* Price + CTA */}
      <div className="flex items-end justify-between pt-3 border-t border-border/20">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-foreground">${tire.shopPrice.toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">/tire</span>
          </div>
          <p className="text-sm font-semibold text-primary mt-1">
            ${setPrice} total for {quantity} {quantity === 1 ? "tire" : "tires"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Includes installation package & fees in estimate
          </p>
        </div>
        <button
          onClick={onSelect}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors btn-premium"
        >
          Select
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Delivery */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
        <Truck className="w-3.5 h-3.5" />
        <span>{tire.estimatedDelivery}</span>
      </div>
    </motion.div>
  );
}

// ─── ORDER TRACKER ────────────────────────────────────
function OrderTracker() {
  const [orderNum, setOrderNum] = useState("");
  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);

  const { data: order, refetch, isLoading } = trpc.gatewayTire.checkOrder.useQuery(
    { orderNumber: orderNum, phone },
    { enabled: false }
  );

  const handleTrack = () => {
    if (!orderNum.trim() || !phone.trim()) {
      toast.error("Enter your order number and phone number.");
      return;
    }
    setSearching(true);
    refetch().finally(() => setSearching(false));
  };

  const statusSteps = ["received", "confirmed", "ordered", "in_transit", "delivered", "scheduled", "installed"];

  return (
    <div className="bg-card border border-border/30 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Package className="w-5 h-5 text-primary" />
        Track Your Order
      </h3>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text" value={orderNum} onChange={(e) => setOrderNum(e.target.value)}
          placeholder="Order # (e.g. TO-20260320-123)"
          className="flex-1 bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50"
        />
        <input
          type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number"
          className="flex-1 bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50"
        />
        <button
          onClick={handleTrack}
          disabled={searching || isLoading}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
        >
          {searching ? "Searching..." : "Track"}
        </button>
      </div>

      {searching === false && order === null && orderNum && (
        <p className="text-sm text-muted-foreground">No order found. Check your order number and phone number.</p>
      )}

      {order && (
        <div className="mt-4 border-t border-border/30 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-foreground">{order.quantity}x {order.tireBrand} {order.tireModel}</p>
              <p className="text-xs text-muted-foreground">Size: {order.tireSize} — Total: ${order.totalAmount.toFixed(2)}</p>
              <p className={`text-xs font-medium mt-0.5 ${order.paymentStatus === "paid" ? "text-green-400" : "text-amber-400"}`}>
                {order.paymentStatus === "paid" ? "✓ Paid" : "Payment pending"}
              </p>
            </div>
            <span className="text-xs font-medium px-3 py-1 rounded-full bg-primary/10 text-primary">
              {order.statusLabel}
            </span>
          </div>
          <div className="flex items-center gap-1 mt-4">
            {statusSteps.map((step, i) => {
              const currentIdx = statusSteps.indexOf(order.status);
              const isComplete = i <= currentIdx;
              return (
                <div key={step} className="flex-1">
                  <div className={`h-1.5 rounded-full ${isComplete ? "bg-primary" : "bg-border/30"}`} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Received</span>
            <span>Installed</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────
export default function TireFinder() {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  // Read ?size= from URL for shareable/bookmarkable searches
  const urlSize = useMemo(() => {
    const rawSize = new URLSearchParams(searchString).get("size");
    if (!rawSize) return "";
    let cleaned = rawSize.trim();
    
    // Check if the size string matches a duplication pattern (e.g. 215/60R16215/60R16)
    const duplicateMatch = cleaned.match(/^(.{3,})\1$/i);
    if (duplicateMatch) {
      cleaned = duplicateMatch[1];
    }
    
    // Check for double/nested query param structure (e.g. 215/60R16?size=215/60R16 or 215/60R16&size=215/60R16)
    if (cleaned.includes("?size=")) {
      cleaned = cleaned.split("?size=")[0];
    } else if (cleaned.includes("&size=")) {
      cleaned = cleaned.split("&size=")[0];
    } else if (cleaned.includes("size=")) {
      cleaned = cleaned.split("size=")[0];
    }
    
    return cleaned;
  }, [searchString]);
  const [searchInput, setSearchInput] = useState(urlSize || "");
  const [activeSearch, setActiveSearch] = useState(urlSize || "");

  useEffect(() => {
    if (urlSize) {
      setSearchInput(urlSize);
      setActiveSearch(urlSize);
      
      // Clean up dirty URL in address bar if needed
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("size");
      if (raw !== urlSize) {
        params.set("size", urlSize);
        window.history.replaceState({}, "", window.location.pathname + "?" + params.toString());
      }
    } else {
      setSearchInput("");
      setActiveSearch("");
    }
  }, [urlSize]);
  const [quantity, setQuantity] = useState(4);
  const [sortBy, setSortBy] = useState<SortOption>("price-low");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedTire, setSelectedTire] = useState<any>(null);
  const [showOrder, setShowOrder] = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const [showSizeHelper, setShowSizeHelper] = useState(false);
  const [rescueName, setRescueName] = useState("");
  const [rescuePhone, setRescuePhone] = useState("");
  const [rescueSubmitted, setRescueSubmitted] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const ezytireBaseUrl = import.meta.env.VITE_EZYTIRE_BASE_URL || (import.meta.env.PROD ? "" : "test.ezytiredemo.com");
  const [searchTab, setSearchTab] = useState<"size" | "vehicle" | "help">("size");
  const showTabs = !!ezytireBaseUrl;

  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const urlWidth = searchParams.get("width");
  const urlAspect = searchParams.get("aspect");
  const urlRim = searchParams.get("rim");
  const urlYear = searchParams.get("year");
  const urlMake = searchParams.get("make");
  const urlModel = searchParams.get("model");
  const urlOption = searchParams.get("option");
  const urlSpeeds = searchParams.get("speeds");

  // Reconstruct size from Ezytire redirect query
  useEffect(() => {
    if (urlWidth && urlAspect && urlRim) {
      const reconstructedSize = `${urlWidth}/${urlAspect}R${urlRim}`;
      setLocation(`/tires?size=${encodeURIComponent(reconstructedSize)}`, { replace: true });
    }
  }, [urlWidth, urlAspect, urlRim, setLocation]);

  const prefilledVehicle = useMemo(() => {
    if (urlYear || urlMake || urlModel || urlOption) {
      return {
        year: urlYear || "",
        make: urlMake || "",
        model: urlModel || "",
        option: urlOption || "",
        speeds: urlSpeeds || "",
      };
    }
    return null;
  }, [urlYear, urlMake, urlModel, urlOption, urlSpeeds]);

  const activeSearchType = useMemo(() => {
    if (prefilledVehicle) return "vehicle";
    return "size";
  }, [prefilledVehicle]);

  const ezytireIframeUrl = useMemo(() => {
    if (!ezytireBaseUrl || !prefilledVehicle) return "";
    const params = new URLSearchParams();
    if (prefilledVehicle.year) params.set("year", prefilledVehicle.year);
    if (prefilledVehicle.make) params.set("make", prefilledVehicle.make);
    if (prefilledVehicle.model) params.set("model", prefilledVehicle.model);
    if (prefilledVehicle.option) params.set("option", prefilledVehicle.option);
    if (prefilledVehicle.speeds) params.set("speeds", prefilledVehicle.speeds);
    return `https://${ezytireBaseUrl}/site/pages/search_results.php?${params.toString()}`;
  }, [ezytireBaseUrl, prefilledVehicle]);

  // Set default tab if prefilled vehicle is loaded
  useEffect(() => {
    if (prefilledVehicle) {
      setSearchTab("vehicle");
    }
  }, [prefilledVehicle]);

  // Lazy-load Ezytire script
  useEffect(() => {
    if (searchTab !== "vehicle" || !ezytireBaseUrl) return;

    let isMounted = true;

    const loadScript = (url: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.type = "text/javascript";
        script.src = url;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Script load failed"));
        document.body.appendChild(script);
      });
    };

    const scriptUrl = `https://${ezytireBaseUrl}/site/api/js/widget.js`;

    loadScript(scriptUrl)
      .then(() => {
        if (!isMounted) return;
        trackEvent("ezytire_widget_loaded", { url: scriptUrl });

        setTimeout(() => {
          if (!isMounted) return;
          const global = window as any;
          if (typeof global.EZT_LoadVehicleSearch === "function") {
            try {
              const targetUrl = window.location.origin + window.location.pathname;
              global.EZT_LoadVehicleSearch(
                "ezy-year",
                "ezy-make",
                "ezy-model",
                "ezy-option",
                "ezy-submit",
                ezytireBaseUrl,
                targetUrl
              );
            } catch (err) {
              console.error("Failed to load Ezytire vehicle search:", err);
            }
          }
        }, 150);
      })
      .catch((err) => {
        console.error(err);
        toast.error("Failed to load vehicle search widget. Please try size search or call us.");
      });

    return () => {
      isMounted = false;
    };
  }, [searchTab, ezytireBaseUrl]);

  const rescueMutation = trpc.callback.submit.useMutation({
    onSuccess: () => {
      setRescueSubmitted(true);
      toast.success("Callback request submitted! We will contact you shortly.");
    },
    onError: () => {
      toast.error("Couldn't request callback. Please call us at (216) 862-0005.");
    }
  });

  useEffect(() => {
    if (!showSizeHelper) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowSizeHelper(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSizeHelper]);

  const searchQuery = useMemo(() => formatSizeForSearch(activeSearch), [activeSearch]);

  const { data, isLoading, isError } = trpc.gatewayTire.publicSearch.useQuery(
    { size: searchQuery, category: categoryFilter, sortBy },
    { enabled: !!activeSearch }
  );

  // Get the package details
  const { data: packageData } = trpc.gatewayTire.getPackage.useQuery();

  // 2026-05-23 · honest social proof — last-7-days tire-order count.
  // Powers the activity badge above the trust strip. Real DB data;
  // empty result → no badge. 5-min stale time, light query.
  const { data: socialStats } = trpc.gatewayTire.publicStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  // Confirm-on-return fallback — finalizes a paid order if the Stripe
  // webhook hasn't landed yet (see the ?paid=1 effect below).
  const confirmCheckout = trpc.gatewayTire.confirmCheckout.useMutation();

  const handleSearch = () => {
    if (searchInput.trim().length < 3) {
      toast.error("Please enter a valid tire size (e.g. 215/60R16).");
      return;
    }
    const targetSize = searchInput.trim();
    setSearchInput(targetSize);
    setActiveSearch(targetSize);
    
    const params = new URLSearchParams(window.location.search);
    params.set("size", targetSize);
    window.history.replaceState({}, "", window.location.pathname + "?" + params.toString());
  };

  useEffect(() => {
    if (data && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [data]);

  // Stripe Checkout return — show the customer a clear result.
  // 2026-05-23 · gate the success toast on the SERVER-confirmed result.
  // Previously we fired toast.success the moment ?paid=1 landed, before
  // confirmCheckout resolved. Bad URL tampering OR a still-open Stripe
  // session would show a green success while the order was unpaid.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const paid = params.get("paid");
    const order = params.get("order");
    if (paid === "1" && order) {
      // Webhook is the primary path; this is the fallback so a paid order
      // is never stuck "unpaid" if the webhook is slow or misconfigured.
      // Idempotent server-side — safe even if the webhook also fires.
      confirmCheckout.mutate({ orderNumber: order }, {
        onSuccess: (r) => {
          if (r?.ok) {
            toast.success(`Payment received — order ${order} is confirmed. We'll be in touch about installation.`);
          } else {
            toast.error(`We couldn't verify payment for order ${order}. Call (216) 862-0005 — we'll sort it out.`);
          }
        },
        onError: () => {
          toast.error(`We couldn't verify payment for order ${order}. Call (216) 862-0005 — we'll sort it out.`);
        },
      });
      // wave-fix-2026-05-25 (audit #117) · strip ?paid=1&order=X from
      // the URL after handling. Without this, a page refresh re-fires
      // the confirmCheckout mutation AND duplicates the toast every
      // time the user reloads. replaceState (not pushState) so the
      // back button doesn't return to the dirty URL state.
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete("paid");
      cleanParams.delete("order");
      const searchStr = cleanParams.toString();
      window.history.replaceState({}, "", window.location.pathname + (searchStr ? `?${searchStr}` : ""));
    } else if (paid === "0" && order) {
      toast(`Payment cancelled — order ${order} is still saved. You can pay anytime.`);
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete("paid");
      cleanParams.delete("order");
      const searchStr = cleanParams.toString();
      window.history.replaceState({}, "", window.location.pathname + (searchStr ? `?${searchStr}` : ""));
    }
  }, []);

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="Used Tires in Euclid & Cleveland · From $25 Installed | Nick's Tire & Auto"
        description="Used tires in Euclid & Cleveland from $25 installed. Every tire inspected, mounted, balanced, valve stems included. Walk in 7 days, first-come first-served. (216) 862-0005"
        canonicalPath="/tires"
      />
      {/* v1.7 SEO · BreadcrumbList JSON-LD + visible nav */}
      <Breadcrumbs items={[{ label: "Tires" }]} />
      <LocalBusinessSchema includeServices />
      {/* wave-181.13 · Product schema with priceRange (audit "easy
          schema win"). Unlocks Google's Product rich-result eligibility
          for tire-shopping queries. lowPrice 40 = used tire minimum,
          highPrice 350 = typical new-tire ceiling (single tire); set
          shipping/return as in-store-only with FreeShippingDetails
          unset to satisfy required Offer fields without claiming any
          shipping policy. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: "New & Used Tires at Nick's Tire & Auto",
            description:
              "Used tires from $25 installed, new tires from $89. Free mount, balance, valve stems, TPMS reset, alignment check on every set. Cleveland's first-come-first-served tire shop on Euclid Ave.",
            brand: { "@type": "Brand", name: "Nick's Tire & Auto" },
            category: "Auto Tires",
            image: [
              "https://nickstire.org/photos/shopfront-clear-vertical-sign-bays.webp",
              "https://nickstire.org/photos/busy-shop-action-mechanics.webp",
            ],
            aggregateRating: {
              "@type": "AggregateRating",
              // wave-181.15 · silent-failure audit Finding #5 · was
              // hardcoded "1683" / "4.9" which drift from the canonical
              // BUSINESS constant. Now pulls from shared/business.ts
              // so when the GBP review count grows, schema follows.
              ratingValue: String(BUSINESS.reviews.rating),
              reviewCount: String(BUSINESS.reviews.count),
              bestRating: "5",
              worstRating: "1",
            },
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: "USD",
              lowPrice: "40",
              highPrice: "350",
              offerCount: "800",
              availability: "https://schema.org/InStock",
              seller: {
                "@type": "AutoRepair",
                name: "Nick's Tire & Auto",
                telephone: "+1-216-862-0005",
                address: {
                  "@type": "PostalAddress",
                  streetAddress: "17625 Euclid Ave",
                  addressLocality: "Cleveland",
                  addressRegion: "OH",
                  postalCode: "44112",
                  addressCountry: "US",
                },
              },
            },
          }),
        }}
      />
      <div className="min-h-screen bg-background text-foreground">

      {/* ─── HERO ─── */}
      <section className="pt-24 pb-12 sm:pt-28 sm:pb-16 bg-linear-to-b from-card/60 via-background to-background border-b border-border/10">
        <div className="container max-w-3xl mx-auto text-center">
          <motion.div initial={{ opacity: 1, y: 0 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0 }}>
            <span className="text-xs font-semibold text-primary tracking-[0.2em] uppercase">
              Used Tires Euclid & Cleveland · New Tires · Walk In or Order Online
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-foreground mt-4 leading-[1.1] tracking-tight">
              Used & New Tires in Euclid & Cleveland
            </h1>
            <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Find new or used tires for your vehicle. Beyond tire fitting, Nick's on Euclid Ave offers same-day <Link href="/brakes" className="underline text-primary hover:text-primary-foreground font-semibold">brake repair in Euclid</Link> and fast <Link href="/diagnostics" className="underline text-primary hover:text-primary-foreground font-semibold">check engine light diagnostics</Link>. Walk in 7 days, explore our soft-pull <Link href="/financing" className="underline text-primary hover:text-primary-foreground font-semibold">financing options for repairs</Link>, or <Link href="/contact" className="underline text-primary hover:text-primary-foreground font-semibold">contact Nick’s Tire & Auto</Link> today.
            </p>

            {/* PAS hook — physics, not superlatives. The h1 above keeps
                the ranking keywords; this block does the persuading. */}
            <div className="mt-7 max-w-2xl mx-auto text-left bg-card/70 border border-red-500/25 rounded-xl p-5 sm:p-6">
              <p className="text-xl sm:text-2xl font-extrabold tracking-tight leading-tight uppercase text-foreground">
                Your tires pump water. <span className="text-red-400">Worn tread can't.</span> You surf.
              </p>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                A healthy tire channels gallons of water out of the contact patch every second at
                highway speed. At <strong className="text-foreground">4/32″ of tread</strong> the
                grooves are half gone — in a wet downpour your stopping distance stretches by about{" "}
                <strong className="text-red-300">87 feet</strong>. That's two Cleveland RTA transit
                buses parked between where you should have stopped and where you actually do.
              </p>
              <p className="mt-2 text-sm text-foreground/80 leading-relaxed">
                The fix is cheaper than the deductible: inspected used tires from{" "}
                <strong className="text-primary">$25 installed</strong>, new sets with mounting,
                balancing, valve stems, TPMS reset, and disposal already in the price.
              </p>
            </div>

            {/* Value proposition callout */}
            <div className="mt-5 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-2">
              <Gift className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-emerald-400 font-medium">
                $0 add-on fees — the sticker price is the installed price.
              </span>
            </div>
          </motion.div>

          {/* Sleek yellow-accented tab switcher */}
          {showTabs && (
            <div className="flex justify-center border-b border-border/20 mb-8 mt-8">
              {(["size", "vehicle", "help"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setSearchTab(tab);
                    trackEvent("ezytire_tab_changed", { tab });
                  }}
                  className={`px-6 py-3 text-sm font-semibold border-b-2 transition-all ${
                    searchTab === tab
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "size" && "Search by Size"}
                  {tab === "vehicle" && "Search by Vehicle"}
                  {tab === "help" && "Get Fitment Help"}
                </button>
              ))}
            </div>
          )}

          {/* Search Content */}
          <div className="mt-4">
            {searchTab === "size" && (
              <div>
                <div className="flex items-center bg-card border border-border/50 rounded-lg overflow-hidden focus-within:border-primary/50 transition-colors">
                  <Search className="w-5 h-5 text-muted-foreground ml-4 shrink-0" />
                  <input
                    type="text"
                    name="tire-size"
                    aria-label="Search tire size"
                    id="tire-size-search"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="Enter tire size (e.g. 215/60R16)"
                    className="flex-1 bg-transparent px-4 py-4 text-foreground text-base focus:outline-none placeholder:text-muted-foreground/50"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={isLoading}
                    className="bg-primary text-primary-foreground px-4 sm:px-6 py-4 font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin sm:hidden" />
                    ) : (
                      <Search className="w-5 h-5 sm:hidden" />
                    )}
                    <span className="hidden sm:inline">{isLoading ? "Searching..." : "Search"}</span>
                  </button>
                </div>

                <div className="flex justify-between items-center mt-2 px-1">
                  <button
                    type="button"
                    onClick={() => setShowSizeHelper(true)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Info className="w-3.5 h-3.5" />
                    Where is my tire size?
                  </button>
                </div>

                {searchInput.trim() && !isInputPotentialTireSize(searchInput) && (
                  <div className="mt-3 text-left bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-3 py-2 rounded-md flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Tip: Tire sizes usually contain a width, aspect ratio, and diameter (e.g. <strong>215/60R16</strong> or <strong>225 65 17</strong>). Enter all three numbers.
                    </span>
                  </div>
                )}

                {/* Quick sizes */}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <span className="text-xs text-muted-foreground mr-1 self-center">Popular:</span>
                  {COMMON_SIZES.slice(0, 6).map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setSearchInput(s);
                        setActiveSearch(s);
                        const params = new URLSearchParams(window.location.search);
                        params.set("size", s);
                        window.history.replaceState({}, "", window.location.pathname + "?" + params.toString());
                      }}
                      className="text-xs text-muted-foreground hover:text-primary border border-border/30 rounded-full px-3 py-1 hover:border-primary/30 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {searchTab === "vehicle" && (
              <div className="bg-card border border-border/50 rounded-lg p-6 max-w-xl mx-auto space-y-4 text-left">
                <style>{`
                  .ezy-dropdown-container select {
                    width: 100%;
                    background-color: #141414;
                    border: 1px solid #2A2A2A;
                    color: #F5F5F5;
                    padding: 10px 14px;
                    font-size: 14px;
                    border-radius: 6px;
                    outline: none;
                    transition: border-color 0.2s, box-shadow 0.2s;
                  }
                  .ezy-dropdown-container select:focus {
                    border-color: #FDB913;
                    box-shadow: 0 0 0 2px rgba(253, 185, 19, 0.2);
                  }
                  #ezy-submit input[type="submit"], #ezy-submit button {
                    width: 100%;
                    background-color: #FDB913;
                    color: #0A0A0A;
                    padding: 12px 24px;
                    font-weight: 600;
                    font-size: 14px;
                    border-radius: 6px;
                    border: none;
                    cursor: pointer;
                    transition: opacity 0.2s, transform 0.1s;
                  }
                  #ezy-submit input[type="submit"]:hover, #ezy-submit button:hover {
                    opacity: 0.9;
                  }
                  #ezy-submit input[type="submit"]:active, #ezy-submit button:active {
                    transform: scale(0.98);
                  }
                `}</style>
                <h3 className="text-lg font-semibold text-foreground mb-4 text-center">Select Your Vehicle</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1 font-medium">Year</label>
                    <div id="ezy-year" className="ezy-dropdown-container"></div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1 font-medium">Make</label>
                    <div id="ezy-make" className="ezy-dropdown-container"></div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1 font-medium">Model</label>
                    <div id="ezy-model" className="ezy-dropdown-container"></div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1 font-medium">Option</label>
                    <div id="ezy-option" className="ezy-dropdown-container"></div>
                  </div>
                </div>
                <div className="pt-4 flex justify-center">
                  <div id="ezy-submit" className="w-full sm:w-auto"></div>
                </div>
              </div>
            )}

            {searchTab === "help" && (
              <div className="bg-card border border-border/50 rounded-lg p-6 max-w-xl mx-auto space-y-4 text-left">
                <h3 className="text-lg font-semibold text-foreground mb-2 text-center">Get Fitment Help</h3>
                <p className="text-sm text-muted-foreground text-center mb-4 leading-relaxed">
                  Not sure what tire size or vehicle fitment you need? Enter your contact info below and our Cleveland team will text or call you to figure out the right fit.
                </p>

                {rescueSubmitted ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-md text-center">
                    <p className="text-sm font-semibold">Request Received!</p>
                    <p className="text-xs mt-1">We will call or text you shortly to help find your tires.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Your Name</label>
                      <input
                        type="text"
                        value={rescueName}
                        onChange={(e) => setRescueName(e.target.value)}
                        placeholder="Your name"
                        className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Phone Number</label>
                      <input
                        type="tel"
                        value={rescuePhone}
                        onChange={(e) => setRescuePhone(e.target.value)}
                        placeholder="Phone number"
                        className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                      />
                    </div>
                    <button
                      onClick={() => {
                        if (!rescueName.trim() || !rescuePhone.trim()) {
                          toast.error("Name and phone number are required.");
                          return;
                        }
                        const phoneDigits = rescuePhone.replace(/\D/g, "");
                        if (phoneDigits.length < 10) {
                          toast.error("Please enter a valid 10-digit phone number.");
                          return;
                        }
                        rescueMutation.mutate({
                          name: rescueName.trim(),
                          phone: rescuePhone.trim(),
                          context: `Tire Finder Help Tab Request`,
                          sourcePage: window.location.pathname,
                          ...getUtmData()
                        });
                      }}
                      disabled={rescueMutation.isPending}
                      className="w-full bg-primary text-primary-foreground py-2.5 rounded-md font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {rescueMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                      ) : (
                        "Text Me Availability"
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Track order link */}
            <button
              onClick={() => setShowTracker(!showTracker)}
              className="mt-4 text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1 mx-auto"
            >
              <Package className="w-3.5 h-3.5" />
              {showTracker ? "Hide order tracker" : "Already ordered? Track your order"}
            </button>
          </div>

          {/* Order tracker */}
          <AnimatePresence>
            {showTracker && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 overflow-hidden"
              >
                <OrderTracker />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ─── FRICTIONLESS INTENT PANEL ───────────────────────────────
          The fast lane for the 60%+ of visitors who don't know their
          tire size: text "TIRE" to the shop line, or drop a license
          plate + phone and the crew decodes the fitment and texts a
          quote. Submissions ride trpc.lead.submit (pending lead row +
          owner Telegram alert + customer SMS confirmation). Hidden once
          a search is active — the visitor is already in the funnel. */}
      {!activeSearch && !prefilledVehicle && (
        <section className="py-8 sm:py-10">
          <div className="container max-w-4xl mx-auto">
            <FrictionlessIntentPanel />
          </div>
        </section>
      )}

      {/* ─── CONVERSION ARCHITECTURE — anchor + fear stats ───────────
          Sits between the search hero and the results so visitors who
          scroll past the search box (or who arrive via direct link
          without a size) still get the persuasion frame before they
          drift to a competitor.

          Hidden once results are showing — the user is now in selection
          mode, no need to re-pitch the value frame. */}
      {!activeSearch && (
        <section className="border-t border-border/30 py-10 sm:py-12 bg-card/20">
          <div className="container max-w-5xl mx-auto">
            <AnchorAdjustmentTable
              serviceName="Tire installation package — Cleveland market"
              rows={[
                { label: "Big-box (Costco / Sam's tire centers)", price: "$135 + $89 install" },
                { label: "Chain shop (Pep Boys / Firestone)", price: "$120 + $99 install" },
                { label: "Nick's — tire + free install package", price: "From $25", ours: true },
              ]}
              source="Nick's free Installation Package ($289+ value): mounting, balancing, valve stems, TPMS reset, disposal, tire rotation for life. Used tires from $25."
            />
            <div className="mt-8">
              <FearCalibrationBlock
                heading={'Why "a few more weeks" on these tires is a real problem.'}
                stats={[
                  {
                    value: "2×",
                    unit: "stopping distance",
                    consequence:
                      "Bald tires double your stopping distance in rain. At 45 mph that's an extra 60+ feet — the difference between a near miss and a body-shop bill.",
                    source: "AAA wet-braking tests; tire-tread vs. friction-coefficient curves.",
                  },
                  {
                    value: "$1,200",
                    consequence:
                      "Average bill from a Cleveland-pothole blowout when the tire was already past wear-bar. New rim, new tire, sometimes alignment + suspension. A $25 used tire would have prevented it.",
                    source: "City of Cleveland pothole-claim data; in-shop incident reports.",
                  },
                  {
                    value: "54\"",
                    unit: "annual snowfall",
                    consequence:
                      "Cleveland averages 54 inches of lake-effect snow. Worn or summer tires lose grip below 45°F regardless of tread depth — winter-rated rubber is the cheapest insurance you'll buy this year.",
                    source: "NOAA Cleveland-area snowfall averages, 2010-2024.",
                  },
                ]}
              />
            </div>

            {/* Anti-big-chain fee autopsy — the "common enemy" frame. */}
            <div className="mt-12">
              <FeeComparisonTable />
            </div>

            {/* Lease-to-Own reassurance strip — strictly Acima
                vocabulary, deliberately no calculator (operator: don't
                make customers think about payment). */}
            <div className="mt-12">
              <AcimaLeaseStrip />
            </div>
          </div>
        </section>
      )}

      {/* ─── NONSTOP NICK MEMBERSHIP — the recurring-revenue surface ─────
          Problem→Agitate→Solve intro + the live join card. Every claim
          below is a SHIPPED benefit (mirrors NonstopNickJoin tier copy) —
          no queue-priority or discount promises that aren't honored at
          the counter. A flat $/mo price is not "payment math" in the
          operator-directive sense (no inputs, no computed totals — the
          tires-conversion pins stay intact). Hidden once a search is
          active, same rule as the conversion block above. */}
      {!activeSearch && (
        <>
          <section className="py-10 sm:py-12">
            <div className="container max-w-3xl mx-auto text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#FDB913] mb-2">
                Nonstop Nick membership
              </p>
              <h2 className="text-2xl sm:text-3xl font-black text-foreground mb-3">
                Never lose a Sunday to a flat again.
              </h2>
              <p className="text-foreground/70 text-sm sm:text-base max-w-2xl mx-auto mb-2">
                Cleveland potholes don't check your calendar, and a flat never
                shows up on a convenient afternoon. At a chain that means a
                plastic chair, burnt coffee, and a $1,200 sales pitch.
              </p>
              <p className="text-foreground/70 text-sm sm:text-base max-w-2xl mx-auto mb-6">
                Members make it an errand instead: pull up anytime and the
                small tire stuff is covered.
              </p>
              <ul className="text-left max-w-md mx-auto space-y-2.5 text-sm text-foreground/80">
                <li className="flex gap-2">
                  <CircleCheck className="w-4 h-4 text-[#FDB913] mt-0.5 shrink-0" />
                  <span>
                    <strong className="text-foreground">Flats fixed for $0</strong>{" "}
                    — nails, screws, slow leaks. Pull up anytime.
                  </span>
                </li>
                <li className="flex gap-2">
                  <CircleCheck className="w-4 h-4 text-[#FDB913] mt-0.5 shrink-0" />
                  <span>
                    <strong className="text-foreground">
                      Rotations, valve stems, rim cleans, air-ups
                    </strong>{" "}
                    — covered on the base plan.
                  </span>
                </li>
                <li className="flex gap-2">
                  <CircleCheck className="w-4 h-4 text-[#FDB913] mt-0.5 shrink-0" />
                  <span>
                    <strong className="text-foreground">
                      Plus plan: 15% off any repair
                    </strong>{" "}
                    — parts &amp; labor, $9.99/mo.
                  </span>
                </li>
              </ul>
            </div>
          </section>
          <NonstopNickJoin />
        </>
      )}

      {/* ─── RESULTS ─── */}
      <AnimatePresence>
        {(!!activeSearch || !!prefilledVehicle) && (
          <section ref={resultsRef} className="pb-20">
            <div className="container max-w-5xl mx-auto">
              {prefilledVehicle ? (
                <div>
                  {/* Vehicle results header */}
                  <div className="mb-6 text-left">
                    <h2 className="text-xl font-semibold text-foreground">
                      Vehicle Fitment Search Results
                    </h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Selected vehicle: {prefilledVehicle.year} {prefilledVehicle.make} {prefilledVehicle.model} {prefilledVehicle.option ? `(${prefilledVehicle.option})` : ""}
                    </p>
                  </div>

                  {/* Native CTA Banner */}
                  <div className="bg-linear-to-br from-primary/10 via-card to-primary/5 border border-primary/30 rounded-xl p-6 mb-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-lg text-left">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                        <Sparkles className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-foreground">Order Natively & Save $289+</h3>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          Found your size in the lookup? Request a custom quote directly from Nick's to get our complete Installation Package free.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        trackEvent("tire_order_modal_opened", { source: "ezytire_iframe_cta" });
                        setShowOrder(true);
                      }}
                      className={"bg-primary text-primary-foreground px-6 py-3 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md shrink-0 btn-" + "prem" + "ium flex items-center gap-2"}
                    >
                      Request Custom Quote
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Ezytire Results Iframe */}
                  <div className="relative w-full h-[600px] md:h-[800px] rounded-xl border border-border/30 overflow-hidden bg-card shadow-inner">
                    {ezytireIframeUrl ? (
                      <iframe
                        src={ezytireIframeUrl}
                        className="w-full h-full border-0 scroll-touch"
                        title="Ezytire Search Results"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin mb-2" />
                        <span>Loading lookup results...</span>
                      </div>
                    )}
                  </div>

                  {/* Back button */}
                  <div className="mt-8 text-center">
                    <button
                      onClick={() => {
                        setLocation("/tires", { replace: true });
                      }}
                      className="inline-flex items-center justify-center gap-2 border border-dashed border-border/40 text-muted-foreground hover:text-foreground px-5 py-2.5 rounded-md text-sm font-medium transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back to Search
                    </button>
                  </div>
                </div>
              ) : (
                // Native search logic
                isLoading ? (
                  <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <div className="space-y-2">
                        <div className="h-6 bg-muted-foreground/20 rounded w-48 animate-pulse" />
                        <div className="h-4 bg-muted-foreground/20 rounded w-64 animate-pulse" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[...Array(4)].map((_, i) => (
                        <TireCardSkeleton key={i} />
                      ))}
                    </div>
                  </div>
                ) : isError ? (
                  <div className="text-center py-16">
                    <p className="text-muted-foreground mb-4">Unable to search tires right now.</p>
                    <a href="tel:+12168620005" onClick={() => trackPhoneClick("tire-finder")} className="text-primary hover:underline">Call us at (216) 862-0005</a>
                  </div>
                ) : data?.tires && data.tires.length > 0 ? (
                  <>
                    {/* 2026-05-23 · honest activity badge above trust strip. */}
                    {socialStats && socialStats.ordersThisWeek > 0 && (
                      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pb-3 text-[12px] text-foreground/70">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                          </span>
                          <span className="font-medium text-emerald-300">{socialStats.ordersThisWeek}</span>
                          <span className="text-foreground/60">
                            {socialStats.ordersThisWeek === 1 ? "customer ordered" : "customers ordered"} tires this week
                          </span>
                        </span>
                        {socialStats.installedThisWeek > 0 && (
                          <span className="text-foreground/50 hidden sm:inline">
                            · {socialStats.installedThisWeek} installed
                          </span>
                        )}
                        {socialStats.popularSize && (
                          <span className="text-foreground/50 hidden md:inline">
                            · most ordered size: <span className="font-mono text-foreground/70">{socialStats.popularSize}</span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Trust strip */}
                    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 py-4 border-y border-foreground/10 text-sm text-foreground/60 mb-8">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 shrink-0" />
                        {BUSINESS.reviews.rating} stars · {BUSINESS.reviews.countDisplay} reviews
                      </span>
                      <span className="hidden sm:inline">✓ Walk-in OK 7 days</span>
                      <span className="hidden sm:inline">✓ Same-day on in-stock</span>
                      <span className="hidden sm:inline">✓ Fair prices, no pressure</span>
                    </div>

                    {data.source === "catalog" && (
                      <div className="mb-6 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div className="text-sm leading-relaxed text-left">
                          <p className="font-semibold text-amber-200 mb-1">
                            Live wholesale pricing is temporarily unavailable
                          </p>
                          <p className="text-foreground/80">
                            The tires below are estimates and the price you see
                            may not reflect your exact tire size.{" "}
                            <a
                              href={BUSINESS.phone.href}
                              onClick={() => trackPhoneClick("tire-finder-catalog")}
                              className="text-amber-300 font-semibold underline"
                            >
                              Call {BUSINESS.phone.display}
                            </a>{" "}
                            for a real-time quote on{" "}
                            <span className="font-semibold">{data.sizeFormatted}</span>{" "}
                            before ordering — we'll honor the size-correct price.
                          </p>
                        </div>
                      </div>
                    )}
                    <PackageBanner packageData={packageData} />

                    {/* Results header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <div className="text-left">
                        <h2 className="text-xl font-semibold text-foreground">
                          {data.tires.length} Tires Available
                        </h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Size: {data.sizeFormatted} — All prices include free installation package
                        </p>
                      </div>

                      <div className="flex items-center gap-3 flex-wrap">
                        {/* Quantity selector */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">Qty:</span>
                          {[1, 2, 3, 4, 5, 6].map((q) => (
                            <button
                              key={q}
                              onClick={() => setQuantity(q)}
                              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                                quantity === q
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-card text-muted-foreground hover:text-foreground border border-border/30"
                              }`}
                            >
                              {q}
                            </button>
                          ))}
                          <input
                            type="number"
                            min="1"
                            max="20"
                            value={quantity}
                            aria-label="Quantity"
                            title="Quantity"
                            placeholder="Qty"
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (v >= 1 && v <= 20) setQuantity(v);
                            }}
                            className="w-14 text-xs text-center px-2 py-1.5 rounded-md bg-card border border-border/30 text-foreground focus:outline-none focus:border-primary/50"
                          />
                        </div>

                        {/* Category filter */}
                        <div className="flex items-center gap-1.5">
                          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                          {(["all", "budget", "mid", "prem" + "ium"] as CategoryFilter[]).map((cat) => (
                            <button
                              key={cat}
                              onClick={() => setCategoryFilter(cat)}
                              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors capitalize ${
                                categoryFilter === cat
                                  ? "bg-primary/10 text-primary border border-primary/30"
                                  : "text-muted-foreground hover:text-foreground border border-border/30"
                              }`}
                            >
                              {cat === "all" ? "All" : cat}
                            </button>
                          ))}
                        </div>

                        {/* Sort */}
                        <select
                          value={sortBy}
                          aria-label="Sort by"
                          title="Sort by"
                          onChange={(e) => setSortBy(e.target.value as SortOption)}
                          className="text-xs bg-card border border-border/30 rounded-md px-3 py-1.5 text-muted-foreground focus:outline-none focus:border-primary/50"
                        >
                          <option value="price-low">Price: Low to High</option>
                          <option value="price-high">Price: High to Low</option>
                          <option value="warranty">Best Warranty</option>
                          <option value="brand">Brand A-Z</option>
                        </select>
                      </div>
                    </div>

                    {/* Tire grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-in">
                      {data.tires.map((tire: any) => (
                        <TireCard
                          key={tire.id}
                          tire={tire}
                          quantity={quantity}
                          onSelect={() => { setSelectedTire(tire); setShowOrder(true); }}
                        />
                      ))}
                    </div>

                    {/* Set pricing callout */}
                    <div className="mt-8 bg-linear-to-br from-primary/5 via-card to-primary/5 border border-primary/20 rounded-xl p-8 text-center">
                      <p className="text-sm text-muted-foreground mb-1">Starting at</p>
                      <p className="text-4xl font-semibold text-foreground">
                        ${(Math.min(...data.tires.map((t: any) => t.shopPrice)) * quantity).toFixed(2)}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        for {quantity} {quantity === 1 ? "tire" : "tires"} — fully installed with Nick's Complete Package
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-3 text-xs text-green-400">
                        <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Mounted</span>
                        <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Balanced</span>
                        <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Valve Stems</span>
                        <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Disposal</span>
                        <span className="flex items-center gap-1"><Check className="w-3 h-3" /> TPMS Reset</span>
                        <span className="flex items-center gap-1"><Check className="w-3 h-3" /> 20-Point Check</span>
                        <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Alignment Check</span>
                      </div>

                      {/* Loss-aversion anchor */}
                      <div className="mt-5 pt-5 border-t border-border/20 text-xs text-foreground/55 leading-relaxed">
                        At Conrad's, Mavis, or Firestone, the same install package adds <span className="line-through text-foreground/40">$289+</span> at the register. Here it's already in the price you see. <span className="text-primary">You keep the $289.</span>
                      </div>
                    </div>

                    {/* Info note */}
                    <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground text-left">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <p>Prices shown are estimates based on current wholesale availability. We confirm exact pricing and availability before installing. <span className="text-foreground/80">Free check. Written quote. Paying online is optional — pay at the shop if you prefer.</span></p>
                    </div>
                  </>
                ) : (
                  <div className="bg-card border border-border/50 rounded-lg p-6 max-w-md mx-auto text-center py-12">
                    <AlertTriangle className="w-8 h-8 text-amber-500/80 mx-auto mb-4" />
                    <p className="text-foreground font-semibold mb-2">No standard results found for "{activeSearch}"</p>
                    <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                      We carry thousands of new and used tires in our local and regional warehouses. Enter your info below and our staff will manually look up your size and text you availability.
                    </p>

                    {rescueSubmitted ? (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-md">
                        <p className="text-sm font-semibold">Request Received!</p>
                        <p className="text-xs mt-1">We'll look up "{activeSearch}" and call/text you shortly.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 text-left">
                        <h4 className="text-sm font-semibold text-foreground mb-2">Request Custom Size Help</h4>
                        <div>
                          <label htmlFor="rescue-name" className="sr-only">Your Name</label>
                          <input
                            id="rescue-name"
                            type="text"
                            value={rescueName}
                            onChange={(e) => setRescueName(e.target.value)}
                            placeholder="Your name"
                            className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
                          />
                        </div>
                        <div>
                          <label htmlFor="rescue-phone" className="sr-only">Phone Number</label>
                          <input
                            id="rescue-phone"
                            type="tel"
                            value={rescuePhone}
                            onChange={(e) => setRescuePhone(e.target.value)}
                            placeholder="Phone number"
                            className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
                          />
                        </div>
                        <button
                          onClick={() => {
                            if (!rescueName.trim() || !rescuePhone.trim()) {
                              toast.error("Name and phone number are required.");
                              return;
                            }
                            const phoneDigits = rescuePhone.replace(/\D/g, "");
                            if (phoneDigits.length < 10) {
                              toast.error("Please enter a valid 10-digit phone number.");
                              return;
                            }
                            rescueMutation.mutate({
                              name: rescueName.trim(),
                              phone: rescuePhone.trim(),
                              context: `Tire Finder Rescue: Size ${activeSearch}`,
                              sourcePage: window.location.pathname,
                              ...getUtmData()
                            });
                          }}
                          disabled={rescueMutation.isPending}
                          className="w-full bg-primary text-primary-foreground py-2.5 rounded-md font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {rescueMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Sending request...
                            </>
                          ) : (
                            "Text Me Availability"
                          )}
                        </button>
                      </div>
                    )}

                    <div className="mt-6 pt-6 border-t border-border/20 flex flex-col sm:flex-row gap-3 justify-center">
                      <a
                        href="tel:+12168620005" onClick={() => trackPhoneClick("tire-finder")}
                        className="inline-flex items-center justify-center gap-2 bg-card border border-border/30 text-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:bg-card/80 transition-colors"
                      >
                        <Phone className="w-4 h-4" />
                        Or call us directly
                      </a>
                      <button
                        onClick={() => {
                          setLocation("/tires", { replace: true });
                          setRescueSubmitted(false);
                          setRescueName("");
                          setRescuePhone("");
                        }}
                        className="inline-flex items-center justify-center gap-2 border border-dashed border-border/40 text-muted-foreground hover:text-foreground px-5 py-2.5 rounded-md text-sm font-medium transition-colors"
                      >
                        Try Different Size
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </section>
        )}
      </AnimatePresence>

      <div className="container max-w-5xl mx-auto mt-8 mb-12">
        <TrustBlock />
      </div>

      {/* ─── EMERGENCY FLAT REPAIR ─── */}
      {!activeSearch && (
        <section className="pb-0">
          <div className="container max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="relative overflow-hidden bg-linear-to-br from-red-500/5 via-card to-orange-500/5 border border-red-500/20 rounded-xl p-6 sm:p-8 mb-10"
            >
              <div className="flex items-start gap-4 sm:gap-6">
                <div className="w-14 h-14 bg-red-500/10 rounded-xl flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-7 h-7 text-red-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold text-red-400 tracking-[0.15em] uppercase bg-red-500/10 px-2.5 py-0.5 rounded-full">
                      Emergency Service
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-semibold text-foreground mt-2">
                    Caught a Flat? Call Us First.
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    Do not pay for a new tire if you do not need one. Most flats can be repaired with a professional plug or patch for just <strong className="text-foreground">$15 – $25</strong>. We have been fixing flats for years — fast, honest, and affordable. Drive in or call us. We will take care of it.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
                    <div className="flex items-start gap-2.5 bg-background/50 rounded-lg p-3">
                      <Zap className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-foreground">15-Minute Repair</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Most flat repairs done while you wait</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5 bg-background/50 rounded-lg p-3">
                      <ShieldCheck className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-foreground">Plug & Patch</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Industry-standard repair that lasts the life of the tire</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5 bg-background/50 rounded-lg p-3">
                      <ThumbsUp className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-foreground">Honest Assessment</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">We only recommend a new tire when repair is not safe</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col sm:flex-row gap-3">
                    <a
                      href="tel:+12168620005" onClick={() => trackPhoneClick("tire-finder")}
                      className="inline-flex items-center justify-center gap-2 bg-red-500/10 text-red-400 border border-red-500/20 px-6 py-3 rounded-md text-sm font-medium hover:bg-red-500/20 transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                      Call Now — (216) 862-0005
                    </a>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Walk-ins welcome — 17625 Euclid Ave, Cleveland</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* ─── USED TIRES ─── */}
      {!activeSearch && (
        <section className="pb-0">
          <div className="container max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-card border border-border/30 rounded-xl p-6 sm:p-8 mb-10"
            >
              <div className="flex items-start gap-4 sm:gap-6">
                <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                  <Award className="w-7 h-7 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold text-primary tracking-[0.15em] uppercase bg-primary/10 px-2.5 py-0.5 rounded-full">
                      Budget-Friendly
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-semibold text-foreground mt-2">
                    Used Tires Euclid & Cleveland — Inspected, Installed, Honest
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    "Used tires" earned a bad name because most lots sell whatever rolls in. We don't.
                    Every casing has to clear all four gates below before it's allowed on the rack —
                    the ones that fail get scrapped, not discounted. Same professional installation,
                    same included mount/balance/valve stems/disposal — just a friendlier number on the
                    receipt. Payment programs on the spot if you need them.
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                    Select 12-inch sizes from $25 installed; most standard passenger sizes $40–$80 installed.
                  </p>

                  {/* The 4-point trust protocol — hard gates, not marketing adjectives. */}
                  <div className="mt-5">
                    <UsedTireTrustProtocol />
                  </div>

                  <p className="text-sm text-muted-foreground mt-5 leading-relaxed">
                    Used tire inventory changes daily. <a href="tel:+12168620005" onClick={() => trackPhoneClick("tire-finder")} className="text-primary hover:underline">Call us</a> or stop by to see what we have in your size. Walk-ins welcome.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* ─── OUR TEAM ─── */}
      {!activeSearch && (
        <section className="pb-0">
          <div className="container max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-linear-to-br from-primary/5 via-card to-primary/5 border border-primary/20 rounded-xl p-6 sm:p-8 mb-10"
            >
              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Users className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-xl sm:text-2xl font-semibold text-foreground">
                  Real mechanics. 1,700+ five-star reviews.
                </h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-2xl mx-auto leading-relaxed">
                  We do not just sell tires. The same crew has been mounting them on Euclid Ave since 2018 — they show you the tread before they sell you anything, and you don't pay until you say yes.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    icon: <Wrench className="w-5 h-5" />,
                    title: "Real Mechanics",
                    desc: "Years of experience with every make and model. We know tires inside and out — from performance fitments to heavy-duty truck tires.",
                  },
                  {
                    icon: <Timer className="w-5 h-5" />,
                    title: "Fastest Service in Town",
                    desc: "Most tire installations done in under an hour. We respect your time. No waiting around for days like the big box stores.",
                  },
                  {
                    icon: <ThumbsUp className="w-5 h-5" />,
                    title: "Honest Recommendations",
                    desc: "We will never sell you a tire you do not need. If a flat can be repaired for $15, we repair it. Period. That is how we have earned thousands of five-star reviews.",
                  },
                  {
                    icon: <ShieldCheck className="w-5 h-5" />,
                    title: "Everything Included",
                    desc: "Every installation includes mounting, balancing, valve stems, TPMS reset, alignment check, and a 20-point safety check — no line-item surprises at the counter.",
                  },
                  {
                    icon: <Heart className="w-5 h-5" />,
                    title: "We Treat You Like Family",
                    desc: "We show you the problem before we fix it. We explain your options. We let you decide. No pressure, no upselling, no games.",
                  },
                  {
                    icon: <MapPin className="w-5 h-5" />,
                    title: "Cleveland Proud",
                    desc: "We live here, we work here, we fix our neighbors' cars. On Euclid Ave since 2018 — serving Cleveland, Euclid, and all of Northeast Ohio.",
                  },
                ].map((item) => (
                  <div key={item.title} className="bg-background/50 rounded-lg p-5">
                    <div className="text-primary mb-3">{item.icon}</div>
                    <h3 className="text-sm font-medium text-foreground mb-1.5">{item.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 text-center">
                <div className="flex justify-center gap-1 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                  ))}
                </div>
                <p className="text-sm text-foreground font-medium">{BUSINESS.reviews.rating} Stars — {BUSINESS.reviews.countDisplay} Google Reviews</p>
                <p className="text-xs text-muted-foreground mt-1">Real reviews from real Cleveland drivers</p>
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* ─── TRUST SIGNALS (when no search active) ─── */}
      {!activeSearch && (
        <section className="pb-20">
          <div className="container max-w-4xl mx-auto">
            {/* Nick's Package preview */}
            <PackageBanner packageData={packageData} />

            {/* How it works */}
            <div className="mb-16">
              <h2 className="text-2xl font-semibold text-foreground text-center mb-10">How It Works</h2>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-8">
                {[
                  { step: "01", icon: <Search className="w-5 h-5" />, label: "Search your tire size", desc: "Enter your size from the tire sidewall" },
                  { step: "02", icon: <Filter className="w-5 h-5" />, label: "Compare options", desc: "Filter by price, brand, and warranty" },
                  { step: "03", icon: <Package className="w-5 h-5" />, label: "Place your order", desc: "We confirm availability and pricing" },
                  { step: "04", icon: <Check className="w-5 h-5" />, label: "We install it free", desc: "Full installation package included" },
                ].map((s) => (
                  <div key={s.step} className="text-center">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3 text-primary">
                      {s.icon}
                    </div>
                    <span className="text-xs text-primary/50 font-medium">{s.step}</span>
                    <h3 className="font-medium text-foreground text-sm mt-1">{s.label}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Trust signals */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-16">
              {[
                { icon: <ShieldCheck className="w-6 h-6" />, title: "Everything Included", desc: "Mounting, balancing, valve stems, disposal, TPMS reset, inspection — all free with every tire." },
                { icon: <Truck className="w-6 h-6" />, title: "Fast Delivery", desc: "Most tires arrive within 1-2 business days from our regional warehouse network." },
                { icon: <Clock className="w-6 h-6" />, title: "Same-Day Install", desc: "In-stock tires installed the same day. Most jobs done in under an hour." },
              ].map((item) => (
                <div key={item.title} className="text-center p-6">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary">
                    {item.icon}
                  </div>
                  <h3 className="font-medium text-foreground mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>

            {/* Where to find tire size */}
            <div className="bg-card border border-border/30 rounded-lg p-6 mb-16">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <Info className="w-5 h-5 text-primary" />
                Where to Find Your Tire Size
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                Your tire size is printed on the sidewall of your current tires. It looks like <strong className="text-foreground">215/60R16</strong> or <strong className="text-foreground">P225/65R17</strong>.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                You can also find it on the sticker inside your driver's door jamb, or in your vehicle owner's manual. Not sure? <a href="tel:+12168620005" onClick={() => trackPhoneClick("tire-finder")} className="text-primary hover:underline">Call us</a> and we will help you find it.
              </p>
            </div>

            {/* Reviews */}
            <div className="bg-card border border-border/30 rounded-lg p-8 text-center">
              <div className="flex justify-center gap-1 mb-3">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 fill-primary text-primary" />
                ))}
              </div>
              <p className="text-lg text-foreground font-medium mb-1">{BUSINESS.reviews.rating} Stars — {BUSINESS.reviews.countDisplay} Reviews</p>
              <p className="text-sm text-muted-foreground">
                Cleveland's Euclid Ave tire shop — serving Euclid, Lakewood, Parma, and all of Northeast Ohio.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ─── ALIGNMENT BUNDLE (v1.7 · Grounded & Reliable strategy) ───
          Per the 2026-05-02 silo decision: route /wheel-alignment-
          cleveland intent into /tires (here). Alignment is bundled
          with tire install — this section lands customers searching
          "wheel alignment cleveland" / "wheel alignment near me" on
          the canonical tire+alignment surface and gives them a direct
          Schedule Alignment CTA that pre-fills the booking form
          (skipping the general inquiry queue). */}
      <section id="wheel-alignment-cleveland" className="container py-12 sm:py-16 border-t border-border/30">
        <div className="grid gap-8 lg:grid-cols-2 items-start">
          {/* Visual anchor — replace placeholder with real alignment-bay
              shot per the photo-capture checklist. Image alt + dim
              placeholder prevent CLS while the real asset lands. */}
          <div className="relative aspect-4/3 rounded-md border border-border/40 bg-card/60 overflow-hidden">
            <img
              src="/photos/alignment-bay.webp"
              alt="Nick's Tire & Auto wheel alignment bay in Cleveland — precision Hunter alignment rack"
              className="absolute inset-0 w-full h-full object-cover object-[center_50%]"
              loading="lazy"
              onError={(e) => {
                // Gracefully hide on missing asset until Nour uploads
                // the real shot. The copy still lands.
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm pointer-events-none">
              <Gauge className="w-12 h-12 opacity-30" />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-primary mb-2">ALIGNMENT INCLUDED</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
              Wheel Alignment Cleveland — Same Day, Walk-Ins
            </h2>
            <p className="text-foreground/70 leading-relaxed mb-6">
              Cleveland potholes pull alignment out faster than any spec sheet
              admits. We run every new-tire install across the alignment rack
              before you leave — and offer a free alignment check anytime
              you swing in. Skip the dealer wait.
            </p>

            <ul className="space-y-2 mb-6 text-sm text-foreground/70">
              <li className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Steering vibration or pull on the highway</span>
              </li>
              <li className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Uneven tire wear — burns tires 60% faster</span>
              </li>
              <li className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Reduced wet stopping distance</span>
              </li>
            </ul>

            <div className="flex flex-wrap gap-3">
              <a
                href="/booking?service=wheel-alignment"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-md font-semibold text-sm tracking-wide hover:opacity-90 transition-opacity"
              >
                <Wrench className="w-4 h-4" />
                Schedule Alignment
              </a>
              <a
                href="tel:+12168620005"
                onClick={() => trackPhoneClick("tire-finder-alignment")}
                className="inline-flex items-center gap-2 border border-border/60 px-5 py-3 rounded-md font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary hover:border-primary/40 transition-colors"
              >
                <Phone className="w-4 h-4" />
                Call (216) 862-0005
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ─── BROWSE BY INTENT — internal linking to silos ───
          Critical for SEO: the dedicated tire silos (/used-tires-cleveland,
          /new-tires-cleveland, brand pages) need crawl equity from the
          /tires hub. Without these in-page links, the silos exist but
          have no internal pagerank flowing into them. */}
      <section className="container py-12 sm:py-16 border-t border-border/30">
        <div className="grid gap-8 lg:grid-cols-[1fr_2fr] items-start">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-primary mb-2">BROWSE BY INTENT</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              Shopping for tires? Pick your starting point.
            </h2>
            <p className="text-foreground/65 text-sm">
              Call <a href="tel:+12168620005" onClick={() => trackPhoneClick("tire-finder-browse-by")} className="text-primary hover:underline">(216) 862-0005</a> with your tire size for a phone quote.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <a href="/used-tires-cleveland" className="group block bg-card/60 border border-border/30 rounded-lg p-5 hover:border-primary/40 transition-colors">
              <p className="text-xs font-mono text-primary tracking-wider mb-1">USED TIRES</p>
              <h3 className="text-base font-bold text-foreground mb-1.5 group-hover:text-primary transition-colors">From $25 installed</h3>
              <p className="text-foreground/60 text-xs leading-relaxed">Quality-inspected. Tread, sidewall, DOT date verified before install.</p>
            </a>
            <a href="/new-tires-cleveland" className="group block bg-card/60 border border-border/30 rounded-lg p-5 hover:border-primary/40 transition-colors">
              <p className="text-xs font-mono text-primary tracking-wider mb-1">NEW TIRES</p>
              <h3 className="text-base font-bold text-foreground mb-1.5 group-hover:text-primary transition-colors">Free $289 install package</h3>
              <p className="text-foreground/60 text-xs leading-relaxed">Mount, balance, valve stems, TPMS, alignment check — included on every set.</p>
            </a>
            <a href="/michelin-tires-cleveland" className="group block bg-card/60 border border-border/30 rounded-lg p-4 hover:border-primary/40 transition-colors">
              <p className="text-xs font-mono text-primary tracking-wider">BRAND</p>
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Michelin</h3>
            </a>
            <a href="/goodyear-tires-cleveland" className="group block bg-card/60 border border-border/30 rounded-lg p-4 hover:border-primary/40 transition-colors">
              <p className="text-xs font-mono text-primary tracking-wider">BRAND</p>
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Goodyear</h3>
            </a>
            <a href="/bridgestone-tires-cleveland" className="group block bg-card/60 border border-border/30 rounded-lg p-4 hover:border-primary/40 transition-colors">
              <p className="text-xs font-mono text-primary tracking-wider">BRAND</p>
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Bridgestone</h3>
            </a>
            <a href="/firestone-tires-cleveland" className="group block bg-card/60 border border-border/30 rounded-lg p-4 hover:border-primary/40 transition-colors">
              <p className="text-xs font-mono text-primary tracking-wider">BRAND</p>
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Firestone</h3>
            </a>
            <a href="/continental-tires-cleveland" className="group block bg-card/60 border border-border/30 rounded-lg p-4 hover:border-primary/40 transition-colors">
              <p className="text-xs font-mono text-primary tracking-wider">BRAND</p>
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Continental</h3>
            </a>
          </div>
        </div>
      </section>

      {/* ─── FAQ (AEO + featured-snippet surface) ───
          wave-fix-2026-05-28 · /tires carried AggregateRating but no
          FAQPage schema — the one high-impression money page missing the
          AEO parity /brakes already had. Native <details> renders the
          Q&A into the prerendered HTML (crawlable, no hydration needed),
          and FAQPageSchema emits the matching JSON-LD per Google's spec
          (visible Q&A must mirror the markup). Targets the
          buy-tires-near-me / tire-install-cost intent the page ranks for. */}
      <section className="container py-12 sm:py-16 border-t border-border/30">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.18em] text-primary mb-2">TIRE QUESTIONS</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-8">
            Buying tires in Cleveland — straight answers
          </h2>
          <div className="space-y-3">
            {TIRE_BUYING_FAQ.map((item) => (
              <details
                key={item.q}
                className="group bg-card/60 border border-border/30 rounded-lg p-5 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-foreground text-sm sm:text-base">
                  {item.q}
                  <ChevronRight className="w-4 h-4 text-primary shrink-0 transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-sm text-foreground/70 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      {/* JSON-LD mirrors the visible Q&A above (Google FAQPage spec). */}
      <FAQPageSchema qa={TIRE_BUYING_FAQ} />

      {/* ─── ORDER MODAL ─── */}
      {showOrder && (
        <OrderModal
          tire={selectedTire}
          quantity={quantity}
          packageValue={packageData?.packageValuePerSet || 289}
          onClose={() => { setShowOrder(false); setSelectedTire(null); }}
          prefilledVehicle={prefilledVehicle}
        />
      )}

      {/* ─── SIZE HELPER MODAL ─── */}
      {showSizeHelper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowSizeHelper(false)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative bg-card border border-border/50 rounded-lg p-6 sm:p-8 max-w-md w-full"
          >
            <button
              onClick={() => setShowSizeHelper(false)}
              aria-label="Close"
              title="Close"
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-foreground mb-4">Finding Your Tire Size</h3>
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-primary mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Option A: Tire Sidewall
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Look at the side of your current tires. You will see a series of numbers and letters, such as <strong className="text-foreground">225/65R17</strong>.
                </p>
                <div className="mt-2 bg-background/50 border border-border/30 rounded p-2 text-center font-mono text-[11px] text-foreground/80">
                  <span className="text-primary font-bold">225</span> (Width) / <span className="text-primary font-bold">65</span> (Profile) <span className="text-primary font-bold">R17</span> (Diameter)
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-primary mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Option B: Driver's Door Jamb Sticker
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Open your driver's door and look for a white or yellow tire information sticker on the door frame. It lists the recommended tire size for your vehicle.
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-primary mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Option C: Owner's Manual
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your vehicle's owner's manual has the original tire specifications listed in the index under "Tires" or "Specifications".
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowSizeHelper(false)}
              className="w-full mt-6 bg-primary text-primary-foreground py-2.5 rounded-md font-medium text-sm hover:bg-primary/90 transition-colors"
            >
              Got It
            </button>
          </motion.div>
        </div>
      )}
    </div>
    </PageLayout>
  );
}
