"use client";

import { useEffect, useState } from "react";
import { HardDrive, AlertCircle, RefreshCw, Server, Search, UploadCloud } from "lucide-react";

/**
 * NotebookLM Cockpit
 * 
 * Embedded directly on the mastery homepage to give Nour instant
 * visual access to the Google Grounding Engine (NotebookLM).
 * 
 * Gracefully degrades with clear error states if the MCP sidecar is unreachable.
 */
export function NotebookLMCockpit() {
  const [health, setHealth] = useState<"loading" | "connected" | "disconnected">("loading");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  
  const checkHealth = () => {
    setHealth("loading");
    fetch("/api/research/notebooklm")
      .then(res => res.json())
      .then(data => {
        setHealth(data.status === "connected" ? "connected" : "disconnected");
      })
      .catch(() => setHealth("disconnected"));
  };

  useEffect(() => {
    checkHealth();
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus("Reading file...");
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        setUploadStatus("Ingesting to MCP...");
        const base64 = reader.result as string;
        const res = await fetch("/api/research/notebooklm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add_source",
            params: {
              filename: file.name,
              filetype: file.type,
              base64
            }
          })
        });
        if (res.ok) {
          setUploadStatus("Ingested successfully");
          setTimeout(() => setUploadStatus(null), 3000);
        } else {
          setUploadStatus("Ingestion failed");
          setTimeout(() => setUploadStatus(null), 4000);
        }
        setIsUploading(false);
      };
      reader.onerror = () => {
        setUploadStatus("Error reading file");
        setIsUploading(false);
        setTimeout(() => setUploadStatus(null), 3000);
      };
    } catch (err) {
      setUploadStatus("Error during ingestion");
      setIsUploading(false);
      setTimeout(() => setUploadStatus(null), 3000);
    }
  };

  return (
    <section className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-950 via-zinc-900 to-black border border-white/10 p-5 shadow-2xl transition-all hover:border-[var(--gold)]/30 flex flex-col">
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-[var(--gold)]/5 rounded-full blur-[60px] pointer-events-none" />
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 mb-4 gap-3 relative z-10">
        <div className="flex flex-row-reverse sm:flex-row items-center justify-end sm:justify-start gap-2">
          <span className="text-[10px] text-white/45 font-mono uppercase tracking-wider flex items-center gap-1.5">
            <HardDrive size={12} className="text-[var(--gold)]/50" />
            NotebookLM Engine
          </span>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider ${
            health === 'connected' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' : 
            health === 'loading' ? 'text-amber-400 border-amber-500/20 bg-amber-500/5' : 
            'text-rose-400 border-rose-500/20 bg-rose-500/5'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full shadow-sm ${
              health === 'connected' ? 'bg-emerald-500 shadow-emerald-500/50' : 
              health === 'loading' ? 'bg-amber-500 shadow-amber-500/50 animate-pulse' : 
              'bg-rose-500 shadow-rose-500/50 animate-pulse'
            }`} />
            {health === 'connected' ? 'calm · online' : health === 'loading' ? 'connecting...' : 'mcp disconnected'}
          </span>
        </div>
      </div>
      
      <div className="relative z-10 flex-1 flex flex-col justify-center">
        {health === "connected" ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <a 
                href="https://notebooklm.google.com/notebook/f693fd67-77a6-47d9-8cdd-bfd187807f02" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 rounded bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/20 hover:text-[var(--gold)] px-3 py-2.5 border border-[var(--gold)]/30 transition-colors shadow-[0_0_15px_rgba(255,215,0,0.05)] text-[10px] font-mono font-bold uppercase tracking-wider"
              >
                <Search className="h-3 w-3" />
                Open NotebookLM Workspace
              </a>
            </div>
            
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer bg-black/20 group/drop ${
                isDragging ? "border-[var(--gold)]/50 text-[var(--gold)] bg-[var(--gold)]/5" : "border-white/10 text-white/40 hover:border-[var(--gold)]/30 hover:text-[var(--gold)]/80"
              }`}
            >
               {isUploading ? (
                 <RefreshCw className="h-5 w-5 animate-spin text-[var(--gold)]" />
               ) : (
                 <UploadCloud className="h-5 w-5 group-hover/drop:scale-110 transition-transform" />
               )}
               <span className="text-[10px] uppercase font-mono tracking-wider">
                 {isUploading ? uploadStatus : (uploadStatus || "Drop source file to ingest")}
               </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 bg-black/20 rounded border border-white/5">
            <AlertCircle className="h-6 w-6 text-rose-500/80" />
            <div className="space-y-1">
              <p className="text-xs font-mono font-bold tracking-wider text-rose-400 uppercase">MCP Disconnected</p>
              <p className="text-[10px] text-white/40 max-w-[220px] mx-auto font-mono">Verify your sidecar is running and <span className="text-rose-300/70">NOTEBOOKLM_MCP_URL</span> is set.</p>
            </div>
            <button 
              onClick={checkHealth} 
              className="mt-2 flex items-center gap-2 rounded px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--bg-void)] bg-[var(--gold)] hover:bg-[var(--gold-dim)] transition-colors font-bold shadow-[0_0_15px_rgba(255,215,0,0.15)]"
            >
              <RefreshCw className={`h-3 w-3 ${health === 'loading' ? 'animate-spin' : ''}`} />
              Check Health
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
