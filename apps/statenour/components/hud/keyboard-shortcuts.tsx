"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// v11.0 W9 · expanded vim-style navigation covering the v11 system
// ops deck. Two-step: press G then a letter within 1.5s. Cheatsheet
// overlay triggered by `?`.
const SHORTCUTS = [
  { keys: ["⌘", "K"], action: "Command Palette",      section: "Navigation" },
  { keys: ["?"],      action: "Show Shortcuts",        section: "Navigation" },
  { keys: ["G", "H"], action: "Go to Ultron (home)",   section: "Navigation" },
  { keys: ["G", "N"], action: "Go to Nick (Chat)",     section: "Navigation" },
  { keys: ["G", "T"], action: "Go to Missions",        section: "Navigation" },
  { keys: ["G", "J"], action: "Go to Journal",         section: "Navigation" },
  { keys: ["G", "B"], action: "Go to Brain",           section: "Navigation" },
  { keys: ["G", "K"], action: "Go to Knowledge Review", section: "Navigation" },
  { keys: ["G", "M"], action: "Go to Stats (Mastery)", section: "Navigation" },
  { keys: ["G", "Y"], action: "Go to Body",            section: "Navigation" },
  { keys: ["G", "S"], action: "Go to System",          section: "Navigation" },
  { keys: ["G", "D"], action: "Go to Fleet",           section: "System Ops" },
  { keys: ["G", "C"], action: "Go to Crons",           section: "System Ops" },
  { keys: ["G", "E"], action: "Go to Error Logs",      section: "System Ops" },
  { keys: ["G", "A"], action: "Go to Actions",         section: "System Ops" },
  { keys: ["G", "Q"], action: "Go to Calibration",     section: "System Ops" },
  { keys: ["G", "P"], action: "Go to System Hub",      section: "System Ops" },
  { keys: ["R"],      action: "Refresh Data",          section: "Actions" },
  { keys: ["Esc"],    action: "Close Panel / Dialog",  section: "Actions" },
  // 2026-09-15 · UI workbench · the object grammar over any list whose rows
  // carry data-entity (hooks/use-selection-keyboard.ts). Esc unwinds one
  // level: peek → selection → inspector.
  { keys: ["J"],      action: "Focus next object",        section: "Objects" },
  { keys: ["K"],      action: "Focus previous object",    section: "Objects" },
  { keys: ["Space"],  action: "Peek the focused object",  section: "Objects" },
  { keys: ["Enter"],  action: "Open the inspector",       section: "Objects" },
  { keys: ["X"],      action: "Select / deselect",        section: "Objects" },
  { keys: ["⇧", "J"], action: "Extend the selection",     section: "Objects" },
];

const GO_ROUTES: Record<string, string> = {
  // core surfaces
  h: "/",
  n: "/chat",
  t: "/missions",
  j: "/journal",
  b: "/brain",
  k: "/brain?tab=review",
  m: "/stats",
  // f (/business) removed 2026-09-02 · the page was deleted on operator verdict.
  y: "/stats?tab=body",             // y = bodY (b is brain) · body is a /stats section
  s: "/system",
  // system ops deck · canonical destinations only. Keep P as a
  // legacy muscle-memory alias to the hub rather than a fake /system/power page.
  d: "/system/fleet",           // device/fleet truth
  c: "/system/crons",           // formerly /command (which is gone — now at /)
  e: "/system/logs?view=errors",
  a: "/system/actions",
  q: "/system/calibration",     // quality/evals consolidated here
  p: "/system",                 // legacy "power" alias · hub owns the controls
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

      // Base UI Dialog owns Escape while the cheatsheet is open.
      // Keep the global handler only for cancelling an in-progress G chord.
      if (e.key === "Escape") {
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

  const sections = [...new Set(SHORTCUTS.map(s => s.section))];

  return (
    <>
      {goPrefix && !open ? (
        <div className="fixed bottom-4 right-4 z-[100] hidden rounded-control border border-edge-default bg-surface-raised px-3 py-1.5 font-mono text-[11px] text-fg animate-fadeSlideUp sm:block">
          G → press a key...
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-[100] bg-[var(--bg-void)]/70"
          className="z-[101] w-full max-w-md overflow-hidden border-[var(--border-default)] bg-[var(--bg-elevated)] p-0 shadow-l2 sm:max-w-md"
        >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
          <DialogTitle className="text-[15px] font-semibold text-fg">
            Keyboard Shortcuts
          </DialogTitle>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close keyboard shortcuts"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
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
                        <kbd key={k} className="inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-raised)] text-[11px] font-mono text-[var(--text-secondary)]">
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
          <span className="text-[11px] text-[var(--text-tertiary)]">Press <kbd className="inline px-1 py-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-raised)] text-[11px] font-mono">?</kbd> to toggle</span>
        </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
