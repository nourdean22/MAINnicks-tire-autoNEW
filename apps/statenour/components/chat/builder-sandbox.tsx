"use client";

/**
 * BuilderSandbox — desktop-only slide-out panel for Builder mode.
 *
 * When personality is set to "builder", this panel slides in from the
 * right on desktop (>768px). Shows:
 *   · Active repos with deploy status
 *   · Recent file changes (from git)
 *   · Quick links to key files
 *   · Deploy status indicator
 *
 * On mobile this doesn't render — Builder mode still works in the
 * chat, just without the visual panel.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  X,
  GitBranch,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Terminal,
  FileCode,
  Rocket,
  Copy,
  RotateCcw,
  ExternalLink as ExternalIcon,
} from "lucide-react";
import { authedFetch } from "@/hooks/use-authed-fetch";

interface BuilderSandboxProps {
  open: boolean;
  onClose: () => void;
}

interface DeployStatus {
  state: string;
  url?: string;
  commit?: string;
  at?: string;
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
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  // Fetch deploy status when panel opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    authedFetch("/api/system/deploys?limit=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.deploys?.[0]) {
          const dep = d.deploys[0];
          setDeployStatus({
            state: dep.state || dep.status || "unknown",
            url: dep.url,
            commit: dep.commit?.slice(0, 8),
            at: dep.createdAt
              ? new Date(dep.createdAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : undefined,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  async function handleRollback() {
    if (!deployStatus?.commit) {
      toast.error("no deploy to roll back to");
      return;
    }
    const confirmed = confirm(
      `Roll back production to the PREVIOUS ready deploy? Current commit ${deployStatus.commit} will be deprecated. This is immediate and reversible only by pushing a new deploy.`
    );
    if (!confirmed) return;
    setRollingBack(true);
    try {
      const res = await authedFetch("/api/system/deploys/rollback", { method: "POST" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        toast.error(`rollback failed · ${res.status} ${body.slice(0, 80)}`);
      } else {
        toast.success("rollback initiated — watch /system/deploys");
      }
    } catch (e) {
      toast.error(`rollback error · ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRollingBack(false);
    }
  }

  function handleCloneCommit() {
    if (!deployStatus?.commit) {
      toast.error("no commit to clone");
      return;
    }
    const cmd = `git fetch origin && git checkout ${deployStatus.commit}`;
    void copyToClipboard(cmd, `copied · ${deployStatus.commit}`);
  }

  // v8.3 D1 — extra one-tap commands the operator wants without
  // remembering exact syntax. All of these are pure clipboard pushes;
  // the actual run happens on Nour's terminal.
  function handleCopyTypecheck() {
    void copyToClipboard("pnpm exec tsc --noEmit", "copied · typecheck");
  }
  function handleCopyFullGate() {
    void copyToClipboard(
      "bash scripts/pre-push-check.sh",
      "copied · run all 6 pre-push gates",
    );
  }
  function handleCopyDeployLogs() {
    if (!deployStatus?.url) {
      toast.error("no deploy url yet");
      return;
    }
    // Vercel CLI accepts a deployment URL directly. The gh fallback
    // pulls the latest CI run which is what fails before vercel even
    // sees the commit (e.g. cron-drift gate).
    void copyToClipboard(
      `vercel logs https://${deployStatus.url} || gh run view --repo nourdean22/statenour-os | head -40`,
      "copied · deploy logs cmd",
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

      {/* Deploy status */}
      <div className="px-4 py-3 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
          <Rocket size={10} />
          Deploy
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
            <Loader2 size={11} className="animate-spin" />
            Checking...
          </div>
        ) : deployStatus ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {deployStatus.state === "READY" ? (
                <CheckCircle2 size={12} className="text-emerald-400" />
              ) : deployStatus.state === "ERROR" ? (
                <AlertTriangle size={12} className="text-red-400" />
              ) : (
                <Loader2 size={12} className="text-amber-400 animate-spin" />
              )}
              <span
                className={cn(
                  "text-[11px] font-mono font-bold uppercase",
                  deployStatus.state === "READY"
                    ? "text-emerald-400"
                    : deployStatus.state === "ERROR"
                      ? "text-red-400"
                      : "text-amber-400"
                )}
              >
                {deployStatus.state}
              </span>
              {deployStatus.commit && (
                <span className="text-[9px] text-[var(--text-tertiary)] font-mono">
                  {deployStatus.commit}
                </span>
              )}
              {deployStatus.at && (
                <span className="text-[9px] text-[var(--text-tertiary)]">
                  {deployStatus.at}
                </span>
              )}
            </div>
            {deployStatus.url && (
              <a
                href={`https://${deployStatus.url}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-blue-400 hover:text-blue-300 flex items-center gap-1 truncate"
              >
                <ExternalLink size={8} />
                {deployStatus.url}
              </a>
            )}
            {/* v11.1 + v8.3 action row — rollback + clone + new
                clipboard helpers (typecheck, full gate, deploy logs).
                Wraps so all six fit on a 320px sidebar. */}
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <button
                onClick={handleRollback}
                disabled={rollingBack || !deployStatus.commit}
                className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-rose-400/30 text-rose-300 hover:bg-rose-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Promote the previous ready deploy to production"
              >
                {rollingBack ? <Loader2 size={9} className="animate-spin" /> : <RotateCcw size={9} />}
                rollback
              </button>
              <button
                onClick={handleCloneCommit}
                disabled={!deployStatus.commit}
                className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)] disabled:opacity-40 transition-colors"
                title="Copy `git fetch && git checkout <sha>` to clipboard"
              >
                <Copy size={9} />
                clone
              </button>
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
              <button
                onClick={handleCopyDeployLogs}
                disabled={!deployStatus.url}
                className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)] disabled:opacity-40 transition-colors"
                title="Copy CI / Vercel logs lookup command"
              >
                <Copy size={9} />
                logs
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-[var(--text-tertiary)] italic">
            No deploy data
          </p>
        )}
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
              codex/ollama-local → Vercel
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
          Nick has full GitHub tools. Say &ldquo;read file X&rdquo; or &ldquo;commit to codex/ollama-local&rdquo;
        </p>
      </div>
    </div>
  );
}
