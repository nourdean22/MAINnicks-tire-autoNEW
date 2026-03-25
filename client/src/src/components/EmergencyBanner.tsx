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
    const dismissed = sessionStorage.getItem("emergency-banner-dismissed");
    if (dismissed) {
      setVisible(false);
    }
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    sessionStorage.setItem("emergency-banner-dismissed", "true");
  };

  if (!visible) return null;

  return (
    <div className="bg-amber-950/40 border-b border-amber-800/40 backdrop-blur-sm">
      <div className="container py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-amber-200/90 text-[13px] sm:text-sm font-medium">
            Car trouble? <span className="hidden sm:inline">We can help today.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={BUSINESS.phone.href}
            className="flex items-center gap-1.5 bg-amber-600/80 hover:bg-amber-600 text-white px-3 py-1.5 rounded-md text-[12px] sm:text-sm font-semibold transition-colors shrink-0"
          >
            <Phone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Call Now</span>
            <span className="sm:hidden">{BUSINESS.phone.display}</span>
          </a>
          <button
            onClick={handleDismiss}
            className="text-amber-200/60 hover:text-amber-200 p-1 transition-colors shrink-0"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
