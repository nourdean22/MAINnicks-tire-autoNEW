/**
 * Shared chat types. Extracted Apr 19 during the dead-component sweep
 * so the retired ChatControlBar can be deleted without losing its
 * type contracts — the chat route still honors modeOverride,
 * providerOverride, and taskTypeOverride from the request body.
 */

// Apr 17 — quick mode removed. Standard now handles everything short
// via query-shape adaptive token caps. Deep is still the explicit
// strategy/plan/analysis path.
export type ChatModeOverride = "auto" | "standard" | "deep";

// v10.0.529.58 · "ollama" added · Ollama Cloud is the new primary
// chat provider (v529.46) and the override cycle in the ⋯ menu
// rotates through it explicitly.
export type ProviderOverride = "auto" | "ollama" | "gemini" | "openai" | "anthropic";

export type TaskTypeOverride =
  | "auto"
  | "fast"
  | "reason"
  | "deep"
  | "creative"
  | "code"
  | "classify";

export interface ChatOverrides {
  mode: ChatModeOverride;
  provider: ProviderOverride;
  taskType: TaskTypeOverride;
}

/**
 * The 3 personas Nick can inhabit. Server emits `X-Persona` on the
 * chat-stream response; client infers from the latest assistant
 * message and syncs on the isStreaming true→false edge.
 *
 * Single source of truth — `useChatTransport`, the chat page, and any
 * future persona-aware component should all import this type instead
 * of maintaining parallel string-literal unions.
 */
export type Personality = "master" | "builder" | "friend";
