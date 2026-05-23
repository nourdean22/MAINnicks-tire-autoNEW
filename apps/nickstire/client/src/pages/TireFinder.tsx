/**
 * TIRE FINDER — Full e-commerce tire ordering with Nick's Premium Installation Package
 * 
 * STRATEGY: 100% markup on wholesale cost. $0 service fee.
 * Everything is "FREE" via the Nick's Premium Installation Package.
 * The package is so massive ($289+ value) that customers stop caring about tire price.
 * The psychology: "I'd be stupid NOT to buy from Nick's."
 */

import { useState, useRef, useEffect, useMemo } from "react";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { trackPhoneClick } from "@/lib/analytics";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FinancingCTA from "@/components/FinancingCTA";
// Conversion-architecture overlays (Batch 3 of v1.1 spec). Injected as a
// compact block right after the search hero so visitors see anchor pricing
// + fear stats before they get lost in size selection.
import AnchorAdjustmentTable from "@/components/conversion/AnchorAdjustmentTable";
import FearCalibrationBlock from "@/components/conversion/FearCalibrationBlock";
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
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-card to-primary/5 border border-primary/20 rounded-xl">
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
}

// Exported so the Esc-key regression test (admin.test.tsx) can render
// this in isolation; in app code it stays an internal component of
// TireFinder. Same module surface, no behavior change.
export function OrderModal({ tire, quantity, packageValue, onClose }: OrderModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"walk-in" | "drop-off-morning" | "drop-off-afternoon" | "ship">("walk-in");
  const [shippingAddress, setShippingAddress] = useState("");
  const [orderResult, setOrderResult] = useState<{ orderNumber: string; invoiceNumber?: string; totalAmount: number } | null>(null);
  const [paymentSubmitted] = useState(false);

  const orderMutation = trpc.gatewayTire.placeOrder.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setOrderResult({ orderNumber: data.orderNumber!, invoiceNumber: data.invoiceNumber, totalAmount: data.totalAmount! });
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

  if (!tire) return null;

  const tireTotal = tire.shopPrice * quantity;
  const bd = priceBreakdown(tire.pricePerTireCents * quantity);

  // Success state
  if (orderResult) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-card border border-border/50 rounded-lg p-8 max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <h3 className="text-2xl font-semibold text-foreground mb-2">Order Placed</h3>
          <p className="text-sm text-primary font-medium mb-1">Order #{orderResult.orderNumber}</p>
          {orderResult.invoiceNumber && (
            <p className="text-xs text-muted-foreground mb-2">Invoice: {orderResult.invoiceNumber}</p>
          )}

          {/* Payment options */}
          {!paymentSubmitted && (
            <div className="bg-primary/5 border border-primary/20 rounded-md p-4 mb-4">
              <p className="text-xs font-semibold text-primary mb-3">Pay for Your Order:</p>

              {/* Primary — pay online via Stripe's hosted secure checkout */}
              <button
                onClick={() => checkoutMutation.mutate({ orderNumber: orderResult.orderNumber, phone })}
                disabled={checkoutMutation.isPending}
                className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground py-3 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {checkoutMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Starting secure checkout…</>
                ) : (
                  <>Pay Now — ${(bd.total / 100).toFixed(2)}</>
                )}
              </button>
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                Secure card payment by Stripe. Your card details never touch our site.
              </p>

              {/* Secondary — pay by phone */}
              <a
                href="tel:+12168620005" onClick={() => trackPhoneClick("tire-finder")}
                className="block w-full text-center border border-border/50 text-foreground py-2.5 rounded-md text-sm font-medium hover:bg-card/80 transition-colors mt-3"
              >
                Or call to pay — (216) 862-0005
              </a>

              <div className="border-t border-border/20 mt-4 pt-3">
                <p className="text-[11px] text-muted-foreground mb-2 text-center">Need financing instead?</p>
                <div className="flex gap-2">
                  <a
                    href="https://getsnap.snapfinance.com/lease/en-US/consumer/apply?ep=store-locator&merchantId=490295617&externalMerchantId=77661"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center bg-[#FF6B00] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[#FF6B00]/90 transition-colors"
                  >
                    Snap Finance
                  </a>
                  <a
                    href="https://acima.us/1TjEOYtr6C"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center bg-blue-600 text-white py-2.5 rounded-md text-sm font-medium hover:bg-blue-600/90 transition-colors"
                  >
                    Acima Credit
                  </a>
                </div>
                <p className="text-[9px] text-muted-foreground text-center mt-1">
                  Apply in seconds. No hard credit check.
                </p>
              </div>
            </div>
          )}
          <p className="text-muted-foreground mb-6 leading-relaxed text-sm">
            {deliveryMethod === "ship"
              ? "We'll confirm availability and contact you within 1 business hour with shipping cost. Payment required before shipping."
              : deliveryMethod.startsWith("drop-off")
              ? "We'll confirm availability and contact you within 1 business hour. Drop off your vehicle and we'll get it done — your spot is held in line!"
              : "We'll confirm availability and contact you within 1 business hour. Walk in anytime we're open — first come first serve!"}
          </p>
          <div className="bg-background/50 border border-border/30 rounded-md p-4 mb-6 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{quantity}x {tire.brand} {tire.model}</span>
              <span className="text-foreground font-medium">${(bd.subtotal / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Nick's Premium Installation Package</span>
              <span className="text-green-400 font-medium">FREE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ohio sales tax (8%)</span>
              <span className="text-foreground">${(bd.tax / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Card processing fee (2%)</span>
              <span className="text-foreground">${(bd.cardFee / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border/30">
              <span className="font-medium text-foreground">Total</span>
              <span className="font-semibold text-primary">${(bd.total / 100).toFixed(2)}</span>
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
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-semibold text-foreground mb-1">Order Tires</h3>
        <p className="text-muted-foreground text-sm mb-6">{quantity}x {tire.brand} {tire.model} ({tire.size})</p>

        {/* Price breakdown — the psychology */}
        <div className="bg-background/50 border border-border/30 rounded-md p-4 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">{tire.brand} {tire.model} x{quantity}</span>
            <span className="text-foreground font-medium">${tireTotal.toFixed(2)}</span>
          </div>

          {/* FREE package — this is the genius part */}
          <div className="border-t border-border/20 mt-2 pt-2 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Professional Mounting x{quantity}</span>
              <span className="text-green-400 font-medium line-through-none">FREE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Computer Balancing x{quantity}</span>
              <span className="text-green-400 font-medium">FREE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">New Valve Stems x{quantity}</span>
              <span className="text-green-400 font-medium">FREE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tire Disposal & Recycling x{quantity}</span>
              <span className="text-green-400 font-medium">FREE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">TPMS Sensor Reset</span>
              <span className="text-green-400 font-medium">FREE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">20-Point Safety Inspection</span>
              <span className="text-green-400 font-medium">FREE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Alignment Check</span>
              <span className="text-green-400 font-medium">FREE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">1-Year Free Rotation & Flat Repair</span>
              <span className="text-green-400 font-medium">FREE</span>
            </div>
          </div>

          <div className="border-t border-border/30 mt-3 pt-3 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Installation package value</span>
              <span className="line-through">${packageValue}+</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tires x{quantity}</span>
              <span className="text-foreground">${(bd.subtotal / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ohio sales tax (8%)</span>
              <span className="text-foreground">${(bd.tax / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Card processing fee (2%)</span>
              <span className="text-foreground">${(bd.cardFee / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-1.5 border-t border-border/20">
              <span className="font-medium text-foreground">Your Total</span>
              <span className="font-semibold text-primary text-lg">${(bd.total / 100).toFixed(2)}</span>
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
              { id: "walk-in" as const, icon: "🏪", title: "Walk In", desc: "Come anytime we're open", note: "FREE install" },
              { id: "drop-off-morning" as const, icon: "🌅", title: "Drop Off AM", desc: "Leave it before noon", note: "FREE install" },
              { id: "drop-off-afternoon" as const, icon: "🌇", title: "Drop Off PM", desc: "Leave it afternoon", note: "FREE install" },
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
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Phone Number *</label>
            <input
              type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder={BUSINESS.phone.placeholder}
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Email (for order updates)</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="john@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Vehicle (Year Make Model)</label>
            <input
              type="text" value={vehicle} onChange={(e) => setVehicle(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="2020 Honda Civic"
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
            const phoneDigits = phone.replace(/\D/g, "");
            if (!name.trim() || phoneDigits.length < 10) {
              toast.error(!name.trim() ? "Name is required." : "Please enter a valid 10-digit phone number");
              return;
            }
            if (deliveryMethod === "ship" && !shippingAddress.trim()) {
              toast.error("Shipping address is required for delivery orders.");
              return;
            }
            const deliveryNote = deliveryMethod === "ship"
              ? `[SHIP TO: ${shippingAddress.trim()}] ${notes.trim()}`
              : notes.trim();
            orderMutation.mutate({
              tireBrand: tire.brand,
              tireModel: tire.model,
              tireSize: tire.size,
              quantity,
              pricePerTireCents: tire.pricePerTireCents,
              customerName: name.trim(),
              customerPhone: phone.trim(),
              customerEmail: email.trim() || undefined,
              vehicleInfo: vehicle.trim() || undefined,
              customerNotes: deliveryNote || undefined,
              installPreference: deliveryMethod,
            });
          }}
          disabled={orderMutation.isPending}
          className="w-full mt-6 bg-primary text-primary-foreground py-3.5 rounded-md font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {orderMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Placing Order...</>
          ) : (
            <>Place Order — ${(bd.total / 100).toFixed(2)}</>
          )}
        </button>

        <p className="text-xs text-muted-foreground text-center mt-4">
          No charge until we confirm. We verify pricing and availability before processing.
        </p>
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
      className="group bg-card border border-border/30 rounded-lg p-5 hover:border-primary/30 transition-all duration-200 card-gold-hover"
    >
      {/* Header with brand logo */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-medium tracking-wider uppercase px-2 py-0.5 rounded-full ${cat.color}`}>
              {cat.label}
            </span>
            {tire.inStock && (
              <span className="text-[10px] font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CircleDot className="w-2.5 h-2.5" /> In Stock
              </span>
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
      <div className="bg-green-500/5 border border-green-500/10 rounded-md px-3 py-2 mb-4">
        <div className="flex items-center gap-1.5">
          <Gift className="w-3.5 h-3.5 text-green-400" />
          <span className="text-[10px] font-medium text-green-400">FREE Installation Package Included</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 ml-5">
          Mounting, balancing, valve stems, disposal, TPMS reset, inspection & more
        </p>
      </div>

      {/* Price + CTA */}
      <div className="flex items-end justify-between pt-3 border-t border-border/20">
        <div>
          <span className="text-2xl font-semibold text-foreground">${tire.shopPrice.toFixed(2)}</span>
          <span className="text-xs text-muted-foreground ml-1">/tire</span>
          <p className="text-xs text-muted-foreground mt-0.5">${setPrice} for {quantity} {quantity === 1 ? "tire" : "tires"} — installed</p>
        </div>
        <button
          onClick={onSelect}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors btn-premium"
        >
          Order
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
  // Read ?size= from URL for shareable/bookmarkable searches
  const urlSize = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("size") : null;
  const [searchInput, setSearchInput] = useState(urlSize || "");
  const [activeSearch, setActiveSearch] = useState(urlSize || "");
  const [quantity, setQuantity] = useState(4);
  const [sortBy, setSortBy] = useState<SortOption>("price-low");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedTire, setSelectedTire] = useState<any>(null);
  const [showOrder, setShowOrder] = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

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
    setActiveSearch(searchInput.trim());
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
    } else if (paid === "0" && order) {
      toast(`Payment cancelled — order ${order} is still saved. You can pay anytime.`);
    }
  }, []);

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="Tire Shop Near Me · New & Used · Free Install | Cleveland | Nick's"
        description="Cleveland's neighborhood tire shop on Euclid Ave. New & used tires, free install package on every set — mount, balance, valve stems, TPMS, alignment check. Walk-ins 7 days, payment programs on the spot. The shop your grandfather would've trusted, with the gear your kid's Tesla needs. (216) 862-0005"
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
              "Used tires from $40 installed, new tires from $80. Free mount, balance, valve stems, TPMS reset, alignment check on every set. Cleveland's first-come-first-served tire shop on Euclid Ave.",
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
      {/* pt bumped from pt-8 to pt-24 (and sm:pt-12 to sm:pt-28) so the
          eyebrow ("CLEVELAND TIRE SHOP · ...") clears the fixed navbar's
          brand-mark when the closed-banner is active. On mobile the
          banner pushes the nav to top-[56px]; the brand-mark inside the
          nav reached the lower edge of the eyebrow's first character
          ("C") in the rendered layout. +64px (mobile) / +64px (sm) of
          additional top padding solves it without disrupting the
          centered-text layout. Direct mobile-viewport audit found it. */}
      <section className="pt-24 pb-12 sm:pt-28 sm:pb-16">
        <div className="container max-w-3xl mx-auto text-center">
          {/* wave-146 — was initial={{opacity:0,y:20}} which hid the H1
              until JS hydrated, delaying measured LCP. Hero H1 is the
              LCP candidate on TireFinder (no above-fold image). Now: starts
              visible; the y:20 animation still plays after first paint. */}
          <motion.div initial={{ opacity: 1, y: 0 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0 }}>
            <span className="text-xs font-medium text-primary tracking-[0.2em] uppercase">Cleveland Tire Shop · New + Used · Walk-In or Order Online</span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-foreground mt-4 leading-[1.1] tracking-tight">
              Order Tires Online
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Cleveland's tire shop, online or in-shop. Search your size, pick new or used, we install free with our complete service package — mount, balance, valve stems, alignment check, the works. Walk-ins always welcome. Payment programs approved on the spot — faster than your phone finds a signal.
            </p>

            {/* Value proposition callout */}
            <div className="mt-6 inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-full px-4 py-2">
              <Gift className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400 font-medium">
                Free installation package ($289+ value) with every tire purchase
              </span>
            </div>
          </motion.div>

          {/* Search bar — NO animation, must always be visible */}
          <div className="mt-10">
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

            {/* Quick sizes */}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <span className="text-xs text-muted-foreground mr-1 self-center">Popular:</span>
              {COMMON_SIZES.slice(0, 6).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSearchInput(s); setActiveSearch(s); }}
                  className="text-xs text-muted-foreground hover:text-primary border border-border/30 rounded-full px-3 py-1 hover:border-primary/30 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>

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
                { label: "Nick's — tire + free install package", price: "From $40", ours: true },
              ]}
              source="Nick's free Premium Installation Package ($289+ value): mounting, balancing, valve stems, TPMS reset, disposal, tire rotation for life. Used tires from $40."
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
                      "Average bill from a Cleveland-pothole blowout when the tire was already past wear-bar. New rim, new tire, sometimes alignment + suspension. A $40 used tire would have prevented it.",
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
          </div>
        </section>
      )}

      {/* ─── RESULTS ─── */}
      <AnimatePresence>
        {activeSearch && (
          <section ref={resultsRef} className="pb-20">
            <div className="container max-w-5xl mx-auto">
              {isLoading ? (
                <div className="text-center py-16">
                  <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
                  <p className="text-muted-foreground text-sm">Searching available tires...</p>
                </div>
              ) : isError ? (
                <div className="text-center py-16">
                  <p className="text-muted-foreground mb-4">Unable to search tires right now.</p>
                  <a href="tel:+12168620005" onClick={() => trackPhoneClick("tire-finder")} className="text-primary hover:underline">Call us at (216) 862-0005</a>
                </div>
              ) : data?.tires && data.tires.length > 0 ? (
                <>
                  {/* Nick's Package Banner — THE KEY PIECE */}

                  {/* 2026-05-23 · honest activity badge above trust strip.
                      Pulls real numbers from tire_orders (7d). Hidden when
                      DB is empty so an off-day doesn't show "0 orders". */}
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

                  {/* Trust strip — Social proof section */}
                  <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 py-4 border-y border-foreground/10 text-sm text-foreground/60 mb-8">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                      {BUSINESS.reviews.rating} stars · {BUSINESS.reviews.countDisplay} reviews
                    </span>
                    <span className="hidden sm:inline">✓ Fair prices, no pressure</span>
                    <span className="hidden sm:inline">✓ All major brands</span>
                    <span className="hidden sm:inline">✓ Same-day installation</span>
                  </div>
                  {/* Catalog-fallback disclaimer — DK Tire migrated their
                      B2B portal to a static SPA in 2026; the old auth
                      endpoint we POST credentials to is gone, so the live
                      Gateway feed is dead until the new API is wired. When
                      that's down the server falls back to a curated catalog
                      with FIXED prices that don't vary by tire size. Without
                      this banner a customer searching e.g. 225/60R18 would
                      see the same $96 starting price as a 215/60R16 —
                      misleading and a margin loss if they order. The banner
                      keeps them in the flow but routes any size-sensitive
                      decision to a phone quote until live pricing is back. */}
                  {data.source === "catalog" && (
                    <div className="mb-6 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-sm leading-relaxed">
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
                    <div>
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
                        {(["all", "budget", "mid", "premium"] as CategoryFilter[]).map((cat) => (
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
                  <div className="mt-8 bg-gradient-to-br from-primary/5 via-card to-primary/5 border border-primary/20 rounded-xl p-8 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Starting at</p>
                    <p className="text-4xl font-semibold text-foreground">
                      ${(Math.min(...data.tires.map((t: any) => t.shopPrice)) * quantity).toFixed(2)}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      for {quantity} {quantity === 1 ? "tire" : "tires"} — fully installed with Nick's Premium Package
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-3 text-xs text-green-400">
                      <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Mounted</span>
                      <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Balanced</span>
                      <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Valve Stems</span>
                      <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Disposal</span>
                      <span className="flex items-center gap-1"><Check className="w-3 h-3" /> TPMS Reset</span>
                      <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Inspection</span>
                      <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Alignment Check</span>
                    </div>
                  </div>

                  {/* Info note */}
                  <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>Prices shown are estimates based on current wholesale availability. We confirm exact pricing before processing your order. No charge until you approve.</p>
                  </div>
                </>
              ) : (
                <div className="text-center py-16">
                  <AlertTriangle className="w-8 h-8 text-orange-500/50 mx-auto mb-4" />
                  <p className="text-muted-foreground mb-2">No tires found for "{activeSearch}"</p>
                  <p className="text-sm text-muted-foreground mb-6">
                    Try a different size or we can help you find the right fit.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <a
                      href="tel:+12168620005" onClick={() => trackPhoneClick("tire-finder")}
                      className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                      Call Us — (216) 862-0005
                    </a>
                    <button
                      onClick={() => setSearchInput("")}
                      className="inline-flex items-center justify-center gap-2 bg-card border border-border/30 text-foreground px-6 py-3 rounded-md text-sm font-medium hover:bg-card/80 transition-colors"
                    >
                      Try Different Size
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-6">Walk-ins welcome • 17625 Euclid Ave • Mon–Sat 8AM–6PM</p>
                </div>
              )}
            </div>
          </section>
        )}
      </AnimatePresence>

      {/* ─── EMERGENCY FLAT REPAIR ─── */}
      {!activeSearch && (
        <section className="pb-0">
          <div className="container max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="relative overflow-hidden bg-gradient-to-br from-red-500/5 via-card to-orange-500/5 border border-red-500/20 rounded-xl p-6 sm:p-8 mb-10"
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
                    Used Tires Cleveland — Inspected, Installed, Honest
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    Not everyone needs brand-new rubber. We carry a large selection of quality used tires — every one passes a 4-point exam (tread depth, sidewall, DOT date, plug history) before it earns a spot on your car. Same professional installation, same free mount/balance/valve stems/disposal, same coffee — just a friendlier number on the receipt. Payment programs on the spot if you need them.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                    {[
                      { label: "Inspected", desc: "Every tire checked for safety" },
                      { label: "Affordable", desc: "Fraction of new tire cost" },
                      { label: "Same Install", desc: "Full premium package included" },
                      { label: "In Stock", desc: "Large selection available now" },
                    ].map((item) => (
                      <div key={item.label} className="bg-background/50 rounded-lg p-3">
                        <p className="text-xs font-medium text-foreground">{item.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{item.desc}</p>
                      </div>
                    ))}
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
              className="bg-gradient-to-br from-primary/5 via-card to-primary/5 border border-primary/20 rounded-xl p-6 sm:p-8 mb-10"
            >
              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Users className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-xl sm:text-2xl font-semibold text-foreground">
                  Cleveland's Best Tire Team
                </h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-2xl mx-auto leading-relaxed">
                  We do not just sell tires. We have the most experienced, most honest, and fastest tire technicians in Northeast Ohio. Every person on our team takes pride in doing the job right — the first time.
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
                    title: "Quality Guaranteed",
                    desc: "Every installation includes our full premium package — mounting, balancing, valve stems, TPMS reset, alignment check, and a 20-point safety inspection.",
                  },
                  {
                    icon: <Heart className="w-5 h-5" />,
                    title: "We Treat You Like Family",
                    desc: "We show you the problem before we fix it. We explain your options. We let you decide. No pressure, no upselling, no games.",
                  },
                  {
                    icon: <MapPin className="w-5 h-5" />,
                    title: "Cleveland Proud",
                    desc: "Locally owned and operated. We live here, we work here, and we take care of our neighbors. Serving Cleveland, Euclid, and all of Northeast Ohio.",
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
          <div className="relative aspect-[4/3] rounded-md border border-border/40 bg-card/60 overflow-hidden">
            <img
              src="/photos/alignment-bay.webp"
              alt="Nick's Tire & Auto wheel alignment bay in Cleveland — precision Hunter alignment rack"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ objectPosition: "center 50%" }}
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
              <h3 className="text-base font-bold text-foreground mb-1.5 group-hover:text-primary transition-colors">From $40 installed</h3>
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

      {/* ─── ORDER MODAL ─── */}
      {showOrder && (
        <OrderModal
          tire={selectedTire}
          quantity={quantity}
          packageValue={packageData?.packageValuePerSet || 289}
          onClose={() => { setShowOrder(false); setSelectedTire(null); }}
        />
      )}
    </div>
    </PageLayout>
  );
}
