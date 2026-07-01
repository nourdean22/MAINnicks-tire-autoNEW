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
    <section className="group relative rounded-xl border border-[var(--glass-border)] bg-[var(--bg-surface)] p-4 shadow-sm transition-all hover:border-[var(--gold)]/30">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-[var(--gold)]" />
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-[var(--text-primary)]">
            NotebookLM Grounding
          </h2>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
          <span className={`h-1.5 w-1.5 rounded-full ${health === 'connected' ? 'bg-emerald-400' : health === 'loading' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400'}`} />
          <span className="text-[var(--text-tertiary)]">{health}</span>
        </div>
      </div>
      
      {health === "connected" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-base)] px-3 py-2 border border-[var(--border-default)] focus-within:border-[var(--gold)] transition-colors">
            <Search className="h-4 w-4 text-[var(--text-tertiary)]" />
            <input 
              type="text" 
              placeholder="Ask NotebookLM..." 
              className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] font-mono" 
            />
          </div>
          
          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer bg-[var(--bg-base)] group/drop ${
              isDragging ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/5" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold)] hover:text-[var(--gold)]"
            }`}
          >
             {isUploading ? (
               <RefreshCw className="h-5 w-5 animate-spin text-[var(--gold)]" />
             ) : (
               <UploadCloud className="h-5 w-5 group-hover/drop:scale-110 transition-transform" />
             )}
             <span className="text-xs uppercase font-mono tracking-wider">
               {isUploading ? uploadStatus : (uploadStatus || "Drop source file to ingest")}
             </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 bg-[var(--bg-base)] rounded-lg border border-[var(--border-default)]">
          <AlertCircle className="h-6 w-6 text-rose-400" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">MCP Disconnected</p>
            <p className="text-xs text-[var(--text-tertiary)] max-w-[220px] mx-auto">Verify your sidecar is running and <span className="font-mono text-rose-300">NOTEBOOKLM_MCP_URL</span> is set.</p>
          </div>
          <button 
            onClick={checkHealth} 
            className="mt-2 flex items-center gap-2 rounded px-4 py-2 text-xs font-mono uppercase tracking-wider text-[var(--bg-void)] bg-[var(--gold)] hover:bg-[var(--gold-dim)] transition-colors font-bold"
          >
            <RefreshCw className={`h-3 w-3 ${health === 'loading' ? 'animate-spin' : ''}`} />
            Check Health
          </button>
        </div>
      )}
    </section>
  );
}
