import { useEffect, useState } from "react";
import { CalendarDays, ChevronUp, MapPin, Phone } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trackPhoneClick } from "@/components/SEO";

const ACTION_CLASS =
  "pointer-events-auto inline-flex items-center justify-center gap-2 rounded-full border border-foreground/15 bg-background/90 px-3 py-2 text-xs font-semibold text-foreground shadow-lg shadow-black/30 backdrop-blur-md transition hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80";

export default function QuickAccessDock() {
  const [showDock, setShowDock] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowDock(window.scrollY > 240);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!showDock) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-28 right-3 z-[80] flex flex-col gap-2 sm:bottom-20"
      role="region"
      aria-label="Quick access actions"
    >
      <a
        href="/booking"
        className={ACTION_CLASS}
        aria-label="Book an appointment online"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        Book
      </a>

      <a
        href={BUSINESS.phone.href}
        onClick={() => trackPhoneClick("quick-access-dock")}
        className={ACTION_CLASS}
        aria-label={`Call ${BUSINESS.name}`}
      >
        <Phone className="h-4 w-4" aria-hidden="true" />
        Call
      </a>

      <a
        href={BUSINESS.urls.googleMapsDirections}
        target="_blank"
        rel="noopener noreferrer"
        className={ACTION_CLASS}
        aria-label="Get driving directions"
      >
        <MapPin className="h-4 w-4" aria-hidden="true" />
        Directions
      </a>

      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className={ACTION_CLASS}
        aria-label="Back to top"
      >
        <ChevronUp className="h-4 w-4" aria-hidden="true" />
        Top
      </button>
    </div>
  );
}
