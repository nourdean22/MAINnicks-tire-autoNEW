"use client";

/**
 * BuilderSandbox — desktop-only slide-out panel for Builder mode.
 *
 * When personality is set to "builder", this panel slides in from the
 * right on desktop (>768px). Shows:
 *   · Quick clipboard commands (typecheck · full gate)
 *   · Active repos
 *   · Quick links to key files
 *
 * On mobile this doesn't render — Builder mode still works in the
 * chat, just without the visual panel.
 *
 * Wave 53 (2026-05-20): the Vercel-API deploy-status panel (commit
 * list + rollback button + deploy-logs command) was removed when
 * statenour left Vercel for Railway. The two Railway-safe clipboard
 * helpers (typecheck · gate) survive as the Commands section below.
 */

import { toast } from "sonner";
import {
  X,
  GitBranch,
  Terminal,
  FileCode,
  Copy,
  ExternalLink as ExternalIcon,
} from "lucide-react";

interface BuilderSandboxProps {
  open: boolean;
  onClose: () => void;
}

// v11.1 · Repo roots — used to compute vscode:// URLs + git-checkout
// commands. Adjust paths if repo moves; keys are the repo names
// shown in the Repos section below.
const REPO_ROOTS: Record<string, string> = {
  "statenour-os": "C:\\Users\\nourd\\NOUR-OS\\apps\\statenour-os",
  "nickstire.org": "C:\\Users\\nourd\\NOUR-OS\\apps\\nickstire",
};

async function copyToClipboard(text: string, label = "copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("clipboard blocked by browser");
  }
}

function openInVsCode(repo: keyof typeof REPO_ROOTS, relPath: string): void {
  const root = REPO_ROOTS[repo];
  if (!root) {
    void copyToClipboard(relPath, `copied path · ${relPath}`);
    return;
  }
  const fullPath = `${root}/${relPath}`;
  // vscode:// URI scheme opens the path directly in desktop VS Code.
  // Mobile / unsupported envs will silently fail → fall back to clipboard.
  const uri = `vscode://file/${fullPath.replace(/\\/g, "/")}`;
  try {
    window.location.href = uri;
    toast.success(`opening ${relPath} in VS Code`);
  } catch {
    void copyToClipboard(fullPath, `copied · ${relPath}`);
  }
}

export function BuilderSandbox({ open, onClose }: BuilderSandboxProps) {
  // v8.3 D1 — one-tap clipboard commands the operator wants without
  // remembering exact syntax. Pure clipboard pushes; the actual run
  // happens on Nour's terminal.
  function handleCopyTypecheck() {
    void copyToClipboard("pnpm exec tsc --noEmit", "copied · typecheck");
  }
  function handleCopyFullGate() {
    void copyToClipboard(
      "bash scripts/pre-push-check.sh",
      "copied · run all 6 pre-push gates",
    );
  }

  if (!open) return null;

  return (
    <div className="fixed top-0 right-0 bottom-0 w-80 z-[90] bg-[var(--bg-void)] border-l border-[var(--border-default)] shadow-2xl hidden md:flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-blue-400" />
          <span className="text-[12px] font-bold text-blue-400 uppercase tracking-wider">
            Builder
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded"
        >
          <X size={14} />
        </button>
      </div>

      {/* Commands — Railway-safe one-tap clipboard helpers */}
      <div className="px-4 py-3 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
          <Terminal size={10} />
          Commands
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={handleCopyTypecheck}
            className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)] transition-colors"
            title="Copy `pnpm exec tsc --noEmit` to clipboard"
          >
            <Copy size={9} />
            typecheck
          </button>
          <button
            onClick={handleCopyFullGate}
            className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)] transition-colors"
            title="Copy `bash scripts/pre-push-check.sh` (all 6 gates)"
          >
            <Copy size={9} />
            gate
          </button>
        </div>
      </div>

      {/* Repos */}
      <div className="px-4 py-3 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
          <GitBranch size={10} />
          Repos
        </div>
        <div className="space-y-2">
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <FileCode size={10} className="text-blue-400" />
              <span className="text-[11px] font-bold text-[var(--text-primary)]">
                statenour-os
              </span>
            </div>
            <p className="text-[9px] text-[var(--text-tertiary)] font-mono">
              main → Railway
            </p>
            <p className="text-[8px] text-[var(--text-tertiary)]">
              Next.js 16 · Prisma 7 · Tailwind 4
            </p>
          </div>
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <FileCode size={10} className="text-emerald-400" />
              <span className="text-[11px] font-bold text-[var(--text-primary)]">
                nickstire.org
              </span>
            </div>
            <p className="text-[9px] text-[var(--text-tertiary)] font-mono">
              main → Railway
            </p>
            <p className="text-[8px] text-[var(--text-tertiary)]">
              Express 4 · tRPC 11 · Drizzle
            </p>
          </div>
        </div>
      </div>

      {/* Key files */}
      <div className="px-4 py-3 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
          <FileCode size={10} />
          Key files
        </div>
        <div className="space-y-0.5">
          {[
            { path: "lib/ai/system-prompt.ts", label: "System prompt", repo: "statenour-os" as const },
            { path: "lib/ai/provider.ts", label: "AI provider", repo: "statenour-os" as const },
            { path: "lib/ai/tools.ts", label: "Tools (146+)", repo: "statenour-os" as const },
            { path: "app/api/ai/chat/route.ts", label: "Chat route", repo: "statenour-os" as const },
            { path: "prisma/schema.prisma", label: "Schema (95 models)", repo: "statenour-os" as const },
            { path: "lib/brain", label: "Brain engines (29)", repo: "statenour-os" as const },
            { path: "components/chat", label: "Chat components", repo: "statenour-os" as const },
            { path: "components/actions", label: "Action components", repo: "statenour-os" as const },
            { path: "docs/BUSINESS-LANDSCAPE.md", label: "Business DNA", repo: "statenour-os" as const },
            { path: "docs/NICKSTIRE-QUERY-CONTRACT.md", label: "Bridge contract", repo: "statenour-os" as const },
            { path: "docs/project/UPGRADE-PLAN.md", label: "Wave plan", repo: "statenour-os" as const },
          ].map((f) => (
            <div
              key={f.path}
              className="group flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <span className="text-[var(--text-tertiary)] font-mono truncate flex-1">
                {f.path}
              </span>
              <span className="text-[8px] text-[var(--text-tertiary)] shrink-0 truncate max-w-[80px]">
                {f.label}
              </span>
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => openInVsCode(f.repo, f.path)}
                  aria-label={`Open ${f.path} in VS Code`}
                  title="Open in VS Code"
                  className="rounded-full inline-flex items-center justify-center p-3 -m-3 min-w-[36px] min-h-[36px] text-[var(--text-tertiary)] hover:text-blue-400 focus-visible:relative focus-visible:z-10"
                >
                  <ExternalIcon size={9} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void copyToClipboard(
                      `${REPO_ROOTS[f.repo] ?? ""}/${f.path}`.replace(/\\/g, "/"),
                      `copied · ${f.path}`
                    )
                  }
                  aria-label={`Copy absolute path to ${f.path}`}
                  title="Copy absolute path"
                  className="rounded-full inline-flex items-center justify-center p-3 -m-3 min-w-[36px] min-h-[36px] text-[var(--text-tertiary)] hover:text-[var(--gold)] focus-visible:relative focus-visible:z-10"
                >
                  <Copy size={9} aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-[var(--border-default)]">
        <p className="text-[8px] text-[var(--text-tertiary)] italic text-center">
          Nick has full GitHub tools. Say &ldquo;read file X&rdquo; or &ldquo;commit to main&rdquo;
        </p>
      </div>
    </div>
  );
}
