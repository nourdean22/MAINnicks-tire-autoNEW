/**
 * AI-Powered Search Bar for Nick's Tire & Auto
 * - Instant keyword results as you type (debounced)
 * - AI natural language mode for complex queries
 * - Keyboard navigation (arrow keys, enter, escape)
 * - Full-screen overlay on mobile
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Search, X, Wrench, BookOpen, HelpCircle, Link2, Sparkles, Loader2, ArrowRight } from "lucide-react";

interface SearchResult {
  type: string;
  title: string;
  description: string;
  url: string;
  relevance: number;
  icon?: string;
}

function ResultIcon({ type }: { type: string }) {
  switch (type) {
    case "service": return <Wrench className="w-4 h-4 text-primary" />;
    case "blog": return <BookOpen className="w-4 h-4 text-nick-teal" />;
    case "faq": return <HelpCircle className="w-4 h-4 text-nick-orange" />;
    default: return <Link2 className="w-4 h-4 text-foreground/50" />;
  }
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    service: "bg-primary/15 text-primary border-primary/30",
    blog: "bg-nick-teal/15 text-nick-teal border-nick-teal/30",
    faq: "bg-nick-orange/15 text-nick-orange border-nick-orange/30",
    page: "bg-foreground/10 text-foreground/60 border-foreground/20",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${colors[type] || colors.page}`}>
      {type}
    </span>
  );
}

export default function SearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [aiMode, setAiMode] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiResults, setAiResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  // Instant keyword search (debounced)
  const { data: instantData } = trpc.search.instant.useQuery(
    { query: query.trim() },
    {
      enabled: query.trim().length >= 2 && !aiMode,
      staleTime: 30_000,
    }
  );

  // AI search mutation
  const aiSearchMutation = trpc.search.ai.useMutation({
    onSuccess: (data) => {
      setAiSummary(data.aiSummary);
      setAiResults(data.results);
    },
  });

  const results = aiMode ? aiResults : (instantData?.results ?? []);

  // Open search with Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setActiveIndex(-1);
      setAiMode(false);
      setAiSummary("");
      setAiResults([]);
    }
  }, [open]);

  // Navigate to result
  const goToResult = useCallback((result: SearchResult) => {
    setOpen(false);
    if (result.url.startsWith("#") || result.url.startsWith("/#")) {
      const hash = result.url.replace("/", "");
      window.location.hash = hash.replace("#", "");
      // Scroll to element
      const el = document.querySelector(hash);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    } else {
      navigate(result.url);
    }
  }, [navigate]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) {
        goToResult(results[activeIndex]);
      } else if (query.trim().length >= 2 && !aiMode) {
        // Trigger AI search
        setAiMode(true);
        aiSearchMutation.mutate({ query: query.trim() });
      }
    }
  };

  // Trigger AI search
  const handleAiSearch = () => {
    if (query.trim().length < 2) return;
    setAiMode(true);
    aiSearchMutation.mutate({ query: query.trim() });
  };

  if (!open) {
    return (
      <>
        {/* Desktop search trigger */}
        <button
          onClick={() => setOpen(true)}
          className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[oklch(0.17_0.004_260)] text-foreground/35 hover:border-foreground/15 hover:text-foreground/50 transition-all text-[13px]"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="text-[12px]">Search...</span>
          <kbd className="ml-2 text-[10px] bg-foreground/[0.06] px-1.5 py-0.5 rounded">⌘K</kbd>
        </button>

        {/* Mobile search trigger */}
        <button
          onClick={() => setOpen(true)}
          className="lg:hidden p-2 text-foreground/40 hover:text-foreground/60 transition-colors"
        >
          <Search className="w-5 h-5" />
        </button>
      </>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Search panel */}
      <div
        ref={containerRef}
        className="fixed z-[101] top-0 left-0 right-0 lg:top-[10vh] lg:left-1/2 lg:-translate-x-1/2 lg:max-w-2xl lg:rounded-2xl bg-[oklch(0.08_0.004_260/0.97)] backdrop-blur-2xl border border-[oklch(0.17_0.004_260)] shadow-2xl shadow-black/30 overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-foreground/10">
          <Search className="w-5 h-5 text-foreground/30 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
              if (aiMode) {
                setAiMode(false);
                setAiSummary("");
                setAiResults([]);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search services, tips, or describe your car problem..."
            className="flex-1 bg-transparent text-foreground placeholder:text-foreground/40 outline-none text-base"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setAiMode(false);
                setAiSummary("");
                setAiResults([]);
                inputRef.current?.focus();
              }}
              className="p-1 text-foreground/40 hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="text-xs text-foreground/40 hover:text-foreground transition-colors"
          >
            ESC
          </button>
        </div>

        {/* Results area */}
        <div className="max-h-[60vh] lg:max-h-[50vh] overflow-y-auto">
          {/* AI Summary */}
          {aiMode && aiSummary && (
            <div className="px-4 py-3 bg-nick-teal/5 border-b border-nick-teal/20">
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-nick-teal mt-0.5 shrink-0" />
                <p className="text-sm text-foreground/80 leading-relaxed">{aiSummary}</p>
              </div>
            </div>
          )}

          {/* Loading state for AI search */}
          {aiMode && aiSearchMutation.isPending && (
            <div className="px-4 py-8 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-nick-teal animate-spin" />
              <p className="text-sm text-foreground/50">Analyzing your question...</p>
            </div>
          )}

          {/* Results list */}
          {results.length > 0 && (
            <div className="py-2">
              {!aiMode && query.trim().length >= 2 && (
                <div className="px-4 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/25">
                    {results.length} result{results.length !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
              {results.map((result, i) => (
                <button
                  key={`${result.url}-${i}`}
                  onClick={() => goToResult(result)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                    activeIndex === i
                      ? "bg-foreground/[0.05]"
                      : "hover:bg-foreground/[0.03]"
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    <ResultIcon type={result.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[13px] text-foreground truncate">{result.title}</span>
                      <TypeBadge type={result.type} />
                    </div>
                    <p className="text-xs text-foreground/50 mt-0.5 line-clamp-1">{result.description}</p>
                  </div>
                  <ArrowRight className={`w-4 h-4 shrink-0 mt-1 transition-opacity ${activeIndex === i ? "text-primary opacity-100" : "opacity-0"}`} />
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {query.trim().length >= 2 && results.length === 0 && !aiMode && !aiSearchMutation.isPending && (
            <div className="px-4 py-8 text-center">
              <p className="text-foreground/40 text-sm">No instant results found.</p>
              <button
                onClick={handleAiSearch}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-nick-teal/10 text-nick-teal rounded-lg text-sm font-medium hover:bg-nick-teal/20 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Try AI Search
              </button>
            </div>
          )}

          {/* Initial state */}
          {query.trim().length < 2 && (
            <div className="px-4 py-6 text-center">
              <p className="text-foreground/30 text-sm">Type to search services, blog articles, and FAQs</p>
              <p className="text-foreground/20 text-xs mt-2">Or describe your car problem for AI-powered help</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-foreground/10 flex items-center justify-between">
          <div className="flex items-center gap-3 text-[10px] text-foreground/30">
            <span><kbd className="bg-foreground/10 px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
            <span><kbd className="bg-foreground/10 px-1 py-0.5 rounded">↵</kbd> select</span>
            <span><kbd className="bg-foreground/10 px-1 py-0.5 rounded">esc</kbd> close</span>
          </div>
          {query.trim().length >= 2 && !aiMode && (
            <button
              onClick={handleAiSearch}
              className="flex items-center gap-1.5 text-xs text-nick-teal hover:text-nick-teal/80 transition-colors font-medium"
            >
              <Sparkles className="w-3 h-3" />
              AI Search
            </button>
          )}
        </div>
      </div>
    </>
  );
}
