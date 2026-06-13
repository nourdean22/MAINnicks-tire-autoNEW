import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ShieldCheck, AlertTriangle, Play, Loader2, Info } from "lucide-react";
import { toast } from "sonner";

export default function PromptEvalsPanel() {
  const [reports, setReports] = useState<any[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const runEvalsMutation = trpc.contentAdmin.runPromptEvals.useQuery(undefined, {
    enabled: false,
    retry: false,
  });

  const handleRunAudits = async () => {
    setIsRunning(true);
    setReports(null);
    try {
      const res = await runEvalsMutation.refetch();
      if (res.data) {
        setReports(res.data);
        const failedCount = res.data.filter((r: any) => !r.passed).length;
        if (failedCount > 0) {
          toast.error(`${failedCount} prompt safety check(s) failed!`);
        } else {
          toast.success("All prompt safety checks passed successfully!");
        }
      }
    } catch (err: any) {
      toast.error(`Evaluation failed: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const failedCount = reports ? reports.filter((r: any) => !r.passed).length : 0;
  const passedCount = reports ? reports.filter((r: any) => r.passed).length : 0;

  return (
    <div className="bg-card border border-border/30 p-5 rounded-lg space-y-4">
      {/* Title Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h4 className="font-bold text-sm text-foreground tracking-wider uppercase">Prompt & Classifier Audits</h4>
          <p className="text-[12px] text-foreground/40 mt-0.5">
            Test system prompt safety and VAPI classification accuracy against deterministic golden fixtures.
          </p>
        </div>
        <button
          onClick={handleRunAudits}
          disabled={isRunning}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/95 disabled:opacity-50 transition-colors"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Running Audits...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              Run Prompt Safety Audits
            </>
          )}
        </button>
      </div>

      {/* Safety Warning Info Box */}
      <div className="border border-blue-500/20 bg-blue-500/5 rounded p-3 text-xs text-blue-300 flex items-start gap-2 leading-relaxed">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          <strong>Offline Heuristic Harness:</strong> Running audits performs deterministic checks (safety regex validations, intent matches, and durational classification tests) locally on this server. No external LLM costs are incurred during the audit execution.
        </span>
      </div>

      {/* Results Display */}
      {reports ? (
        <div className="space-y-4">
          {/* Summary Box */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-background/40 border border-border/20 rounded p-3 text-center">
              <span className="text-[10px] text-foreground/40 font-bold uppercase tracking-wider block">Total Audited</span>
              <span className="text-xl font-extrabold text-foreground mt-0.5 block">{reports.length}</span>
            </div>
            <div className="bg-background/40 border border-border/20 rounded p-3 text-center">
              <span className="text-[10px] text-foreground/40 font-bold uppercase tracking-wider block">Passed</span>
              <span className="text-xl font-extrabold text-emerald-400 mt-0.5 block">{passedCount}</span>
            </div>
            <div className="bg-background/40 border border-border/20 rounded p-3 text-center col-span-2 sm:col-span-1">
              <span className="text-[10px] text-foreground/40 font-bold uppercase tracking-wider block">Failed</span>
              <span className={`text-xl font-extrabold mt-0.5 block ${failedCount > 0 ? "text-red-400 animate-pulse" : "text-foreground/20"}`}>
                {failedCount}
              </span>
            </div>
          </div>

          {/* Detailed Reports Table */}
          <div className="border border-border/30 rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-background/60 border-b border-border/30 font-bold text-foreground/50 tracking-wider">
                    <th className="p-3">SUITE</th>
                    <th className="p-3">TEST CASE</th>
                    <th className="p-3">STATUS</th>
                    <th className="p-3">EXPECTED</th>
                    <th className="p-3">ACTUAL</th>
                    <th className="p-3">DIAGNOSTICS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {reports.map((rep, i) => (
                    <tr key={i} className="hover:bg-foreground/5 transition-colors">
                      <td className="p-3 font-semibold text-foreground/80">{rep.suite}</td>
                      <td className="p-3 font-mono text-foreground/60">{rep.id}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 font-bold text-[10px] uppercase ${rep.passed ? "text-emerald-400" : "text-red-400"}`}>
                          {rep.passed ? (
                            <>
                              <ShieldCheck className="w-3.5 h-3.5" /> Passed
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5" /> Failed
                            </>
                          )}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-foreground/50">{rep.expected}</td>
                      <td className="p-3 font-mono text-foreground/50">{rep.actual}</td>
                      <td className="p-3 text-foreground/60 max-w-[200px] truncate" title={rep.reason}>
                        {rep.reason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 border border-border/30 bg-card rounded-lg border-dashed">
          <Play className="w-8 h-8 text-foreground/20 mx-auto mb-2" />
          <p className="font-bold text-xs text-foreground/40 tracking-wider">AUDITS PENDING RUN</p>
          <p className="text-[11px] text-foreground/30 mt-1 max-w-xs mx-auto">
            Click the button above to run the offline evaluation harness and verify the repository prompts.
          </p>
        </div>
      )}
    </div>
  );
}
