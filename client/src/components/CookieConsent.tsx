import { useState, useEffect } from "react";
import {
  hasConsentChoice,
  acceptAll,
  rejectAll,
  setConsent,
  getConsentState,
} from "@/lib/consent-manager";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    // Only show if user hasn't made a choice yet
    if (!hasConsentChoice()) {
      setVisible(true);
    } else {
      const state = getConsentState();
      if (state) {
        setAnalytics(state.analytics);
        setMarketing(state.marketing);
      }
    }
  }, []);

  if (!visible) return null;

  const handleAcceptAll = () => {
    acceptAll();
    setVisible(false);
  };

  const handleRejectAll = () => {
    rejectAll();
    setVisible(false);
  };

  const handleSaveCustom = () => {
    setConsent({ analytics, marketing });
    setVisible(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] p-4 sm:p-6">
      <div className="mx-auto max-w-3xl rounded-xl border border-zinc-700 bg-zinc-900 p-4 sm:p-6 shadow-2xl">
        {!showCustomize ? (
          <>
            <p className="text-sm text-zinc-300 mb-4">
              We use cookies to improve your experience and analyze site traffic.
              You can choose which cookies to allow.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleAcceptAll}
                className="rounded-lg bg-[#FDB913] px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#e5a811] transition-colors"
              >
                Accept All
              </button>
              <button
                onClick={handleRejectAll}
                className="rounded-lg border border-zinc-600 bg-zinc-800 px-5 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Reject All
              </button>
              <button
                onClick={() => setShowCustomize(true)}
                className="rounded-lg px-5 py-2.5 text-sm text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors"
              >
                Customize
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-zinc-200 mb-4">
              Cookie Preferences
            </p>
            <div className="space-y-3 mb-4">
              {/* Necessary — always on */}
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-zinc-300">
                  Necessary <span className="text-zinc-500">(always on)</span>
                </span>
                <input
                  type="checkbox"
                  checked
                  disabled
                  className="h-4 w-4 accent-[#FDB913] cursor-not-allowed"
                />
              </label>
              {/* Analytics */}
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm text-zinc-300">
                  Analytics <span className="text-zinc-500">(GA4, Web Vitals)</span>
                </span>
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                  className="h-4 w-4 accent-[#FDB913] cursor-pointer"
                />
              </label>
              {/* Marketing */}
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm text-zinc-300">
                  Marketing <span className="text-zinc-500">(Meta Pixel)</span>
                </span>
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                  className="h-4 w-4 accent-[#FDB913] cursor-pointer"
                />
              </label>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSaveCustom}
                className="rounded-lg bg-[#FDB913] px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#e5a811] transition-colors"
              >
                Save Preferences
              </button>
              <button
                onClick={() => setShowCustomize(false)}
                className="rounded-lg px-5 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
