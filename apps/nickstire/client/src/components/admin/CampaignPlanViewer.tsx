import { CheckCircle2, AlertTriangle, Copy, Brain, Target, Compass, Image as ImageIcon, Video, FileText, Globe, Download } from "lucide-react";
import { toast } from "sonner";
import { CampaignOutput, exportPlanToMarkdown, exportPlanToJson, generateSuggestedUtms } from "@nour/meta-ads-architect";

interface ViewerProps {
  plan: CampaignOutput;
}

function SectionCard({ title, icon, children, className = "" }: { title: string, icon: React.ReactNode, children: React.ReactNode, className?: string }) {
  return (
    <section className={`border border-border bg-card/40 rounded-lg p-4 space-y-3 ${className}`}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-foreground/80 flex items-center gap-2">
        {icon} {title}
      </h2>
      <div className="space-y-3 text-sm">{children}</div>
    </section>
  );
}

function CopyBtn({ text, label = "Copy" }: { text: string, label?: string }) {
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); }}
      className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground shrink-0"
      title="Copy to clipboard"
    >
      <Copy className="w-3 h-3" /> {label}
    </button>
  );
}

export function CampaignPlanViewer({ plan }: ViewerProps) {
  const meta = plan.exportMetadata;
  const isLlm = meta?.presetUsed === "llm-creative";
  const isFallback = meta?.presetUsed === "deterministic-fallback";
  const risk = plan.complianceRiskScan?.riskLevel;

  const downloadMarkdown = () => {
    const md = exportPlanToMarkdown(plan);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campaign-plan-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Markdown downloaded");
  };

  const utms = generateSuggestedUtms(
    plan.campaignArchitecture.namingConventions.campaign.replace(/\s+/g, '-'),
    [plan.campaignArchitecture.namingConventions.adSet.replace(/\s+/g, '-')],
    [plan.campaignArchitecture.namingConventions.ad.replace(/\s+/g, '-')]
  );

  return (
    <div className="space-y-6">
      {/* Top Banner: Metadata & Compliance */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {isLlm ? (
              <span className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-400 px-2.5 py-1 rounded-full text-xs font-semibold border border-purple-500/20">
                <Brain className="w-3 h-3" /> LLM Creative Engine
              </span>
            ) : isFallback ? (
              <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-500 px-2.5 py-1 rounded-full text-xs font-semibold border border-amber-500/20">
                <AlertTriangle className="w-3 h-3" /> LLM Failed - Deterministic Fallback Used
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded-full text-xs font-semibold border border-blue-500/20">
                <Compass className="w-3 h-3" /> Deterministic Baseline
              </span>
            )}
            <span className="text-xs text-muted-foreground">{new Date(meta?.generatedAt || "").toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-3">
            <CopyBtn text={exportPlanToJson(plan)} label="Copy JSON" />
            <button onClick={downloadMarkdown} className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground shrink-0"><Download className="w-3 h-3" /> Download MD</button>
          </div>
        </div>

        {plan.complianceRiskScan && (
          <div className={`flex flex-col gap-2 p-3 rounded-lg border ${risk === "high" ? "bg-red-500/10 border-red-500/30 text-red-500" : risk === "medium" ? "bg-amber-500/10 border-amber-500/30 text-amber-500" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"}`}>
            <div className="flex items-center gap-2 font-bold text-sm uppercase">
              {risk === "high" ? <AlertTriangle className="w-4 h-4" /> : risk === "medium" ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              Compliance Scan: {risk} Risk
            </div>
            {plan.complianceRiskScan.riskFlags.length > 0 && (
              <ul className="text-xs list-disc pl-5 space-y-1">
                {plan.complianceRiskScan.riskFlags.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
            <div className="text-xs opacity-80">{plan.complianceRiskScan.finalComplianceNotes}</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Column: Strategy */}
        <div className="space-y-4">
          <SectionCard title="Offer Positioning" icon={<Target className="w-4 h-4" />}>
            <p className="font-medium">{plan.offerPositioning.summary}</p>
            <div><span className="text-xs text-muted-foreground">Value Stack:</span><br/>{plan.offerPositioning.valueStack}</div>
            <details className="cursor-pointer text-muted-foreground hover:text-foreground">
              <summary className="font-semibold text-xs uppercase">Objections & Rebuttals</summary>
              <ul className="mt-2 space-y-2 text-foreground">
                {plan.offerPositioning.objectionsAndRebuttals.map((o, i) => (
                  <li key={i}><b>{o.objection}:</b> {o.rebuttal}</li>
                ))}
              </ul>
            </details>
          </SectionCard>

          <SectionCard title="Architecture & Targeting" icon={<Compass className="w-4 h-4" />}>
            <div><b>Objective:</b> {plan.campaignArchitecture.recommendedObjective}</div>
            <div><b>Budget Rules:</b> {plan.budgetAndDecisionRules.conservativeDefaultGuardrails}</div>
            <div><b>Scale/Kill:</b> {plan.budgetAndDecisionRules.scaleHoldKillRules}</div>
            <div className="mt-2"><b>Cold Audiences:</b><br/>{plan.audienceTargetingBlueprint.coldAudiences.join(", ")}</div>
            <div><b>Warm Audiences:</b><br/>{plan.audienceTargetingBlueprint.warmAudiences.join(", ")}</div>
          </SectionCard>

          <SectionCard title="Psychology Map" icon={<Brain className="w-4 h-4" />}>
            <div className="space-y-2">
              {plan.customerPsychologyMap.microAvatars.map((a, i) => (
                <div key={i}><b>{a.name}:</b> {a.description}</div>
              ))}
              <div><b>What to say:</b> {plan.customerPsychologyMap.whatToSay.join(", ")}</div>
              <div><b>What to avoid:</b> <span className="text-red-400">{plan.customerPsychologyMap.whatToAvoid.join(", ")}</span></div>
            </div>
          </SectionCard>

          <SectionCard title="Launch Plan" icon={<Compass className="w-4 h-4" />}>
            <ul className="list-decimal pl-4 space-y-1">
              {plan.launchAndOptimizationPlan.dayByDay7DayPlan.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </SectionCard>
        </div>

        {/* Right Column: Creative & Copy */}
        <div className="space-y-4">
          <SectionCard title="Ad Copy Bundles" icon={<FileText className="w-4 h-4" />}>
            <div className="space-y-6">
              {plan.adCopyFactory.map((b, i) => (
                <div key={i} className="bg-background border border-border rounded p-3 space-y-3 relative group">
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyBtn text={JSON.stringify(b, null, 2)} label="" />
                  </div>
                  <h3 className="font-bold text-primary">{b.bundleName}</h3>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase mb-1 flex justify-between">
                      Headlines
                      <CopyBtn text={b.headlines.join("\n")} label="" />
                    </div>
                    <ul className="list-disc pl-4">
                      {b.headlines.map((h, j) => <li key={j}>{h}</li>)}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase mb-1 flex justify-between">
                      Primary Text (Short)
                      <CopyBtn text={b.shortPrimaryTexts.join("\n")} label="" />
                    </div>
                    <ul className="list-disc pl-4">
                      {b.shortPrimaryTexts.map((t, j) => <li key={j}>{t}</li>)}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase mb-1 flex justify-between">
                      Primary Text (Long)
                      <CopyBtn text={b.longPrimaryText} label="" />
                    </div>
                    <p className="whitespace-pre-wrap">{b.longPrimaryText}</p>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase mb-1">CTAs</div>
                    <p>{b.ctaButtonRecommendations.join(", ")}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Creative Prompts" icon={<ImageIcon className="w-4 h-4" />}>
            <details className="cursor-pointer text-muted-foreground hover:text-foreground">
              <summary className="font-semibold text-xs uppercase mb-2 flex justify-between">
                Image Prompts ({plan.creativePrompts.imagePrompts.length})
                <CopyBtn text={JSON.stringify(plan.creativePrompts.imagePrompts, null, 2)} label="" />
              </summary>
              <div className="space-y-2 mt-2 text-foreground">
                {plan.creativePrompts.imagePrompts.map((p, i) => (
                  <div key={i} className="bg-background border border-border rounded p-2 text-xs">
                    <b>{p.format}</b>: {p.subject} in {p.scene}. {p.lighting}.
                  </div>
                ))}
              </div>
            </details>
            <details className="cursor-pointer text-muted-foreground hover:text-foreground mt-2">
              <summary className="font-semibold text-xs uppercase mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1"><Video className="w-3 h-3"/> Reels & UGC</span>
                <CopyBtn text={JSON.stringify(plan.creativePrompts.reelPrompts, null, 2)} label="" />
              </summary>
              <div className="space-y-3 mt-2 text-foreground">
                {plan.creativePrompts.reelPrompts.map((r, i) => (
                  <div key={i} className="bg-background border border-border rounded p-2 text-xs">
                    <b>Hook:</b> {r.hookFirst2Seconds}<br/>
                    <b>Text:</b> {r.onScreenTextPlan}
                  </div>
                ))}
                {plan.creativePrompts.ugcScriptOutlines.map((u, i) => (
                  <div key={i} className="bg-background border border-border rounded p-2 text-xs">
                    <b>UGC Arc:</b> {u.openingLine} &rarr; {u.storyArc} &rarr; {u.cta}
                  </div>
                ))}
              </div>
            </details>
          </SectionCard>

          <SectionCard title="Landing Page System" icon={<Globe className="w-4 h-4" />}>
            <div><b>Direct Response Variant:</b><br/>{plan.landingPageSystem.directResponseVariant}</div>
            <div className="mt-2"><b>Risk Reversal:</b><br/>{plan.landingPageSystem.riskReversalWording}</div>
          </SectionCard>

          <SectionCard title="UTM Tracking Links" icon={<Target className="w-4 h-4" />}>
            <div className="space-y-3">
              <p className="text-muted-foreground text-xs">Pre-built UTMs based on Meta Ads naming conventions. Use these as your Website URLs in the Ad setup.</p>
              {utms.map((u, i) => (
                <div key={i} className="bg-background border border-border rounded p-3 space-y-1 relative group">
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyBtn text={u.url} label="" />
                  </div>
                  <div className="font-semibold text-xs text-primary">Ad: {u.ad}</div>
                  <div className="text-xs break-all opacity-80">{u.url}</div>
                </div>
              ))}
            </div>
          </SectionCard>

        </div>
      </div>
    </div>
  );
}
