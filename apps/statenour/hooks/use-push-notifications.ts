"use client";

/**
 * usePushNotifications — Client-side hook for subscribing to push notifications.
 *
 * Usage:
 *   const { isSupported, isSubscribed, permission, lastError, subscribe, unsubscribe } = usePushNotifications();
 *
 * v11 · `lastError` exposes WHY subscribe() failed so the UI can show
 * a real message instead of the toggle silently flipping back off:
 *   · "vapid_public_key_missing" — server env not set
 *   · "permission_denied"         — user clicked Block in browser
 *   · "permission_default"        — user dismissed the prompt
 *   · "not_supported"             — browser lacks ServiceWorker / PushManager
 *   · "server_rejected"           — POST /api/notifications/subscribe failed
 *   · "subscribe_exception: …"    — raw browser error
 */

import { useCallback, useEffect, useState } from "react";

import { authedFetch } from "@/hooks/use-authed-fetch";
export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setIsSupported(supported);

    if (supported) {
      setPermission(Notification.permission);

      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(!!sub);
        });
      });
    }
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    setLastError(null);

    if (!isSupported) {
      setLastError("not_supported");
      return false;
    }

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm === "denied") {
        setLastError("permission_denied");
        return false;
      }
      if (perm !== "granted") {
        setLastError("permission_default");
        return false;
      }

      const keyRes = await authedFetch("/api/notifications/subscribe");
      const keyJson = await keyRes.json().catch(() => ({}));
      const publicKey = keyJson?.publicKey;
      if (!publicKey || typeof publicKey !== "string" || publicKey.length < 20) {
        setLastError("vapid_public_key_missing");
        console.error("[push] VAPID_PUBLIC_KEY missing on server · set it in Vercel env");
        return false;
      }

      const vapidKey = urlBase64ToUint8Array(publicKey);

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey as BufferSource,
      });

      const res = await authedFetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!res.ok) {
        setLastError("server_rejected");
        return false;
      }

      setIsSubscribed(true);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`subscribe_exception: ${msg}`);
      console.error("[push] Subscribe failed:", err);
      return false;
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setLastError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (!subscription) return true;

      await subscription.unsubscribe();

      await authedFetch("/api/notifications/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

      setIsSubscribed(false);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`unsubscribe_exception: ${msg}`);
      return false;
    }
  }, []);

  return { isSupported, isSubscribed, permission, lastError, subscribe, unsubscribe };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
