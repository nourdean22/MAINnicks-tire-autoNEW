"use client";

/**
 * ManualMissionForm — collapsible inline form for skipping AI plan
 * and creating a mission directly with domain / status / deadline
 * picked at create-time.
 *
 * v10.0.266 · extracted from /tasks page projectsContent block
 * (was inline at app/(mastery)/tasks/page.tsx ~line 1418-1471).
 * Same primitives, same colors, same behavior · just a self-contained
 * component to reduce the parent page's JSX surface area.
 *
 * Used inside ProjectsBlock between the "Plan / + Manual" buttons
 * and the AI clarifying-questions panel.
 */

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export interface ManualMissionFormProps {
  /** Title state from parent (shared with the AI-plan input) */
  title: string;
  domain: string;
  setDomain: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  deadline: string;
  setDeadline: (v: string) => void;
  /** Disabled while either AI-plan or manual-create is in flight */
  busy: boolean;
  /** Submit handler · parent owns the actual API call */
  onCreate: (input: {
    title: string;
    domain: string;
    status: string;
    deadline: string | null;
  }) => void;
}

export function ManualMissionForm({
  title,
  domain,
  setDomain,
  status,
  setStatus,
  deadline,
  setDeadline,
  busy,
  onCreate,
}: ManualMissionFormProps) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <select
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-100 focus:outline-none focus:border-amber-500"
        >
          <option value="BUSINESS">business</option>
          <option value="PERSONAL">personal</option>
          <option value="HEALTH">health</option>
          <option value="CONTENT">content</option>
          <option value="FINANCE">finance</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-100 focus:outline-none focus:border-amber-500"
        >
          <option value="ACTIVE">active</option>
          <option value="PAUSED">paused</option>
        </select>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          placeholder="deadline"
          className="bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[10px] text-zinc-100 focus:outline-none focus:border-amber-500"
        />
      </div>
      {/* Linking to a goal happens AFTER creation via the project's
          "+ goal" picker — the link lives at the task level (no
          tasks exist at create-time), so wiring it here would
          produce silent no-ops. Documented with a hint. */}
      <p className="text-[9px] text-zinc-600 italic">
        Tip: after creating, add tasks then click <span className="text-amber-300">+ goal</span> on the project to link them all.
      </p>
      <div className="flex justify-end">
        <Button
          size="sm"
          className="h-7 px-2.5 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-bold hover:bg-amber-500/30"
          onClick={() =>
            onCreate({
              title,
              domain,
              status,
              deadline: deadline || null,
            })
          }
          disabled={busy || !title.trim()}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : "Create"}
        </Button>
      </div>
    </div>
  );
}
