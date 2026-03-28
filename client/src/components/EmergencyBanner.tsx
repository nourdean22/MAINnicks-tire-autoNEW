/**
 * Emergency/Urgent Help Banner
 * Mobile banner displayed at top of homepage
 * Shows prominent call-to-action for urgent car troubles
 */

import { useState, useEffect } from "react";
import { X, Phone, AlertCircle } from "lucide-react";
import { BUSINESS } from "@shared/business";

export default function EmergencyBanner() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Check localStorage to see if user dismissed this session
    try { if (sessionStorage.getItem("emergency-banner-dismissed")) setVisible(false); } catch {}
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    try { sessionStorage.setItem("emergency-banner-dismissed", "true"); } catch {}
  };

  if (!visible) return null;

  return (
    <div className="bg-[#FF3B30]/10 border-b border-[#FF3B30]/30 backdrop-blur-sm">
      <div className="container py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <AlertCircle className="w-5 h-5 text-[#FF3B30] shrink-0" />
          <p className="text-foreground/90 text-[13px] sm:text-sm font-medium">
            Car trouble? <span className="hidden sm:inline">We can help today.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={BUSINESS.phone.href}
            className="flex items-center gap-1.5 bg-[#FDB913] hover:bg-[#FFD54F] text-[#0B0E14] px-3 py-1.5 rounded-md text-[12px] sm:text-sm font-bold transition-colors shrink-0"
          >
            <Phone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Call Now</span>
            <span className="sm:hidden">{BUSINESS.phone.display}</span>
          </a>
          <button
            onClick={handleDismiss}
            className="text-foreground/40 hover:text-foreground p-1 transition-colors shrink-0"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
