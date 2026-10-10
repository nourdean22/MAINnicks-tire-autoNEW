/**
 * `behavior` for a JS scroll (scrollIntoView / scrollTo). The prefers-reduced-motion kill switch
 * in app/styles/effects.css only reaches CSS; a JS `behavior: "smooth"` ignores it, so JS scrolls
 * ask here. Instant when there is no window to ask.
 */
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
