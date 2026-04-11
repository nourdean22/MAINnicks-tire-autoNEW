/**
 * UberDropoffWidget — Uber drop-off convenience CTA for Nick's Tire & Auto.
 * Generates a unique NICKS#### code, displays it in large yellow text,
 * and POSTs it to /api/uber-code so the shop can track the request.
 */

import { useState } from "react";
import { Car, Loader2 } from "lucide-react";

function generateCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `NICKS${digits}`;
}

export default function UberDropoffWidget() {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequest() {
    if (loading) return;
    setLoading(true);
    setError(null);

    const newCode = generateCode();

    try {
      await fetch("/api/uber-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode }),
      });
      setCode(newCode);
    } catch {
      // Still show the code even if the POST fails — customer experience first
      setCode(newCode);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-blue-600 rounded-2xl p-8 text-center shadow-xl max-w-md mx-auto">
      {/* Icon */}
      <div className="flex justify-center mb-4">
        <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
          <Car className="w-7 h-7 text-white" />
        </div>
      </div>

      {/* Headline */}
      <h2 className="text-white font-black text-2xl sm:text-3xl uppercase tracking-tight leading-tight mb-2">
        DROP OFF YOUR CAR.
        <br />
        GET YOUR LIFE BACK.
      </h2>

      <p className="text-blue-100 text-sm mb-6 leading-relaxed">
        We'll text you an Uber code so you can head out while we handle everything.
        No waiting room. No wasted time.
      </p>

      {/* CTA Button */}
      {!code && (
        <button
          onClick={handleRequest}
          disabled={loading}
          className="w-full bg-white text-blue-700 font-black text-sm uppercase tracking-widest py-4 px-6 rounded-xl hover:bg-blue-50 active:scale-95 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              GENERATING CODE…
            </>
          ) : (
            "TEXT ME MY UBER CODE"
          )}
        </button>
      )}

      {/* Generated Code */}
      {code && (
        <div className="mt-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <p className="text-white/70 text-xs uppercase tracking-widest mb-1">
            Your Uber Code
          </p>
          <p className="text-[#FDB913] font-black text-5xl tracking-widest font-mono">
            {code}
          </p>
          <p className="text-blue-100 text-xs mt-3 leading-relaxed">
            Show this code at the front desk. We'll arrange your Uber and text you
            when your car is ready.
          </p>
          <button
            onClick={() => { setCode(null); setError(null); }}
            className="mt-4 text-white/50 text-xs underline underline-offset-2 hover:text-white transition-colors"
          >
            Generate a new code
          </button>
        </div>
      )}

      {/* Error fallback (rare) */}
      {error && (
        <p className="mt-3 text-red-300 text-xs">{error}</p>
      )}
    </div>
  );
}
