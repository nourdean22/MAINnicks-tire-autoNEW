/**
 * ShopDriver Sync — CSV import from ShopDriver Elite + import history.
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Upload, CheckCircle2, XCircle, Loader2, FileText, Clock, Users, RefreshCw } from "lucide-react";

export default function ShopDriverSection() {
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    totalRows?: number;
    newCustomers?: number;
    updatedCustomers?: number;
    skippedRows?: number;
    error?: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMutation = trpc.shopdriver.importCSV.useMutation();
  const { data: history, refetch: refetchHistory } = trpc.shopdriver.importHistory.useQuery();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvContent(ev.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvContent) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await importMutation.mutateAsync({ csvContent });
      setResult(res);
      refetchHistory();
    } catch (err: any) {
      setResult({ success: false, error: err.message || "Import failed" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="font-bold text-2xl text-foreground tracking-wider">SHOPDRIVER SYNC</h2>
        <p className="text-foreground/50 text-[12px] mt-1">Import customers from ShopDriver Elite CSV exports</p>
      </div>

      {/* Import Card */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm text-foreground tracking-wide mb-4">IMPORT CUSTOMERS</h3>
        <p className="text-foreground/60 text-sm mb-6 leading-relaxed">
          Export your customer list from ShopDriver Elite (Manage → Customers → Export), then upload the CSV file here.
          Existing customers will be updated by phone number. New customers will be added automatically.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 bg-foreground/5 border border-border/30 px-4 py-3 text-foreground/70 hover:text-foreground hover:border-primary/30 transition-colors"
          >
            <FileText className="w-4 h-4" />
            <span className="text-[12px]">{fileName || "Choose CSV file..."}</span>
          </button>

          <button
            onClick={handleImport}
            disabled={!csvContent || importing}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-bold text-xs tracking-wide disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? "IMPORTING..." : "IMPORT"}
          </button>
        </div>

        {/* Result */}
        {result && (
          <div className={`mt-6 p-4 border ${result.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
            <div className="flex items-center gap-2 mb-2">
              {result.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={`font-bold text-sm tracking-wider ${result.success ? "text-emerald-400" : "text-red-400"}`}>
                {result.success ? "IMPORT COMPLETE" : "IMPORT FAILED"}
              </span>
            </div>
            {result.success ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
                <div>
                  <span className="font-mono text-[10px] text-foreground/40 block">Total Rows</span>
                  <span className="font-bold text-xl text-foreground">{result.totalRows}</span>
                </div>
                <div>
                  <span className="font-mono text-[10px] text-foreground/40 block">New Added</span>
                  <span className="font-bold text-xl text-emerald-400">{result.newCustomers}</span>
                </div>
                <div>
                  <span className="font-mono text-[10px] text-foreground/40 block">Updated</span>
                  <span className="font-bold text-xl text-blue-400">{result.updatedCustomers}</span>
                </div>
                <div>
                  <span className="font-mono text-[10px] text-foreground/40 block">Skipped</span>
                  <span className="font-bold text-xl text-foreground/40">{result.skippedRows}</span>
                </div>
              </div>
            ) : (
              <p className="text-red-400/80 text-[12px]">{result.error}</p>
            )}
          </div>
        )}
      </div>

      {/* How It Works */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm text-foreground tracking-wide mb-4">HOW IT WORKS</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="flex gap-3">
            <div className="w-8 h-8 bg-primary/10 flex items-center justify-center shrink-0">
              <span className="font-bold text-primary text-sm">1</span>
            </div>
            <div>
              <h4 className="font-bold text-xs text-foreground tracking-[-0.01em] mb-1">EXPORT FROM SHOPDRIVER</h4>
              <p className="text-foreground/50 text-xs leading-relaxed">Go to Manage → Customers → Export in ShopDriver Elite</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 bg-primary/10 flex items-center justify-center shrink-0">
              <span className="font-bold text-primary text-sm">2</span>
            </div>
            <div>
              <h4 className="font-bold text-xs text-foreground tracking-[-0.01em] mb-1">UPLOAD CSV</h4>
              <p className="text-foreground/50 text-xs leading-relaxed">Upload the exported CSV file here. We match by phone number.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 bg-primary/10 flex items-center justify-center shrink-0">
              <span className="font-bold text-primary text-sm">3</span>
            </div>
            <div>
              <h4 className="font-bold text-xs text-foreground tracking-[-0.01em] mb-1">AUTO-SYNC</h4>
              <p className="text-foreground/50 text-xs leading-relaxed">New customers are added, existing ones updated. Segments auto-classified.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Import History */}
      <div className="bg-card border border-border/30 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm text-foreground tracking-wide">IMPORT HISTORY</h3>
          <button onClick={() => refetchHistory()} className="text-foreground/40 hover:text-primary transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {!history || history.length === 0 ? (
          <p className="text-foreground/40 text-[12px]">No imports yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">Date</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">Source</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">Total</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">New</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">Updated</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">Skipped</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h: any) => (
                  <tr key={h.id} className="border-b border-border/10">
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-foreground/30" />
                        <span className="text-[12px] text-foreground/70">
                          {new Date(h.createdAt).toLocaleDateString()} {new Date(h.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-[12px] text-foreground/50">{h.source}</td>
                    <td className="py-2.5 pr-4 text-[12px] text-foreground">{h.totalRows}</td>
                    <td className="py-2.5 pr-4 text-[12px] text-emerald-400">{h.newCustomers}</td>
                    <td className="py-2.5 pr-4 text-[12px] text-blue-400">{h.updatedCustomers}</td>
                    <td className="py-2.5 pr-4 text-[12px] text-foreground/40">{h.skippedRows}</td>
                    <td className="py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] tracking-wider border ${
                        h.status === "completed" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                        h.status === "failed" ? "text-red-400 bg-red-500/10 border-red-500/20" :
                        "text-amber-400 bg-amber-500/10 border-amber-500/20"
                      }`}>
                        {h.status === "completed" ? <CheckCircle2 className="w-3 h-3" /> : h.status === "failed" ? <XCircle className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
                        {h.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
