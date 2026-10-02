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
      if (res.needsClarification) {
        // The agent asked for more input instead of producing a post — it
        // was NOT queued as a draft. Tell the operator to refine the brief.
        toast.info("The agent needs more detail — refine your prompt and generate again.");
      } else {
        toast.success("Content generated successfully!");
      }
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
            <Sparkles className="w-4 h-4 text-fg-tertiary" />
            <h3 className="font-semibold text-sm">Agent setup</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-fg-secondary mb-1.5">
                Select specialist persona
              </label>
              {personasQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Loader2 className="w-4 h-4 animate-spin text-fg-tertiary" />
                  <span>Loading marketing agents...</span>
                </div>
              ) : (
                <select
                  value={selectedPersona}
                  onChange={(e) => setSelectedPersona(e.target.value)}
                  className="w-full bg-content border border-edge-default rounded-control px-3 py-2 text-[13px] text-fg focus:outline-none focus:border-accent"
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
              <div className="p-3 rounded-control bg-surface-raised border border-edge-subtle space-y-1">
                <span className="text-[13px] font-semibold text-fg flex items-center gap-1.5">
                  <span>{selectedPersonaMeta.emoji}</span>
                  <span>{selectedPersonaMeta.name}</span>
                </span>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {selectedPersonaMeta.description}
                </p>
              </div>
            )}

            <div>
              <label className="block text-[13px] font-medium text-fg-secondary mb-1.5">
                What should this agent draft?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Write an email sequence introducing winter tires for high performance cars, emphasizing safety and pricing..."
                rows={6}
                className="w-full bg-content border border-edge-default rounded-control px-3 py-2 text-[13px] text-fg focus:outline-none focus:border-accent resize-none"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="w-full rounded-control bg-accent hover:bg-accent-hover disabled:opacity-50 text-[var(--text-inverse)] font-semibold text-[14px] py-2 px-4 transition-colors duration-[var(--motion-state)] flex items-center justify-center gap-2"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Drafting copy...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate content</span>
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
            <Send className="w-4 h-4 text-fg-tertiary" />
            <h3 className="font-semibold text-sm">Draft output</h3>
          </div>
          {output ? (
            <div className="space-y-4">
              <div className="p-4 rounded-control bg-canvas border border-edge-subtle font-mono text-sm leading-relaxed overflow-auto max-h-[350px] whitespace-pre-wrap select-text">
                {output}
              </div>

              {providerInfo && (
                <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                  <span>Generated by: <strong className="text-fg">{providerInfo}</strong></span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-control border border-edge-default bg-content px-3 py-1.5 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
                >
                  <Copy className="w-4 h-4" />
                  <span>Copy</span>
                </button>
                <button
                  onClick={handleSendToPublish}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/[0.1] hover:bg-emerald-500/[0.2] border border-emerald-500/20 text-emerald-300 text-[13px] font-medium rounded-control transition-colors duration-[var(--motion-state)]"
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
