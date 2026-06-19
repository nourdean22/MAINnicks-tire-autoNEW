"use client";

/**
 * components/settings/push-notification-toggle.tsx
 *
 * Extracted VERBATIM from app/(mastery)/settings/page.tsx (2026-06-02 ·
 * settings-shell redesign) · same behavior. Web-push subscribe/unsubscribe
 * toggle backed by usePushNotifications. Self-hides when the browser
 * doesn't support push. Surfaces a human-readable error for every
 * hook lastError code.
 */

import { useState } from "react";
import { BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePushNotifications } from "@/hooks/use-push-notifications";

export function PushNotificationToggle() {
  const { isSupported, isSubscribed, permission, lastError, subscribe, unsubscribe } = usePushNotifications();
  const [loading, setLoading] = useState(false);

  if (!isSupported) return null;

  const handleToggle = async () => {
    setLoading(true);
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
    setLoading(false);
  };

  // v11 · translate the hook's lastError into a human-readable message
  const errorMessage: string | null = (() => {
    if (!lastError) return null;
    if (lastError === "vapid_public_key_missing")
      return "Server isn't configured for push — VAPID_PUBLIC_KEY env var missing. Set it in Vercel env.";
    if (lastError === "permission_denied")
      return "Browser blocked notifications. Enable in browser settings → Site permissions → Notifications.";
    if (lastError === "permission_default")
      return "Permission not granted. Click the toggle again and allow notifications when prompted.";
    if (lastError === "not_supported")
      return "This browser doesn't support push notifications.";
    if (lastError === "server_rejected")
      return "Server rejected the subscription. Check /api/notifications/subscribe logs.";
    if (lastError.startsWith("subscribe_exception:"))
      return `Browser error: ${lastError.slice("subscribe_exception:".length).trim()}`;
    return lastError;
  })();

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BellRing size={14} className="text-[var(--gold)]" />
          <span className="text-sm font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            push notifications
          </span>
        </div>
        <button
          onClick={handleToggle}
          disabled={loading}
          role="switch"
          aria-checked={isSubscribed}
          aria-label={isSubscribed ? "disable push notifications" : "enable push notifications"}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors",
            isSubscribed ? "bg-[var(--gold)]" : "bg-zinc-700",
            loading && "opacity-50"
          )}
        >
          <span aria-hidden className={cn(
            "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform",
            isSubscribed ? "left-[22px]" : "left-0.5"
          )} />
        </button>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)]">
        {isSubscribed
          ? "Enabled — you'll get alerts for leads, revenue milestones, drift detection, and score reminders."
          : permission === "denied"
            ? "Blocked by browser. Enable in browser settings → Site permissions → Notifications."
            : "Enable to receive alerts even when the browser is closed."}
      </p>
      {errorMessage && (
        <p role="alert" className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-300">
          ⚠ {errorMessage}
        </p>
      )}
    </div>
  );
}
