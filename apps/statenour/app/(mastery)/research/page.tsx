"use client";

/**
 * /research — Statenour Research Lab & NotebookLM Cockpit
 *
 * Visual dashboard for managing research packs, copy-pasting CLI commands/prompts,
 * and reviewing extracted claims, contradictions, and recommended actions.
 */

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  FileText,
  Copy,
  CheckCircle,
  AlertTriangle,
  Layers,
  ChevronRight,
  RefreshCw,
  HelpCircle,
  AlertCircle,
  ExternalLink,
  Plus,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/layout/ui";

interface StatusMetrics {
  lastPackGenerated: string;
  packCount: number;
  lastIngest: string | null;
  failedPacks: number;
  packsAwaitingNotebookLMReview: string[];
  packsAwaitingActionExtraction: string[];
}

interface ResearchPack {
  id: string;
  key: string;
  content: string;
  slug: string;
  domain: string;
  sourceCount: number;
  confidence: number;
  ingestedAt: string;
}

interface ResearchItem {
  id: string;
  category: string;
  key: string;
  content: string;
  citation: string | null;
  requiresSourceVerification: boolean;
  verificationScore: number;
}

export default function ResearchLabPage() {
  const [status, setStatus] = useState<StatusMetrics | null>(null);
  const [packs, setPacks] = useState<ResearchPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<ResearchPack | null>(null);
  const [packItems, setPackItems] = useState<ResearchItem[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingPacks, setLoadingPacks] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);

  // New Pack Quick Commands Builder State
  const [newTopic, setNewTopic] = useState("");
  const [newDomain, setNewDomain] = useState("business");
  const [newDepth, setNewDepth] = useState("standard");
  const [newSources, setNewSources] = useState("");
  const [includeRepo, setIncludeRepo] = useState(false);
  const [includeObsidian, setIncludeObsidian] = useState(true);
  const [includeStatenour, setIncludeStatenour] = useState(true);

  // Fetch stats & status
  const fetchStatus = async () => {
    try {
      setLoadingStatus(true);
      const res = await fetch("/api/research/status");
      if (res.ok) {
        const data = await res.json();
        // Handle Next.js apiHandler response envelope
        if (data && typeof data === "object" && "ok" in data) {
          if (data.ok) {
            setStatus(data.data || null);
          } else {
            toast.error(data.error || "Failed to load status metrics.");
          }
        } else {
          setStatus(data);
        }
      }
    } catch (err) {
      toast.error("Failed to load status metrics.");
    } finally {
      setLoadingStatus(false);
    }
  };

  // Fetch research packs list
  const fetchPacks = async () => {
    try {
      setLoadingPacks(true);
      const res = await fetch("/api/research/packs");
      if (res.ok) {
        const data = await res.json();
        let packsList: ResearchPack[] = [];
        
        // Handle Next.js apiHandler response envelope
        if (data && typeof data === "object" && "ok" in data) {
          if (data.ok) {
            packsList = data.data || [];
          } else {
            toast.error(data.error || "Failed to fetch research packs.");
          }
        } else {
          packsList = Array.isArray(data) ? data : [];
        }

        setPacks(packsList);
        if (packsList.length > 0 && !selectedPack) {
          setSelectedPack(packsList[0]);
        }
      }
    } catch (err) {
      toast.error("Failed to fetch research packs.");
    } finally {
      setLoadingPacks(false);
    }
  };

  // Fetch items for selected pack
  const fetchPackItems = async (slug: string) => {
    try {
      setLoadingItems(true);
      const res = await fetch(`/api/research/packs/items?slug=${slug}`);
      if (res.ok) {
        const data = await res.json();
        let itemsList: ResearchItem[] = [];
        
        // Handle Next.js apiHandler response envelope
        if (data && typeof data === "object" && "ok" in data) {
          if (data.ok) {
            itemsList = data.data || [];
          } else {
            toast.error(data.error || "Failed to fetch pack items.");
          }
        } else {
          itemsList = Array.isArray(data) ? data : [];
        }

        setPackItems(itemsList);
      }
    } catch (err) {
      toast.error("Failed to fetch pack items.");
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchPacks();
  }, []);

  useEffect(() => {
    if (selectedPack) {
      fetchPackItems(selectedPack.slug);
    } else {
      setPackItems([]);
    }
  }, [selectedPack]);

  const handleCopyText = (text: string, label = "Command copied") => {
    navigator.clipboard.writeText(text);
    toast.success(label);
  };

  // Build the CLI command based on form choices
  const cliCommand = useMemo(() => {
    let cmd = `pnpm research:pack --topic "${newTopic || "Your Topic"}" --domain ${newDomain} --depth ${newDepth}`;
    if (includeRepo) cmd += " --include-repo";
    if (includeObsidian) cmd += " --include-obsidian";
    if (includeStatenour) cmd += " --include-statenour";
    if (newSources.trim()) {
      const urls = newSources.split("\n").filter((url) => url.trim());
      urls.forEach((url) => {
        cmd += ` --source "${url.trim()}"`;
      });
    }
    return cmd;
  }, [newTopic, newDomain, newDepth, includeRepo, includeObsidian, includeStatenour, newSources]);

  // Group items by category for detailed display
  const groupedItems = useMemo(() => {
    return {
      claims: packItems.filter((i) => i.category === "research_claim"),
      contradictions: packItems.filter((i) => i.category === "research_contradiction"),
      actions: packItems.filter((i) => i.category === "research_action"),
      questions: packItems.filter((i) => i.category === "research_question"),
    };
  }, [packItems]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-4 pb-20">
      <div className="flex justify-between items-center">
        <PageHeader eyebrow="INTELLIGENCE" title="Research Lab" description="NotebookLM Source Packs & Grounded Ingest Cockpit" />
        <button
          onClick={() => {
            fetchStatus();
            fetchPacks();
            if (selectedPack) fetchPackItems(selectedPack.slug);
          }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          REFRESH
        </button>
      </div>

      {/* 1. Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 backdrop-blur-sm">
          <div className="text-zinc-500 text-xs font-mono uppercase tracking-wider mb-1">Total Packs</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-zinc-200 font-mono">
              {loadingStatus ? "..." : status?.packCount ?? 0}
            </span>
            <span className="text-xs text-zinc-500">packs generated</span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 backdrop-blur-sm">
          <div className="text-zinc-500 text-xs font-mono uppercase tracking-wider mb-1">Last Ingest Run</div>
          <div className="text-sm font-medium text-zinc-300 font-mono truncate">
            {loadingStatus ? "..." : status?.lastIngest ? new Date(status.lastIngest).toLocaleDateString() : "Never"}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 backdrop-blur-sm">
          <div className="text-zinc-500 text-xs font-mono uppercase tracking-wider mb-1">Awaiting NotebookLM</div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-amber-500 font-mono">
              {loadingStatus ? "..." : (status?.packsAwaitingNotebookLMReview?.length ?? 0)}
            </span>
            <span className="text-xs text-zinc-500">review queue</span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 backdrop-blur-sm">
          <div className="text-zinc-500 text-xs font-mono uppercase tracking-wider mb-1">Awaiting Ingest</div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-indigo-400 font-mono">
              {loadingStatus ? "..." : (status?.packsAwaitingActionExtraction?.length ?? 0)}
            </span>
            <span className="text-xs text-zinc-500">action backlog</span>
          </div>
        </div>
      </div>

      {/* 2. CLI Generator Box & Guide */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 space-y-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
            <Sparkles className="h-4.5 w-4.5 text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-200">CLI Source Pack Generator Builder</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-zinc-500">TOPIC/MISSION NAME</label>
              <input
                type="text"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="e.g. VAPI latency mitigation"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-zinc-500">DOMAIN</label>
              <select
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700"
              >
                <option value="business">Business / Local SEO</option>
                <option value="ai_system">AI / LLM Architecture</option>
                <option value="health">Clinical / Medical Health</option>
                <option value="personal_os">Personal Operating System</option>
                <option value="finance">Capital / Financial</option>
                <option value="general">General / Other</option>
              </select>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-mono text-zinc-500">EXTERNAL URLS (One per line — Scraped via Firecrawl)</label>
              <textarea
                value={newSources}
                onChange={(e) => setNewSources(e.target.value)}
                placeholder="https://example.com/blog-post"
                rows={2}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-700 resize-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeObsidian}
                onChange={(e) => setIncludeObsidian(e.target.checked)}
                className="rounded border-zinc-800 bg-zinc-950 text-zinc-200"
              />
              <span className="text-xs text-zinc-400">Search Obsidian Notes</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeStatenour}
                onChange={(e) => setIncludeStatenour(e.target.checked)}
                className="rounded border-zinc-800 bg-zinc-950 text-zinc-200"
              />
              <span className="text-xs text-zinc-400">Search BrainMemory DB</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeRepo}
                onChange={(e) => setIncludeRepo(e.target.checked)}
                className="rounded border-zinc-800 bg-zinc-950 text-zinc-200"
              />
              <span className="text-xs text-zinc-400">Search Codebase Files</span>
            </label>
          </div>

          {/* Generated Command box */}
          <div className="rounded-lg border border-zinc-900 bg-zinc-950 p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono text-zinc-500">Run this in your terminal:</span>
              <button
                onClick={() => handleCopyText(cliCommand, "CLI Command copied")}
                disabled={!newTopic}
                className="flex items-center gap-1 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              >
                <Copy className="h-3 w-3" />
                COPY
              </button>
            </div>
            <div className="font-mono text-xs text-zinc-300 break-all select-all">
              {cliCommand}
            </div>
          </div>
        </div>

        {/* Guides / Upload card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 space-y-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
            <BookOpen className="h-4.5 w-4.5 text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-200">How the Grounded Loop Works</h2>
          </div>

          <div className="space-y-3 text-xs text-zinc-400">
            <div className="flex gap-2">
              <div className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300 text-[10px] h-fit">1</div>
              <div>
                <strong>Generate Pack</strong>: Compile relevant local docs + scraped web pages into a RAG-distilled pack folder.
              </div>
            </div>
            <div className="flex gap-2">
              <div className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300 text-[10px] h-fit">2</div>
              <div>
                <strong>Upload to NotebookLM</strong>: Import the files from <code className="text-zinc-300 font-mono">notebooklm-upload/</code> into a NotebookLM notebook.
              </div>
            </div>
            <div className="flex gap-2">
              <div className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300 text-[10px] h-fit">3</div>
              <div>
                <strong>Run Critique Debate</strong>: Run adversarial prompts inside NotebookLM. Save generated markdown answers inside <code className="text-zinc-300 font-mono">notebooklm-output/</code>.
              </div>
            </div>
            <div className="flex gap-2">
              <div className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300 text-[10px] h-fit">4</div>
              <div>
                <strong>Ingest and Ground</strong>: Run output ingestion CLI. Claims matching below <code className="text-zinc-300 font-mono">0.80</code> vector similarity are automatically flagged for review.
              </div>
            </div>
          </div>

          {/* Copy-paste prompt templates */}
          <div className="space-y-2 pt-2 border-t border-zinc-900">
            <div className="text-[10px] font-mono text-zinc-500 uppercase">Debate Prompt:</div>
            <button
              onClick={() =>
                handleCopyText(
                  `Run a debate between two operators analyzing this topic:
1. SKEPTICAL OPERATOR: Focuses on execution risks, cash flow constraints, down-side traps, resource dilution, and structural friction.
2. OPTIMISTIC OPERATOR: Focuses on speed, compounding outcomes, returns on capital, leverage, and scale.
Detail their arguments, identify contradictions in the sources, and highlight weak evidence.`,
                  "Debate Prompt copied"
                )
              }
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-zinc-900 bg-zinc-950 hover:bg-zinc-900 text-xs text-zinc-300 transition-colors text-left"
            >
              <span>Adversarial Debate Prompt</span>
              <Copy className="h-3 w-3 text-zinc-500" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Research Pack Explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Packs list panel */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3 backdrop-blur-sm h-fit">
          <div className="text-xs font-mono text-zinc-500 uppercase border-b border-zinc-900 pb-2 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Active Packs ({packs.length})
          </div>

          {loadingPacks ? (
            <div className="text-xs text-zinc-500 text-center py-8 font-mono">Loading packs...</div>
          ) : packs.length === 0 ? (
            <div className="text-xs text-zinc-500 text-center py-8 font-mono">No packs ingested yet.</div>
          ) : (
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {packs.map((p) => {
                const isSelected = selectedPack?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPack(p)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left ${
                      isSelected
                        ? "border-zinc-700 bg-zinc-900/50"
                        : "border-zinc-900 bg-zinc-950/40 hover:border-zinc-800"
                    }`}
                  >
                    <div className="space-y-1 truncate pr-2">
                      <div className="text-xs font-semibold text-zinc-200 truncate">
                        {p.key.replace("pack_", "").replace(/-/g, " ")}
                      </div>
                      <div className="flex gap-2 text-[10px] font-mono text-zinc-500">
                        <span>{p.domain.toUpperCase()}</span>
                        <span>•</span>
                        <span>{p.sourceCount} sources</span>
                      </div>
                    </div>
                    <ChevronRight
                      className={`h-4 w-4 text-zinc-600 transition-transform ${isSelected ? "transform translate-x-0.5 text-zinc-400" : ""}`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected pack detail panel */}
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 space-y-6 backdrop-blur-sm min-h-[400px]">
          {selectedPack ? (
            <div className="space-y-6">
              {/* Header info */}
              <div className="border-b border-zinc-900 pb-4 flex justify-between items-start">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-zinc-200">
                    {selectedPack.key.replace("pack_", "").replace(/-/g, " ")}
                  </h3>
                  <div className="flex gap-3 text-xs font-mono text-zinc-500">
                    <span>DOMAIN: {selectedPack.domain.toUpperCase()}</span>
                    <span>•</span>
                    <span>CONFIDENCE: {Math.round(selectedPack.confidence * 100)}%</span>
                    <span>•</span>
                    <span>INGESTED: {new Date(selectedPack.ingestedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <button
                    onClick={() =>
                      handleCopyText(
                        `pnpm research:ingest --slug "${selectedPack.slug}"`,
                        "Ingest command copied"
                      )
                    }
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] font-mono text-zinc-300 transition-all"
                  >
                    <Copy className="h-3 w-3" />
                    INGEST COMMAND
                  </button>
                  <button
                    onClick={() =>
                      handleCopyText(
                        `pnpm research:notebooklm --slug "${selectedPack.slug}"`,
                        "NotebookLM Ingest command copied"
                      )
                    }
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] font-mono text-zinc-300 transition-all"
                  >
                    <Copy className="h-3 w-3" />
                    INGEST OUTPUTS
                  </button>
                </div>
              </div>

              {/* Items content */}
              {loadingItems ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <RefreshCw className="h-6 w-6 text-zinc-600 animate-spin" />
                  <span className="text-xs font-mono text-zinc-500">Loading pack claims and actions...</span>
                </div>
              ) : packItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-2">
                  <FileText className="h-8 w-8 text-zinc-700" />
                  <div className="text-xs font-mono text-zinc-400 font-semibold">No Findings Ingested Yet</div>
                  <p className="text-[11px] text-zinc-500 max-w-sm">
                    Feed sources to NotebookLM, copy findings into files inside <code className="text-zinc-400">notebooklm-output/</code>, and run output ingestion to view them here.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Extracted Claims */}
                  {groupedItems.claims.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 border-l-2 border-indigo-500 pl-2">
                        Extracted Claims ({groupedItems.claims.length})
                      </h4>
                      <div className="space-y-2">
                        {groupedItems.claims.map((claim) => (
                          <div
                            key={claim.id}
                            className={`p-3 rounded-lg border text-xs leading-relaxed space-y-2 ${
                              claim.requiresSourceVerification
                                ? "bg-amber-950/15 border-amber-900/60"
                                : "bg-zinc-950/40 border-zinc-900"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {claim.requiresSourceVerification ? (
                                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                              ) : (
                                <CheckCircle className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                              )}
                              <div className="space-y-1 flex-1">
                                <p className="text-zinc-200">{claim.content}</p>
                                {claim.citation && (
                                  <div className="text-[10px] font-mono text-zinc-500">
                                    Citation: {claim.citation}
                                  </div>
                                )}
                              </div>
                              <span
                                className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                  claim.requiresSourceVerification
                                    ? "bg-amber-950 border border-amber-800 text-amber-400"
                                    : "bg-zinc-900 text-green-400 border border-zinc-800"
                                }`}
                              >
                                {Math.round(claim.verificationScore * 100)}% Match
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Contradictions */}
                  {groupedItems.contradictions.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 border-l-2 border-red-500 pl-2">
                        Contradictions & Debate points ({groupedItems.contradictions.length})
                      </h4>
                      <div className="space-y-2">
                        {groupedItems.contradictions.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 rounded-lg border bg-red-950/10 border-red-900/50 text-xs leading-relaxed flex items-start gap-2"
                          >
                            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <p className="text-zinc-200">{item.content}</p>
                              {item.citation && (
                                <div className="text-[10px] font-mono text-red-400/60">
                                  Citation: {item.citation}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommended Actions */}
                  {groupedItems.actions.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 border-l-2 border-green-500 pl-2">
                        Extracted Actions & Tasks ({groupedItems.actions.length})
                      </h4>
                      <div className="space-y-2">
                        {groupedItems.actions.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 rounded-lg border bg-zinc-950/40 border-zinc-900 text-xs leading-relaxed flex items-start gap-2"
                          >
                            <CheckCircle className="h-4 w-4 text-zinc-600 shrink-0 mt-0.5" />
                            <p className="text-zinc-300 flex-1">{item.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Open Questions */}
                  {groupedItems.questions.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 border-l-2 border-sky-500 pl-2">
                        Extracted Research Questions ({groupedItems.questions.length})
                      </h4>
                      <div className="space-y-2">
                        {groupedItems.questions.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 rounded-lg border bg-zinc-950/40 border-zinc-900 text-xs leading-relaxed flex items-start gap-2"
                          >
                            <HelpCircle className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
                            <p className="text-zinc-300 flex-1">{item.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-32 text-center space-y-2">
              <Layers className="h-10 w-10 text-zinc-700" />
              <div className="text-xs font-mono text-zinc-500 uppercase">Select a pack to view findings</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MissionsPageSkeleton() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto px-4 py-6 animate-pulse">
      <div className="h-12 bg-zinc-900 rounded-lg w-1/3"></div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-zinc-900 rounded-lg"></div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 h-64 bg-zinc-900 rounded-lg"></div>
        <div className="h-64 bg-zinc-900 rounded-lg"></div>
      </div>
    </div>
  );
}
