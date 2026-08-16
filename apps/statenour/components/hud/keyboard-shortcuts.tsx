"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

// v11.0 W9 · expanded vim-style navigation covering the v11 system
// ops deck. Two-step: press G then a letter within 1.5s. Cheatsheet
// overlay triggered by `?`.
const SHORTCUTS = [
  { keys: ["⌘", "K"], action: "Command Palette",      section: "Navigation" },
  { keys: ["?"],      action: "Show Shortcuts",        section: "Navigation" },
  { keys: ["G", "H"], action: "Go to Ultron (home)",   section: "Navigation" },
  { keys: ["G", "N"], action: "Go to Nick (Chat)",     section: "Navigation" },
  { keys: ["G", "T"], action: "Go to Tasks",           section: "Navigation" },
  { keys: ["G", "J"], action: "Go to Journal",         section: "Navigation" },
  { keys: ["G", "B"], action: "Go to Brain",           section: "Navigation" },
  { keys: ["G", "K"], action: "Go to Knowledge",       section: "Navigation" },
  { keys: ["G", "M"], action: "Go to Mastery",         section: "Navigation" },
  { keys: ["G", "F"], action: "Go to Financial",       section: "Navigation" },
  { keys: ["G", "Y"], action: "Go to Body",            section: "Navigation" },
  { keys: ["G", "S"], action: "Go to System",          section: "Navigation" },
  { keys: ["G", "D"], action: "Go to Devices",         section: "System Ops" },
  { keys: ["G", "C"], action: "Go to /system/crons",   section: "System Ops" },
  { keys: ["G", "E"], action: "Go to /system/logs?view=errors",  section: "System Ops" },
  { keys: ["G", "A"], action: "Go to /system/actions", section: "System Ops" },
  { keys: ["G", "Q"], action: "Go to /system/quality", section: "System Ops" },
  { keys: ["G", "P"], action: "Go to /system/power",   section: "System Ops" },
  { keys: ["R"],      action: "Refresh Data",          section: "Actions" },
  { keys: ["Esc"],    action: "Close Panel / Dialog",  section: "Actions" },
];

const GO_ROUTES: Record<string, string> = {
  // core surfaces
  h: "/",
  n: "/chat",
  t: "/missions",
  j: "/journal",
  b: "/brain",
  m: "/stats",
  f: "/business?tab=money",
  y: "/stats#body",             // y = bodY (b is brain) · body is a /stats section
  s: "/system",
  // system ops deck (v11.0)
  d: "/system/devices",         // formerly /drift (which is gone)
  c: "/system/crons",           // formerly /command (which is gone — now at /)
  e: "/system/logs?view=errors",
  a: "/system/actions",
  q: "/system/quality",
  p: "/system/power",
  // legacy / integrations
  i: "/settings",
};

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const [goPrefix, setGoPrefix] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let goTimer: ReturnType<typeof setTimeout>;

    function handleKey(e: KeyboardEvent) {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ? shows shortcuts
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setOpen(v => !v);
        return;
      }

      // Escape closes
      if (e.key === "Escape") {
        if (open) setOpen(false);
        if (goPrefix) setGoPrefix(false);
        return;
      }

      // G prefix for navigation
      if (e.key.toLowerCase() === "g" && !goPrefix) {
        setGoPrefix(true);
        goTimer = setTimeout(() => setGoPrefix(false), 1500);
        return;
      }

      // G + letter navigation
      if (goPrefix) {
        setGoPrefix(false);
        clearTimeout(goTimer);
        const route = GO_ROUTES[e.key.toLowerCase()];
        if (route) {
          e.preventDefault();
          router.push(route);
          return;
        }
      }

      // R to refresh
      if (e.key.toLowerCase() === "r") {
        window.dispatchEvent(new CustomEvent("nour-refresh"));
        return;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(goTimer);
    };
  }, [open, goPrefix, router]);

  if (!open) {
    return goPrefix ? (
      <div className="hidden sm:block fixed bottom-4 right-4 z-[100] px-3 py-1.5 rounded-lg border border-[var(--gold)]/20 bg-[var(--bg-elevated)] text-[11px] font-mono text-[var(--gold)] animate-fadeSlideUp">
        G → press a key...
      </div>
    ) : null;
  }

  const sections = [...new Set(SHORTCUTS.map(s => s.section))];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden animate-fadeSlideUp"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
          <span className="text-sm font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--gold)]">
            Keyboard Shortcuts
          </span>
          <button onClick={() => setOpen(false)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {sections.map(section => (
            <div key={section}>
              <p className="section-label mb-2">{section}</p>
              <div className="space-y-1">
                {SHORTCUTS.filter(s => s.section === section).map(s => (
                  <div key={s.action} className="flex items-center justify-between py-1">
                    <span className="text-xs text-[var(--text-secondary)]">{s.action}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map(k => (
                        <kbd key={k} className="inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-raised)] text-[10px] font-mono text-[var(--text-secondary)]">
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-[var(--border-default)] text-center">
          <span className="text-[10px] text-[var(--text-tertiary)]">Press <kbd className="inline px-1 py-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-raised)] text-[9px] font-mono">?</kbd> to toggle</span>
        </div>
      </div>
    </div>
  );
}
