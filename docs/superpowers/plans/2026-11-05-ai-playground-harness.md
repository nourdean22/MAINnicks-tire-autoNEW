# AI Playground and Monorepo Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement the independent repo lanes. Steps use checkbox syntax for tracking.

**Goal:** Restore the local Companion workflow with durable one-click startup, use its verified local chat model and all configured MCP tools in the coding harness, and expose accurate AI service health/start controls in `/harness`.

**Architecture:** Keep user-only values in user-local generated configuration. A dependency-free Node CLI reads AI Playground's installed MCP list and live local model endpoint, generates an OpenCode override, and launches OpenCode in the current repository. The read-only `/harness` timer consumes the same CLI health JSON; explicit buttons may start the app or open its supported repair UI. AI Playground remains responsible for native media workflows and GPU scheduling.

**Tech Stack:** Node.js 24, Windows PowerShell, OpenCode JSON config, Claude Code mod TSX hooks and tests, AI Playground 3.3.

**Spec:** `docs/superpowers/specs/2026-11-05-ai-playground-harness-design.md`

## Global Constraints

- Never commit local paths, MCP environment values, vault path, model weights, or generated OpenCode config.
- Mirror all 11 configured MCP entries, including Desktop Commander; preserve normal permission prompts and repo standing orders.
- Do not edit AI Playground private settings or app storage directly; use its supported preset and backend setup flows.
- Preserve existing model files, chat history, and Home Agent channels-off state.
- Keep chat and large media models load-on-demand on the 8 GB GPU; do not enable keep-loaded behavior.
- Do not weaken auth, approval, channel, or OpenCode permission checks.
- Never install packages in a junctioned worktree or edit `main` directly.

## Alternatives and rulings

- Benchmarked against: AI Playground's existing Companion/native media workflows (local app UI) + OpenCode V2's official config/MCP merge model (https://opencode.ai/docs/en/config/, https://opencode.ai/docs/en/mcp-servers/) + the repo `/harness` explicit-action/read-only timer pattern (`.claude/mods/nourcity-harness/hooks/register.tsx`) · adopted: local generated provider config, per-task MCP activation, existing app media paths, and the shared health CLI · rejected: every MCP on for every request because the live full-set request exceeded context.
- Static OpenCode example vs generated user-local override: choose generated override so the configured tools and private vault value stay synchronized without entering Git.
- All MCP schemas and full skill texts in every request vs on-demand activation: keep all 11 mappings available, enable none by default, and load relevant skills directly from local folders. The `skills` MCP timed out during OpenCode startup on this PC. The complete 11-server set and four servers plus all three full skill texts exceeded the model context. Let each invocation opt in to named servers such as `desktop-commander` or `browser`. Do not write an assumed token limit into model metadata.
- Add a second media server vs retain AI Playground's native media workflows: retain native image/audio/video tools; OpenCode receives all configured MCP tools and its explicit Desktop Commander config.
- Enable backends by editing settings vs use the app's setup manager: use the vendor UI because its readiness and consent logic must remain authoritative.
- 10x option: one versioned local bridge contract serves both coding and `/harness`, preventing duplicated health logic; avoid a new background daemon.
- Kill criteria: no single live model ID; unsupported MCP types; preset cannot persist through the app UI; repair requires unapproved legal acceptance/security permission; a read-only harness tick starts or writes anything.

## Review Focus

1. Missing/malformed MCP config fails closed without partial override; test empty, invalid JSON, and missing `mcpServers`.
2. Missing endpoint or ambiguous model ID never renders healthy; test unavailable and multiple-model cases.
3. MCP environment values stay out of output and tracked files; use a sentinel secret in tests.
4. `/harness` timer stays read-only and non-overlapping; prove start/repair only runs on an explicit action.
5. Chat, media, and speech readiness remain distinct with unknown states; never claim all fit concurrently on 8 GB.

---

### Task 1: User-local bridge and OpenCode launch

**Files:** create `tools/sovereign-dev/ai-playground.mjs`, `tools/sovereign-dev/ai-playground.test.mjs`; modify `tools/sovereign-dev/README.md`, `tools/sovereign-dev/opencode.example.jsonc`.

**Interfaces:** `health --json` prints versioned status JSON with service states, model ID, and MCP names only. `configure` atomically generates a user-local OpenCode override. `opencode` launches in caller cwd with `OPENCODE_CONFIG` set to that override.

- [x] Add failing Node tests for all 11 local/remote MCP mappings, env-only-in-generated-output, malformed config, endpoint down, multiple model IDs, output redaction, coding MCP selection, and explicit additions.
- [x] Run the focused tests and confirm the new profile tests failed before implementation.
- [x] Implement using Node built-ins only; follow official config merge rules.
- [x] Run the bridge tests and load the generated V2 config through OpenCode. Live health reports the app/model endpoint OK and all 11 MCP names.
- [x] Follow-up regression: pin the selected Companion alias in both generated and inline config so the default abliterated profile does not revert to the slower reasoning alias; keep the explicit Deep Think choice.
- [ ] OpenCode with 11 MCPs exceeded 32,768 tokens; the skills-only profile later timed out connecting to the skills MCP and did not return a reply within about 85 seconds. Default profile now starts no MCPs; validate it against the local model before claiming live coding inference.

### Task 2: `/harness` health and actions

**Files:** modify `.claude/mods/nourcity-harness/hooks/register.tsx`, `types/index.ts`, `tests/harness.test.tsx`, `README.md`, and `.claude-plugin/plugin.json`.

**Interfaces:** timer and Refresh call bridge health only. Explicit `Start Playground` starts the app and probes the local model. Explicit media repair opens AI Playground when ComfyUI/OpenVINO is unavailable; it does not alter settings or accept terms.

- [x] Add failing tests for healthy/off/unavailable/malformed/unknown states and prove timer calls never start the app.
- [x] Run the focused mod test and confirm failure.
- [x] Implement local AI section and explicit buttons; the media button opens the app's supported setup UI and does not claim a deep link.
- [x] Run mod tests and Claude plugin validation (20 passed, 0 failed; validation passed).

### Task 3: Companion, shortcut, and media recovery

**Files:** create `tools/sovereign-dev/start-ai-playground-coding.cmd` and `install-playground-shortcuts.ps1`; modify `tools/sovereign-dev/README.md`; machine-local generated Desktop shortcuts.

- [x] Verified Companion, the abliterated Q4 model, and llama.cpp in the app; shortcut reopens to that saved Companion preset.
- [x] Repaired ComfyUI and OpenVINO backends through the supported app flow; downloaded approved TTS/image assets and RealESRGAN. Keep existing model files and load-on-demand behavior.
- [ ] Reinstall durable app and coding Desktop shortcuts from the primary checkout after merge; none may pass a preset argument or start downloads/channels.
- [x] Proved TTS output, ComfyUI image generation, and image upscale/edit. Whisper transcription remains unverified. Video is unavailable because the model needs 21.51 GB while only about 14.9 GB was free. The separate OpenVINO chat-model terms/download remain unapproved and untouched.

### Task 4: Reconcile and ship

**Files:** spec, `docs/agent-os/ledger/2026-11-05-ai-playground-harness.md`, `.completion/evidence.d/chore-ai-playground-harness.json`.

- [ ] Hostile-review combined diff; ensure no secrets, machine paths, model files, or generated configs appear.
- [ ] Run current bridge tests, `/harness` tests, plugin validation, whitespace check, and live bridge health. Full 11-server inference is over context; OpenCode inference remains unverified after the skills MCP startup timeout.
- [ ] Push this branch once, wait for green checks, merge through the repo merge gate, sync this machine to `origin/main`, and verify the tip.
- [ ] Add the ledger and evidence receipt to the PR and record the post-merge revision after sync.
