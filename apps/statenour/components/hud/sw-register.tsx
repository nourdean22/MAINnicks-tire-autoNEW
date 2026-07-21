"use client";

import { useEffect } from "react";

/**
 * truth-substrate audit P1 (#15): registers the service worker.
 *
 * Before this, navigator.serviceWorker.register() was called NOWHERE — so on a
 * fresh install the SW never installed/activated, which meant:
 *   · the push-notification toggle hung forever (subscribe() awaits
 *     navigator.serviceWorker.ready, which never resolves with no registration);
 *   · static-asset caching / offline fallback were entirely inert.
 *
 * Renders nothing. Registration failure can never break the app (caught).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // Register after load so it never competes with first paint.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A registration failure must degrade silently, never throw.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
