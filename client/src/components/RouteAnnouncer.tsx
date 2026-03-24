/**
 * RouteAnnouncer — Announces route changes for screen readers.
 * Uses aria-live="assertive" to inform assistive technology
 * when the user navigates to a new page.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function RouteAnnouncer() {
  const [location] = useLocation();
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    // Derive page name from URL path
    const path = location === "/" ? "Home" : location
      .replace(/^\//, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    setAnnouncement(`Navigated to ${path} page`);
  }, [location]);

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}
