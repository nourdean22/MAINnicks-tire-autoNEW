/**
 * One tap to apply the built-in migration list (nickActions.runMigrations
 * → handleRunMigrations). That list is a maintained SUBSET of drizzle/*.sql,
 * not every migration file, so a fresh or restored database still needs the
 * full migration runner; the card says so rather than "schema is up to date".
 * The mutation is adminProcedure and audit-logged ("migrations.ran").
 *
 * The list re-runs EVERY statement each time. Schema steps are IF NOT EXISTS /
 * catch-duplicate. Two steps are data writes: the prediction_impressions and
 * search_performance duplicate-row cleanups, each followed by the unique key
 * that makes it a no-op afterwards. Since 2026-09-23 nothing in it may
 * overwrite a setting (the tireMarkup force-reset was removed);
 * server/migrationListGuards.test.ts keeps it that way.
 *
 * Counting: the server's `applied` includes steps that ran as no-ops, and its
 * `skipped` includes the per-step errors, so the card shows "already in place"
 * as skipped minus errors and lists the errors on their own.
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
      else if (res.errors?.length) toast.warning(`${res.errors.length} step(s) failed — see below.`);
      else toast.success("Built-in migration list applied — no step failed.");
    },
    onError: (e) => toast.error(`Couldn't run migrations: ${e.message}`),
  });

  const onRun = async () => {
    const ok = await confirmDialog({
      title: "Apply the built-in database migrations?",
      message:
        "Runs the built-in migration list against the live database: schema steps (tables, columns, indexes) that skip themselves when already in place, plus two cleanups of duplicate analytics rows (prediction impressions, search performance). It never overwrites a shop setting. Logged in the admin audit trail.",
      confirmLabel: "Apply migrations",
      cancelLabel: "Cancel",
      tone: "danger",
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
        Applies the built-in migration list — a maintained subset, not every migration file. A new or restored database still needs the full migration runner.
      </p>
      <button
        type="button"
        onClick={onRun}
        disabled={run.isPending}
        className="min-h-[48px] rounded-lg bg-primary text-primary-foreground px-4 text-sm font-semibold disabled:opacity-50"
      >
        {run.isPending ? "Applying…" : "Apply built-in migrations"}
      </button>
      {last && (
        <div className="mt-3 text-[12px] text-foreground/70 space-y-1">
          {last.success ? (
            <p>
              {last.total} steps checked · {Math.max(0, (last.skipped ?? 0) - (last.errors?.length ?? 0))} already in place
              {last.errors?.length ? ` · ${last.errors.length} failed` : " · none failed"}
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
