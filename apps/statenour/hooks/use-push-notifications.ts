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

// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice — every
// call-site here is now typed tRPC, the `authedFetch` import is gone:
//   · GET    /api/notifications/subscribe → trpc.system.pushVapidKey
//   · POST   /api/notifications/subscribe → trpc.system.pushSubscribe
//   · DELETE /api/notifications/subscribe → trpc.system.pushUnsubscribe
// The three procedures call the SAME `lib/notifications/push` helpers
// (`VAPID_PUBLIC_KEY` · `saveSubscription` · `removeSubscription`) the
// legacy route also calls · drift impossible. The VAPID key read fires
// imperatively via `utils.system.pushVapidKey.fetch()`; the subscribe /
// unsubscribe writes use typed mutations.
import { trpc } from "@/lib/trpc/client";

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [lastError, setLastError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const subscribeMutation = trpc.system.pushSubscribe.useMutation();
  const unsubscribeMutation = trpc.system.pushUnsubscribe.useMutation();

  useEffect(() => {
    const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    
    setTimeout(() => {
      setIsSupported(supported);
      if (supported) {
        setPermission(Notification.permission);
      }
    }, 0);

    if (supported) {
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

      const keyResult = await utils.system.pushVapidKey
        .fetch()
        .catch(() => ({ publicKey: "" }));
      const publicKey = keyResult?.publicKey;
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

      // `PushSubscription.toJSON()` yields { endpoint, keys: { p256dh,
      // auth }, expirationTime } · the procedure's strict input reads
      // exactly the endpoint + keys fields. A failed write throws
      // TRPCError → caught here, surfaced as "server_rejected".
      const sub = subscription.toJSON();
      try {
        await subscribeMutation.mutateAsync({
          subscription: {
            endpoint: sub.endpoint ?? "",
            keys: {
              p256dh: sub.keys?.p256dh ?? "",
              auth: sub.keys?.auth ?? "",
            },
          },
        });
      } catch {
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
  }, [isSupported, utils, subscribeMutation]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setLastError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (!subscription) return true;

      await subscription.unsubscribe();

      await unsubscribeMutation.mutateAsync({
        endpoint: subscription.endpoint,
      });

      setIsSubscribed(false);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`unsubscribe_exception: ${msg}`);
      return false;
    }
  }, [unsubscribeMutation]);

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
