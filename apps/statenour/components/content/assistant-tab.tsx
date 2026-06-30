"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Panel } from "@/components/panel";
import { Loader2, Copy, Send, Sparkles, AlertCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function AssistantTab() {
  const router = useRouter();
  const [selectedPersona, setSelectedPersona] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [providerInfo, setProviderInfo] = useState<string>("");

  const personasQuery = trpc.operator.getMarketingPersonas.useQuery();
  const generateMutation = trpc.operator.generateMarketingContent.useMutation();

  const handleGenerate = async () => {
    if (!selectedPersona) {
      toast.error("Please select a marketing specialist agent first.");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Please describe what you want the agent to draft.");
      return;
    }

    try {
      const res = await generateMutation.mutateAsync({
        personaKey: selectedPersona,
        prompt: prompt.trim(),
      });
      setOutput(res.content);
      setProviderInfo(res.provider || "LLM Engine");
      toast.success("Content generated successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate content");
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    toast.success("Copied to clipboard!");
  };

  const handleSendToPublish = () => {
    // Navigate to the publish tab and pre-fill the caption
    const encodedCaption = encodeURIComponent(output);
    router.push(`/content?tab=publish&caption=${encodedCaption}`);
    toast.info("Transferred content to the Publish tab.");
  };

  const personas = personasQuery.data || [];
  const selectedPersonaMeta = personas.find((p) => p.key === selectedPersona);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
      {/* Controls Column */}
      <div className="space-y-4 md:col-span-5">
        <Panel>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-amber-300" />
            <h3 className="font-semibold text-sm">Agent Setup</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5 uppercase tracking-wider">
                Select Specialist Persona
              </label>
              {personasQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--brand)]" />
                  <span>Loading marketing agents...</span>
                </div>
              ) : (
                <select
                  value={selectedPersona}
                  onChange={(e) => setSelectedPersona(e.target.value)}
                  className="w-full bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
                >
                  <option value="">-- Choose an Agent --</option>
                  {personas.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.emoji} {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedPersonaMeta && (
              <div className="p-3 rounded-md bg-zinc-500/[0.04] border border-[var(--border-primary)] space-y-1">
                <span className="text-xs font-bold text-[var(--brand)] flex items-center gap-1.5">
                  <span>{selectedPersonaMeta.emoji}</span>
                  <span>{selectedPersonaMeta.name}</span>
                </span>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {selectedPersonaMeta.description}
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5 uppercase tracking-wider">
                What should this agent draft?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Write an email sequence introducing winter tires for high performance cars, emphasizing safety and pricing..."
                rows={6}
                className="w-full bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)] resize-none"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="w-full bg-[var(--brand)] hover:opacity-90 disabled:opacity-50 text-[var(--bg-page)] font-semibold text-sm py-2 px-4 rounded-md transition-all flex items-center justify-center gap-2"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Drafting copy...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Content</span>
                </>
              )}
            </button>
          </div>
        </Panel>
      </div>

      {/* Output Column */}
      <div className="space-y-4 md:col-span-7">
        <Panel>
          <div className="flex items-center gap-2 mb-4">
            <Send className="w-4 h-4 text-emerald-300" />
            <h3 className="font-semibold text-sm">Draft Output</h3>
          </div>
          {output ? (
            <div className="space-y-4">
              <div className="p-4 rounded-md bg-[var(--bg-page)] border border-[var(--border-primary)] font-mono text-sm leading-relaxed overflow-auto max-h-[350px] whitespace-pre-wrap select-text">
                {output}
              </div>

              {providerInfo && (
                <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                  <span>Generated by: <strong className="text-[var(--brand)]">{providerInfo}</strong></span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-500/[0.1] hover:bg-zinc-500/[0.2] border border-[var(--border-primary)] text-sm rounded-md transition-all"
                >
                  <Copy className="w-4 h-4" />
                  <span>Copy</span>
                </button>
                <button
                  onClick={handleSendToPublish}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/[0.1] hover:bg-emerald-500/[0.2] border border-emerald-500/20 text-emerald-300 text-sm rounded-md transition-all"
                >
                  <span>Publish</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--text-secondary)]">
              <AlertCircle className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">Select an agent, write your prompt, and click generate to create high-impact copy.</p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
