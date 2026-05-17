/**
 * UberDropoffWidget — Pillar 4 executor. "Drop off your car, Uber out of here."
 *
 * Strategy:
 *   1. One-tap Uber deep link (pickup = shop, pre-filled) — headline action.
 *   2. Lyft secondary deep link — for customers who don't use Uber.
 *   3. NICKS#### shop-tracking code generated + displayed — front desk can
 *      match a customer's ride request to their drop-off for service memory.
 *
 * All three work together. The Uber/Lyft buttons are the PRIMARY CTA; the code
 * is an operational trace the customer can mention to the front desk.
 */

import { useState } from "react";
import { Car, ExternalLink, Loader2 } from "lucide-react";
import { uberFromShop, lyftFromShop } from "@/lib/rideDeeplink";

function generateCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `NICKS${digits}`;
}

interface Props {
  /** Accent theme — gold (dark bg) vs blue (light bg) */
  theme?: "blue" | "gold";
  /** Compact mode — removes headline copy for embedding */
  compact?: boolean;
}

export default function UberDropoffWidget({ theme = "blue", compact = false }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generateAndTrack() {
    if (loading) return;
    setLoading(true);
    const newCode = generateCode();

    try {
      await fetch("/api/uber-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode }),
      });
    } catch {
      // Silent — customer experience first; we still show the code.
    } finally {
      setCode(newCode);
      setLoading(false);
    }
  }

  const bgClass =
    theme === "gold"
      ? "bg-gradient-to-br from-[#0f0f0f] to-[#1a1a1a] border border-[#FDB913]/30"
      : "bg-gradient-to-br from-blue-600 to-blue-700 border border-blue-400/30";

  const primaryBtnClass =
    theme === "gold"
      ? "bg-[#FDB913] text-black hover:bg-[#e3a811]"
      : "bg-white text-blue-700 hover:bg-blue-50";

  return (
    <div className={`${bgClass} rounded-2xl p-6 sm:p-8 text-center shadow-xl max-w-md mx-auto`}>
      {!compact && (
        <>
          <div className="flex justify-center mb-4">
            <div
              className={`w-14 h-14 rounded-full flex items-center justify-center ${theme === "gold" ? "bg-[#FDB913]/20" : "bg-white/20"}`}
            >
              <Car className={`w-7 h-7 ${theme === "gold" ? "text-[#FDB913]" : "text-white"}`} />
            </div>
          </div>

          <h3 className="text-white font-black text-2xl sm:text-3xl uppercase tracking-tight leading-tight mb-2">
            DROP IT OFF.
            <br />
            GET YOUR DAY BACK.
          </h3>

          <p className={`${theme === "gold" ? "text-white/70" : "text-blue-100"} text-sm mb-6 leading-relaxed`}>
            Pull up. Hand us the keys. Call an Uber from here and keep your day.
            We text you when it's done.
          </p>
        </>
      )}

      {/* ─── PRIMARY ACTIONS ─────────────────────────── */}
      <div className="space-y-3">
        <a
          href={uberFromShop({ mode: "pickup" })}
          target="_blank"
          rel="noopener noreferrer"
          className={`${primaryBtnClass} w-full font-black text-sm uppercase tracking-widest py-4 px-6 rounded-xl active:scale-95 transition-all duration-150 flex items-center justify-center gap-2`}
        >
          Call an Uber from Shop
          <ExternalLink className="w-4 h-4" />
        </a>

        <a
          href={lyftFromShop({ mode: "pickup" })}
          target="_blank"
          rel="noopener noreferrer"
          className={`w-full bg-white/10 hover:bg-white/20 text-white font-bold text-xs uppercase tracking-widest py-3 px-6 rounded-xl active:scale-95 transition-all duration-150 flex items-center justify-center gap-2 border border-white/20`}
        >
          Or use Lyft
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* ─── SHOP-TRACKING CODE (secondary) ───────────── */}
      {!compact && (
        <div className="mt-5 pt-5 border-t border-white/10">
          {!code ? (
            <button
              onClick={generateAndTrack}
              disabled={loading}
              className="text-white/60 hover:text-white text-[11px] uppercase tracking-widest underline underline-offset-4 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Generating shop code…
                </span>
              ) : (
                "Get a tracking code for the front desk"
              )}
            </button>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <p className="text-white/60 text-[10px] uppercase tracking-widest mb-1">
                Show this at the Front Desk
              </p>
              <p className="text-[#FDB913] font-black text-3xl tracking-widest font-mono">
                {code}
              </p>
              <button
                onClick={() => setCode(null)}
                className="mt-2 text-white/40 hover:text-white/70 text-[10px] underline underline-offset-2 transition-colors"
              >
                New code
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
