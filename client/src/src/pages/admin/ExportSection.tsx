/**
 * Export Section — CSV export for bookings, leads, calls, and callbacks.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Download, FileSpreadsheet, Loader2, CheckCircle2 } from "lucide-react";

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportCard({ title, description, count, onExport, loading, done }: {
  title: string;
  description: string;
  count?: number;
  onExport: () => void;
  loading: boolean;
  done: boolean;
}) {
  return (
    <div className="border border-border/30 rounded-lg p-6 flex items-start justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <FileSpreadsheet className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {count !== undefined && (
          <p className="text-[10px] text-muted-foreground mt-1">{count} records available</p>
        )}
      </div>
      <button
        onClick={onExport}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
        {loading ? "Exporting..." : done ? "Downloaded" : "Export CSV"}
      </button>
    </div>
  );
}

export default function ExportSection() {
  const [exportState, setExportState] = useState<Record<string, "idle" | "loading" | "done">>({
    bookings: "idle",
    leads: "idle",
    calls: "idle",
    callbacks: "idle",
  });

  const utils = trpc.useUtils();

  async function handleExport(type: "bookings" | "leads" | "calls" | "callbacks") {
    setExportState(s => ({ ...s, [type]: "loading" }));
    try {
      const data = await utils.export[type].fetch();
      if (data.csv) {
        const date = new Date().toISOString().split("T")[0];
        downloadCsv(data.csv, `nicks-tire-${type}-${date}.csv`);
      }
      setExportState(s => ({ ...s, [type]: "done" }));
      setTimeout(() => setExportState(s => ({ ...s, [type]: "idle" })), 3000);
    } catch (err) {
      console.error(`Export ${type} failed:`, err);
      setExportState(s => ({ ...s, [type]: "idle" }));
    }
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-border/20 pb-4">
        <h3 className="text-sm font-semibold text-foreground">Export Business Data</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Download CSV files with full attribution data including UTM source, medium, campaign, landing page, and referrer for every record.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExportCard
          title="Bookings"
          description="All booking records with service type, vehicle, status, urgency, and UTM attribution."
          onExport={() => handleExport("bookings")}
          loading={exportState.bookings === "loading"}
          done={exportState.bookings === "done"}
        />
        <ExportCard
          title="Leads"
          description="All lead records with source, urgency score, status, and UTM attribution."
          onExport={() => handleExport("leads")}
          loading={exportState.leads === "loading"}
          done={exportState.leads === "done"}
        />
        <ExportCard
          title="Phone Calls"
          description="All tracked phone click events with source page, element, and UTM attribution."
          onExport={() => handleExport("calls")}
          loading={exportState.calls === "loading"}
          done={exportState.calls === "done"}
        />
        <ExportCard
          title="Callback Requests"
          description="All callback request records with context, status, and UTM attribution."
          onExport={() => handleExport("callbacks")}
          loading={exportState.callbacks === "loading"}
          done={exportState.callbacks === "done"}
        />
      </div>

      <div className="border border-border/30 rounded-lg p-6 bg-primary/5">
        <h4 className="text-sm font-semibold text-foreground mb-2">Attribution Data Included</h4>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Every export includes UTM tracking columns (source, medium, campaign), landing page URL, and referrer.
          Use this data to calculate ROI per channel in a spreadsheet — compare your Facebook ad spend against
          the number of bookings that came from utm_source=facebook.
        </p>
      </div>
    </div>
  );
}
