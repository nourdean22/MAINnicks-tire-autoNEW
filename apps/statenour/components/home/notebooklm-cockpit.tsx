"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, BookOpen, ExternalLink, RefreshCw, UploadCloud } from "lucide-react";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const DEFAULT_WORKSPACE_URL = "https://notebooklm.google.com/";

type HealthState = "loading" | "connected" | "disconnected" | "error";

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface NotebookHealth {
  status: "connected" | "disconnected" | "error";
  message?: string;
}

interface NotebookToolResult {
  tool: string;
  results?: unknown;
  error?: string;
}

function unwrap<T>(payload: ApiEnvelope<T> | T): T {
  if (payload && typeof payload === "object" && "ok" in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.ok || envelope.data === undefined) {
      throw new Error(envelope.error || "NotebookLM request failed");
    }
    return envelope.data;
  }
  return payload as T;
}

export function NotebookLMCockpit() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<HealthState>("loading");
  const [healthMessage, setHealthMessage] = useState<string>("Checking the local research bridge...");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const checkHealth = async () => {
    setHealth("loading");
    setHealthMessage("Checking the local research bridge...");
    try {
      const response = await fetch("/api/research/notebooklm", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "NotebookLM health request failed");
      }
      const result = unwrap<NotebookHealth>(payload);
      setHealth(result.status === "connected" ? "connected" : result.status);
      setHealthMessage(result.message || "No health detail returned");
    } catch (error) {
      setHealth("error");
      setHealthMessage(error instanceof Error ? error.message : "NotebookLM health check failed");
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  const uploadFile = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadStatus("File is larger than the 8 MB cockpit limit");
      return;
    }

    setIsUploading(true);
    setUploadStatus("Reading source...");

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the selected file"));
        reader.readAsDataURL(file);
      });

      setUploadStatus("Sending to the Statenour intelligence notebook...");
      const response = await fetch("/api/research/notebooklm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_source",
          notebookAlias: "statenour-intel",
          params: {
            filename: file.name,
            filetype: file.type || "application/octet-stream",
            base64,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "NotebookLM ingestion request failed");
      }
      const result = unwrap<NotebookToolResult>(payload);
      if (result.error) throw new Error(result.error);

      setUploadStatus("Source accepted by the NotebookLM bridge");
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "NotebookLM ingestion failed");
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadStatus(null), 5000);
    }
  };

  const statusClass = health === "connected"
    ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
    : health === "loading"
      ? "text-amber-400 border-amber-500/20 bg-amber-500/5"
      : "text-rose-400 border-rose-500/20 bg-rose-500/5";

  return (
    <section className="group relative overflow-hidden rounded-2xl border border-glass bg-elevated p-5 shadow-2xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-glass pb-4 gap-3">
        <div className="space-y-1">
          <span className="text-[10px] text-fg-secondary font-mono uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen size={12} className="text-gold" />
            NotebookLM grounded-research bridge
          </span>
          <p className="text-[10px] text-fg-secondary">External research workspace · not canonical Statenour memory</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[9px] font-mono uppercase tracking-wider ${statusClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${health === "connected" ? "bg-emerald-500" : health === "loading" ? "bg-amber-500 animate-pulse" : "bg-rose-500"}`} />
          {health === "connected" ? "sidecar connected" : health === "loading" ? "checking" : "bridge unavailable"}
        </span>
      </div>

      <div className="rounded border border-glass bg-raised p-3 text-[10px] font-mono">
        <p className="text-fg">{healthMessage}</p>
        <p className="text-fg-secondary mt-1">Connection proves the MCP sidecar is reachable; each notebook action still validates its configured alias and Google session.</p>
      </div>

      {health === "connected" ? (
        <>
          <a
            href={process.env.NEXT_PUBLIC_NOTEBOOKLM_WORKSPACE_URL || DEFAULT_WORKSPACE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded border border-gold/30 bg-gold/10 px-3 py-2.5 text-[10px] font-mono font-bold uppercase tracking-wider text-gold hover:bg-gold/20"
          >
            <ExternalLink className="h-3 w-3" />
            Open NotebookLM
          </a>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) uploadFile(file);
            }}
            disabled={isUploading}
            className={`border border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 transition-colors bg-raised ${isDragging ? "border-gold/60 text-gold" : "border-glass text-fg-secondary hover:border-gold/30 hover:text-gold"}`}
          >
            {isUploading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
            <span className="text-[10px] uppercase font-mono tracking-wider">{uploadStatus || "Choose or drop a source file"}</span>
            <span className="text-[9px] font-mono opacity-70">Maximum 8 MB · routed to statenour-intel</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadFile(file);
              event.currentTarget.value = "";
            }}
          />
        </>
      ) : (
        <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 rounded border border-rose-500/10 bg-raised">
          <AlertCircle className="h-6 w-6 text-rose-500/80" />
          <p className="text-[10px] text-fg-secondary max-w-sm">Start the authenticated local NotebookLM sidecar, expose its SSE endpoint securely, and set NOTEBOOKLM_MCP_URL on Railway.</p>
          <button type="button" onClick={checkHealth} className="flex items-center gap-2 rounded px-4 py-2 text-[10px] font-mono uppercase tracking-wider bg-gold text-black font-bold">
            <RefreshCw className={`h-3 w-3 ${health === "loading" ? "animate-spin" : ""}`} />
            Check again
          </button>
        </div>
      )}
    </section>
  );
}
