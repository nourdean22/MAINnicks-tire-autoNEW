"use client";

import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // v10.0.48 — wrap sessionStorage in try/catch. Pre-fix Safari
    // Private (and locked-down browsers) throws SecurityError on
    // sessionStorage access, which crashed PWAInstallPrompt — and
    // because this component mounts globally in the mastery layout,
    // every Safari Private page load was throwing during render.
    // Pattern matches kommando-modes.tsx + proactive-insight-card.tsx
    // which already handle this correctly.
    try {
      if (sessionStorage.getItem("pwa-dismissed")) {
        setDismissed(true);
        return;
      }
    } catch {
      /* storage disabled — fall through to show prompt this session */
    }

    // Check if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    function handler(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") {
      setDeferredPrompt(null);
    }
    dismiss();
  }

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem("pwa-dismissed", "1");
    } catch {
      /* storage disabled — best-effort; component still hides for the session */
    }
  }

  if (!deferredPrompt || dismissed) return null;

  return (
    <div className={cn(
      "fixed bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-72 z-[90]",
      "rounded-xl border border-[var(--gold)]/20 bg-[var(--bg-elevated)] shadow-2xl p-3",
      "animate-fadeSlideUp"
    )}>
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--gold-ghost)] shrink-0">
          <Download size={14} className="text-[var(--gold)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-[var(--font-display)] font-bold text-[var(--text-primary)]">INSTALL NOUR OS</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">Add to home screen for instant access</p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={install}
              className="px-3 py-1 min-h-[44px] min-w-[44px] rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] text-[10px] font-bold uppercase tracking-wider hover:bg-[var(--gold-dim)] transition-colors"
            >
              Install
            </button>
            <button
              onClick={dismiss}
              className="text-[10px] min-h-[44px] min-w-[44px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              Not now
            </button>
          </div>
        </div>
        <button onClick={dismiss} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] shrink-0">
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
