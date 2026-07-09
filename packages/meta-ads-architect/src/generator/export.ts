import { CampaignOutput } from "../schemas/output.js";

export function exportPlanToJson(plan: CampaignOutput): string {
  return JSON.stringify(plan, null, 2);
}

export function exportPlanToMarkdown(plan: CampaignOutput): string {
  let md = `# Meta Ads Campaign Plan

> Generated automatically by Meta Ads Architect v${plan.exportMetadata.version || '1.0'}
> Generated at: ${plan.exportMetadata.generatedAt}

## 1. Input Audit
${plan.inputAudit.summary}

### Missing Critical Items
${plan.inputAudit.missingCriticalItems.length ? plan.inputAudit.missingCriticalItems.map(i => `- ${i}`).join('\n') : "None detected."}

### Assumptions
${plan.inputAudit.assumptions.length ? plan.inputAudit.assumptions.map(a => `- ${a}`).join('\n') : "None."}

---

## 2. Offer Positioning
**Summary:** ${plan.offerPositioning.summary}

### Positioning Angles
${plan.offerPositioning.positioningAngles.map(a => `- ${a}`).join('\n')}

### Unique Mechanisms
${plan.offerPositioning.uniqueMechanisms.map(m => `- ${m}`).join('\n')}

### Value Stack
${plan.offerPositioning.valueStack}

### Objections & Rebuttals
| Objection | Rebuttal |
|-----------|----------|
${plan.offerPositioning.objectionsAndRebuttals.map(or => `| ${or.objection} | ${or.rebuttal} |`).join('\n')}

### Who Should Not Buy
${plan.offerPositioning.whoShouldNotBuy.map(w => `- ${w}`).join('\n')}

---

## 3. Customer Psychology Map
### Micro-Avatars
${plan.customerPsychologyMap.microAvatars.map(m => `- **${m.name}:** ${m.description}`).join('\n')}

### Messaging Map
- **Cold:** ${plan.customerPsychologyMap.messagingMap.cold}
- **Warm:** ${plan.customerPsychologyMap.messagingMap.warm}
- **Hot:** ${plan.customerPsychologyMap.messagingMap.hot}

### Keywords
**What to Say:**
${plan.customerPsychologyMap.whatToSay.map(w => `- ${w}`).join('\n')}

**What to Avoid:**
${plan.customerPsychologyMap.whatToAvoid.map(w => `- ${w}`).join('\n')}

---

## 4. Compliance Risk Scan
> [!${plan.complianceRiskScan.riskLevel === 'high' ? 'WARNING' : plan.complianceRiskScan.riskLevel === 'medium' ? 'CAUTION' : 'NOTE'}]
> **Risk Level:** ${plan.complianceRiskScan.riskLevel.toUpperCase()}
> ${plan.complianceRiskScan.finalComplianceNotes}

### Risk Flags
${plan.complianceRiskScan.riskFlags.length ? plan.complianceRiskScan.riskFlags.map(f => `- ${f}`).join('\n') : "None detected."}

### Safe Phrasing Swaps
| Unsafe | Safe Alternative |
|--------|------------------|
${plan.complianceRiskScan.safePhrasingSwaps.map(s => `| ${s.unsafe} | ${s.safe} |`).join('\n')}

---

## 5. Campaign Architecture
**Recommended Objective:** ${plan.campaignArchitecture.recommendedObjective}
**Rationale:** ${plan.campaignArchitecture.rationale}

### Structures
- **Beginner Safe Version:** ${plan.campaignArchitecture.beginnerSafeVersion}
- **Advanced Version:** ${plan.campaignArchitecture.advancedVersion}

### Scaling & Retargeting
- **Testing:** ${plan.campaignArchitecture.testingCampaign}
- **Scaling:** ${plan.campaignArchitecture.scalingCampaign}
- **Retargeting:** ${plan.campaignArchitecture.retargetingCampaign}
- **Placement Plan:** ${plan.campaignArchitecture.placementPlan}

### Naming Conventions
- Campaign: \`${plan.campaignArchitecture.namingConventions.campaign}\`
- Ad Set: \`${plan.campaignArchitecture.namingConventions.adSet}\`
- Ad: \`${plan.campaignArchitecture.namingConventions.ad}\`

---

## 6. Budget and Decision Rules
- **Scale, Hold, Kill Rules:** ${plan.budgetAndDecisionRules.scaleHoldKillRules}
- **Conservative Default Guardrails:** ${plan.budgetAndDecisionRules.conservativeDefaultGuardrails}

### Formulas & Assumptions
- Break Even CPA: ${plan.budgetAndDecisionRules.breakEvenCpaFormula || "N/A"}
- Target CPA: ${plan.budgetAndDecisionRules.targetCpaFormula || "N/A"}

**Assumptions:**
${plan.budgetAndDecisionRules.assumptions.map(a => `- ${a}`).join('\n')}

---

## 7. Audience Targeting Blueprint
- **Cold Audiences:** ${plan.audienceTargetingBlueprint.coldAudiences.join(', ')}
- **Warm Audiences:** ${plan.audienceTargetingBlueprint.warmAudiences.join(', ')}
- **Hot Audiences:** ${plan.audienceTargetingBlueprint.hotAudiences.join(', ')}

**Targeting Rules:**
- Exclusions: ${plan.audienceTargetingBlueprint.exclusions.join(', ') || "None"}
- Country Tier Plan: ${plan.audienceTargetingBlueprint.countryTierPlan}
- Lookalike Eligibility: ${plan.audienceTargetingBlueprint.lookalikeEligibilityCheck}

---

## 8. Creative Testing Lab
**Creative Thesis:** ${plan.creativeTestingLab.creativeThesis}

### Angles
| Angle Name | Visual Direction | Hook |
|------------|------------------|------|
${plan.creativeTestingLab.creativeAngles.map(a => `| ${a.angleName} | ${a.visualDirection} | ${a.hooks[0]} |`).join('\n')}

### Shot List
${plan.creativeTestingLab.shotList.map(s => `- ${s}`).join('\n')}

---

## 9. Ad Copy Factory
${plan.adCopyFactory.map(b => `### ${b.bundleName}
**Long Primary Text:**
> ${b.longPrimaryText}

**Short Texts:**
${b.shortPrimaryTexts.map(t => `- ${t}`).join('\n')}

**Headlines:**
${b.headlines.map(t => `- ${t}`).join('\n')}
`).join('\n\n')}

---

## 10. Creative Prompts

### Reels
${plan.creativePrompts.reelPrompts.map(r => `- **Hook (0-2s):** ${r.hookFirst2Seconds}\n  - **Text:** ${r.onScreenTextPlan}\n  - **CTA:** ${r.endFrameCta}`).join('\n')}

### Images
${plan.creativePrompts.imagePrompts.map(i => `- **Format ${i.format}:** ${i.subject} - ${i.scene}. Lighting: ${i.lighting}. Safe space: ${i.textSafeSpaceInstruction}`).join('\n')}

---

## 11. Landing Page System
- **Direct Response:** ${plan.landingPageSystem.directResponseVariant}
- **Hybrid:** ${plan.landingPageSystem.hybridVariant}
- **Risk Reversal Wording:** ${plan.landingPageSystem.riskReversalWording}

---

## 12. Launch and Optimization Plan
**Day-by-Day (Days 1-7):**
${plan.launchAndOptimizationPlan.dayByDay7DayPlan.map(d => `- ${d}`).join('\n')}

**Weeks 2-4 Loop:** ${plan.launchAndOptimizationPlan.weeks2To4Loop}
**Creative Refresh Plan:** ${plan.launchAndOptimizationPlan.creativeRefreshPlan}
**Fatigue Signals:** ${plan.launchAndOptimizationPlan.fatigueSignals.join(', ')}

---

## 13. Final Deliverables Checklist
- Setup: ${plan.finalDeliverablesChecklist.setupChecklist.join(', ')}
- Tracking: ${plan.finalDeliverablesChecklist.trackingChecklist.join(', ')}
- Copy: ${plan.finalDeliverablesChecklist.copyChecklist.join(', ')}
- Creative: ${plan.finalDeliverablesChecklist.creativeAssetChecklist.join(', ')}

`;

  return md;
}
