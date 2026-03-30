/**
 * SideDrawer — Reusable slide-in panel from the right edge.
 * Used across admin sections for entity details without losing context.
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface SideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: "sm" | "md" | "lg";
}

const WIDTH_MAP = { sm: "w-80", md: "w-[480px]", lg: "w-[640px]" };

export function SideDrawer({ isOpen, onClose, title, children, width = "md" }: SideDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed top-0 right-0 h-full z-50 bg-card border-l border-border/30 shadow-2xl flex flex-col
          ${WIDTH_MAP[width]} max-w-[100vw]
          animate-in slide-in-from-right duration-200`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/20 shrink-0">
          <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="text-foreground/30 hover:text-foreground/60 transition-colors p-1 -mr-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
}
