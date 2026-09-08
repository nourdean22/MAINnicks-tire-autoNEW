/**
 * ShopStrip — the four facts a walk-in shop has to show before anything else:
 * open or closed (and until when), the address, the phone, the rating.
 *
 * WHY (2026-09-08, quality program §4): on a phone the old page top was a
 * membership promo band + the nav row, with the "StickyTrustBar" underneath
 * both — static at y=0 under a fixed cluster, so it was never visible
 * (measured: elementFromPoint at its centre returned the emergency bar or
 * the band). Address and phone were not on screen above the fold at all.
 *
 * This strip lives INSIDE SiteNavbar's fixed cluster (the only place that is
 * reliably above the fold), collapses on scroll like the band did, and is
 * the one closed-state surface: "Closed · opens tomorrow 8 AM" plus the
 * Emergency button that opens EmergencyMode's request form through a window
 * event, replacing the fixed red banner that used to cover the bar.
 *
 * Every value is canon (shared/business.ts) or live (Google review count
 * with the canon count as fallback). Nothing here is decoration.
 */
import { useEffect, useState } from "react";
import { MapPin, Phone, Star } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trpc } from "@/lib/trpc";
import { trackPhoneClick } from "@/components/SEO";
import { getOpenStatus, type OpenStatus } from "@/lib/shopHours";

/** Dispatched on `window` by the strip's Emergency button; EmergencyMode listens. */
export const EMERGENCY_REQUEST_EVENT = "nickstire:emergency-request";

function StatusLine({ status }: { status: OpenStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold whitespace-nowrap">
      <span
        aria-hidden="true"
        className={`inline-block w-2 h-2 rounded-full ${status.isOpen ? "bg-green-500 pulse-dot" : "bg-red-500"}`}
      />
      <span className={status.isOpen ? "text-green-400" : "text-red-300"}>{status.isOpen ? "Open" : "Closed"}</span>
      <span className="text-[#F5F5F5]/60 font-normal">· {status.until}</span>
    </span>
  );
}

function EmergencyButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(EMERGENCY_REQUEST_EVENT))}
      className="shrink-0 min-h-[28px] rounded bg-red-500 hover:bg-red-400 px-2.5 text-[11px] font-black uppercase tracking-wider text-white transition-colors"
    >
      Emergency
    </button>
  );
}

export default function ShopStrip({ collapsed = false }: { collapsed?: boolean }) {
  const [status, setStatus] = useState<OpenStatus>(() => getOpenStatus());
  useEffect(() => {
    const id = setInterval(() => setStatus(getOpenStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

  const rating = (
    <span className="inline-flex items-center gap-1 text-[#F5F5F5]/80 whitespace-nowrap">
      <Star className="w-3.5 h-3.5 fill-[#FDB913] text-[#FDB913]" aria-hidden="true" />
      {BUSINESS.reviews.rating} · {totalReviews.toLocaleString()}+ Google reviews
    </span>
  );
  const address = (
    <a
      href={BUSINESS.urls.googleMapsDirections}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[#F5F5F5]/85 hover:text-[#F5F5F5] whitespace-nowrap min-h-[28px]"
    >
      <MapPin className="w-3.5 h-3.5 text-[#FDB913] shrink-0" aria-hidden="true" />
      {BUSINESS.address.street}, {BUSINESS.address.city}
    </a>
  );
  const phone = (
    <a
      href={BUSINESS.phone.href}
      onClick={() => trackPhoneClick("shop_strip")}
      className="inline-flex items-center gap-1.5 font-semibold text-[#FDB913] hover:brightness-110 whitespace-nowrap min-h-[28px]"
    >
      <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      {BUSINESS.phone.display}
    </a>
  );

  return (
    <div
      data-shop-strip
      aria-hidden={collapsed}
      className={`overflow-hidden transition-all duration-300 bg-[#141414] border-b border-[#2A2A2A] text-[13px] text-[#F5F5F5] ${
        collapsed ? "max-h-0 opacity-0" : "max-h-24 opacity-100"
      }`}
    >
      {/* Phone: two rows, ~60px. Row 1 = state + (rating | emergency). Row 2 = where + call. */}
      <div className="container lg:hidden py-1">
        <div className="flex items-center justify-between gap-3 min-h-[26px]">
          <StatusLine status={status} />
          {status.isOpen ? rating : <EmergencyButton />}
        </div>
        <div className="flex items-center justify-between gap-3 min-h-[26px]">
          {address}
          {phone}
        </div>
      </div>
      {/* Desktop: one 36px row. */}
      <div className="container hidden lg:flex items-center justify-between gap-6 h-9">
        <StatusLine status={status} />
        <div className="flex items-center gap-6">
          {address}
          {phone}
        </div>
        {status.isOpen ? rating : (
          <span className="inline-flex items-center gap-3">
            {rating}
            <EmergencyButton />
          </span>
        )}
      </div>
    </div>
  );
}
