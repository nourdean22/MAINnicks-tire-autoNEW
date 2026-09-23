/**
 * One tap to apply the pending hand-written DDL list (nickActions.runMigrations
 * → handleRunMigrations). Every statement in that list is idempotent
 * (IF NOT EXISTS / catch-duplicate), and the mutation is adminProcedure and
 * audit-logged ("migrations.ran").
 *
 * WHY A BUTTON (2026-09-23): the mutation existed with no client caller, so a
 * migration like drizzle/0129 (careers funnel columns) could only be applied
 * from a terminal with ADMIN_API_KEY or `railway run` — and the operator runs
 * the shop from an installed iOS PWA. Confirmation is the in-DOM two-tap
 * dialog; window.confirm is silently suppressed in iOS standalone mode.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Database } from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

type MigrationResult = {
  success: boolean;
  applied?: number;
  skipped?: number;
  total?: number;
  errors?: string[];
  error?: string;
};

export default function RunMigrationsCard() {
  const [last, setLast] = useState<MigrationResult | null>(null);
  const run = trpc.nickActions.runMigrations.useMutation({
    onSuccess: (r) => {
      const res = r as MigrationResult;
      setLast(res);
      if (!res.success) toast.error(`Migrations failed: ${res.error ?? "unknown error"}`);
      else if (res.errors?.length) toast.warning(`Applied ${res.applied}, ${res.errors.length} error(s) — see below.`);
      else toast.success(`Migrations up to date — ${res.applied} applied, ${res.skipped} already in place.`);
    },
    onError: (e) => toast.error(`Couldn't run migrations: ${e.message}`),
  });

  const onRun = async () => {
    const ok = await confirmDialog({
      title: "Apply pending database migrations?",
      message:
        "Runs the built-in migration list against the production database. Every step is 'add if missing', so re-running is safe. Logged in the admin audit trail.",
      confirmLabel: "Apply migrations",
      cancelLabel: "Cancel",
    });
    if (ok) run.mutate();
  };

  return (
    <div className="rounded-xl border border-border/30 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Database className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Database migrations</h3>
      </div>
      <p className="text-[12px] text-foreground/55 mb-3">
        Applies schema changes that shipped in code but haven't been added to the live database yet.
      </p>
      <button
        type="button"
        onClick={onRun}
        disabled={run.isPending}
        className="min-h-[48px] rounded-lg bg-primary text-primary-foreground px-4 text-sm font-semibold disabled:opacity-50"
      >
        {run.isPending ? "Applying…" : "Apply pending migrations"}
      </button>
      {last && (
        <div className="mt-3 text-[12px] text-foreground/70 space-y-1">
          {last.success ? (
            <p>
              {last.applied} applied · {last.skipped} already in place · {last.total} total
            </p>
          ) : (
            <p className="text-rose-400">Failed: {last.error}</p>
          )}
          {last.errors?.map((e) => (
            <p key={e} className="font-mono text-[11px] text-amber-400 break-all">
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
