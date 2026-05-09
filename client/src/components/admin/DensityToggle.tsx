/**
 * DensityToggle — admin chrome density control.
 *
 * Two modes:
 *  · comfortable (default) — current spacing
 *  · compact — denser rows, more on screen for power-users
 *
 * Persisted in localStorage. Applied via `data-density` attr on <html>
 * which CSS rules target (see index.css `[data-density="compact"]`).
 *
 * Pure client-side. No server round-trip. Switch is instant.
 */
import { useEffect, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";

const STORAGE_KEY = "nicks-admin-density";
type Density = "comfortable" | "compact";

function readStored(): Density {
  if (typeof window === "undefined") return "comfortable";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "compact" ? "compact" : "comfortable";
}

function applyDensity(d: Density) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-density", d);
}

export default function DensityToggle() {
  const [density, setDensity] = useState<Density>(readStored);

  useEffect(() => {
    applyDensity(density);
    try {
      window.localStorage.setItem(STORAGE_KEY, density);
    } catch { /* localStorage may be blocked — silent fallback */ }
  }, [density]);

  const next: Density = density === "comfortable" ? "compact" : "comfortable";
  const Icon = density === "comfortable" ? LayoutGrid : Rows3;
  const title = density === "comfortable"
    ? "Switch to compact density (denser rows)"
    : "Switch to comfortable density (more spacing)";

  return (
    <button
      onClick={() => setDensity(next)}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
