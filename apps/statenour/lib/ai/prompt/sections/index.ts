/**
 * lib/ai/prompt/sections/index.ts · Wave 84 · 2026-05-17
 *
 * Barrel re-exports for the per-section formatters that compose the
 * v1 system prompt. Each section is a pure function (preloaded data
 * → string[]) so the orchestrator in lib/ai/system-prompt.ts can do
 * its DB fan-out once and then assemble the prompt without buried
 * 50-line inline `p.push(...)` runs.
 *
 * Naming convention: `render<SectionName>` for every export. Order
 * here follows the composition order in the orchestrator.
 */

export {
  renderIdentityAndBehavior,
  renderToolsCatalog,
  renderBuilderMode,
  renderCodingAndArchitectureMemories,
} from "./identity";
export { renderLifeOps } from "./life-ops";
export { renderLiveState } from "./live-state";
export { renderCameraIntel } from "./camera-intel";
export { renderLiveMetrics, renderLiveShopStatus } from "./live-shop";
export {
  renderPinnedMemories,
  renderHotRules,
} from "./pinned-memories";
export {
  renderChatPatternAdaptations,
  renderRecentChatsFallback,
} from "./chat-pattern";
export {
  renderSmartDevicesSummary,
  renderAutomationRules,
  renderIntegrationSyncs,
  renderAiToolsHealth,
  renderRecentBrainDumps,
} from "./automation-and-health";
