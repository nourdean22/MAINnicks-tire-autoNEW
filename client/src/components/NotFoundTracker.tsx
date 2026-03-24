import { useEffect } from "react";

/**
 * Tracks 404 page hits by reporting to /api/track-404.
 * Renders nothing — mount inside the NotFound page.
 */
export default function NotFoundTracker() {
  useEffect(() => {
    try {
      fetch("/api/track-404", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: window.location.pathname,
          referrer: document.referrer,
          userAgent: navigator.userAgent,
        }),
      }).catch(() => {});
    } catch {
      // Silently fail
    }
  }, []);

  return null;
}
