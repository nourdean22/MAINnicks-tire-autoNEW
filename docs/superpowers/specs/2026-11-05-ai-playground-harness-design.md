# AI Playground Companion + Monorepo Harness

**Status:** Approved for implementation — 2026-11-05
**Date:** 2026-11-05
**Branch:** `chore/ai-playground-harness`

## Goal

Make the saved Companion preset and Huihui Qwen3.5 9B abliterated model one click away, let the monorepo coding harness use that local model and the Companion's full MCP tool set, and show/start the local AI services from the Claude `/harness` pane.

Keep the configuration portable in this public repo: no user's local paths, vault path, credentials, model weights, or generated OpenCode config are committed.

## Evidence and constraints

- AI Playground 3.3.0-beta is installed. The last app UI read showed llama.cpp, AI Playground, OpenVINO, and ComfyUI Running; Qwen3-TTS and Whisper Installed; Home Agent Installed but its channel switch Off. The existing abliterated Q4_K_M model returned a Companion reply before the final UI test. A later context-change prompt remained stuck at “Processing prompt…” on battery power; do not count that attempt as passing.
- The running llama.cpp server answered `/health` and `/v1/models`; the returned model ID is the local GGUF path. The implementation must discover/validate the live endpoint and model ID instead of assuming a model name.
- The Companion profile is active and shows the abliterated Q4_K_M model on llama.cpp. The desktop shortcut originally passed a JSON argument that did not reliably select the preset; that unsupported argument was removed. Opening the repaired shortcut reopened the `Companion` preset and the same abliterated model. No app-private storage was edited.
- The Companion MCP config currently has 11 entries: `datetime`, `web-search`, `fetch`, `skills`, `vault`, `browser`, `desktop-commander`, `pdf`, `context7`, `vapi-docs`, and `graphify`. Nour chose to mirror all entries, including Desktop Commander.
- `opencode` is not on this PC's PATH. The repo calls OpenCode its default coding shell. The current official JSON schema validates the V2 plural `providers` map and OpenAI-compatible local endpoints/MCP; the providers prose page still shows singular `provider`, so generated config must follow the schema and live CLI validator.
- The current model is a practical fit for the Arc 140V's 8 GB GPU: its Q4_K_M file is 5.63 GB, its vision projector is 624 MB, and Playground says `Barely fits`. The abliterated model creator calls the release a proof of concept; no evidence establishes that this modified checkpoint is the top truth-seeking or coding model. Keep the working local files and describe quality limits honestly.
- Home Agent has no channels configured and its switch is off. Do not enable Telegram/Slack/LAN channels or add credentials as part of this work.


## Multimodal recovery and durability

Keep AI Playground's existing Audio, Image Gen, Image Edit, and Video modes available alongside chat. The installed app presents these modes; its Assistant exposes media generation/edit tools, speech tools, and MCP tools. This user preset must enable those capabilities so the Companion can use the app's native workflows.

Initial runtime evidence showed `comfyui-backend` and `openvino-backend` disabled. After Nour approved app setup and model downloads, the supported UI installed OpenVINO and ComfyUI; settings reported both Running. The approved Qwen3-TTS CustomVoice model was downloaded, and speech output was previously verified. DreamShaper, LCM, the safety classifier, and the approved RealESRGAN upscaler are installed. ComfyUI image generation and image upscale/edit were completed. Whisper reports Installed, but no transcription has been proven. A separate OpenVINO Qwen model still needs its model-specific license/download confirmation; it was not downloaded. Do not delete or replace existing media assets.

The app reports an 8 GB GPU and 16 GB system RAM. Keep models load-on-demand; `Keep Models Loaded` remains off. At the latest disk check, about 14.9 GB remained free while the desired video model required 21.51 GB, so video generation is not installed. Do not delete files or claim video is ready. Preserve channels as off. The repaired shortcut launched the app back into Companion with the abliterated model selected.
## Design

### 1. User-local OpenCode bridge

Add a repo-owned Windows setup/launch script under `tools/sovereign-dev` that:

1. Reads the installed AI Playground MCP config locally and maps all enabled local servers to OpenCode local MCP entries and all URL servers to remote MCP entries.
2. Preserves local environment values, including the vault path, only in a generated file under `%LOCALAPPDATA%\ai-playground\config`. It prints server names and health only, never environment values.
3. Discovers the running llama.cpp loopback port and model ID, probes `/health` and `/v1/models`, and generates an OpenCode V2 override using the verified model ID and a tool-capable OpenAI-compatible provider.
4. Launches OpenCode in the caller's current project/worktree with a private standalone server and `OPENCODE_CONFIG` pointing at that local override. The override keeps every MCP entry configured but enables none by default; `--mcp NAME` opts in to additional named servers without dropping the catalog. Skills are discovered from local project/user folders with filesystem/search tools; the configured `skills` MCP timed out during startup on this PC. A live request with every MCP enabled exceeded context, and four MCPs plus full skill texts also exceeded it; select tools and skills per task. The model listing exposes no reliable context/output metadata, so generated config must not assign assumed token limits. The bridge's inline model selector ensures its requested local model wins while preserving caller inline settings and policies. The root project config supplies instructions only; a regular OpenCode invocation outside the bridge keeps its normal model selection.
5. Detects OpenCode V2 missing and reports the official install route. The setup can install the official package only when run explicitly; it must never install a different model or alter paid-provider credentials.

The generated file is machine-local and ignored. Tracked JSONC contains only schema/examples and no machine-specific addresses except loopback defaults. OpenCode's normal permission prompts and the repo's standing orders remain active; "aggressive" means persistent investigation and initiative, not auto-approval of protected actions.

### 2. `/harness` health and start action

Extend `.claude/mods/nourcity-harness` with a local AI section that reports the app, llama.cpp endpoint/model, Core Services, and Home Agent using `OK`, `OFF`, `UNAVAILABLE`, or `UNKNOWN` distinctly. Report TTS/Whisper as installed only until their runtime health can be independently probed. A `Start Playground` button launches the installed app with the saved Companion profile, then waits briefly for the endpoint/model check. A separate `Repair media backends` action opens the vendor setup path when ComfyUI/OpenVINO is unavailable; it never edits settings files or accepts terms. It does not start message channels.

Document the new start action because the pane currently promises it only reads. Keep scheduled ticks read-only and non-overlapping; only the explicit button and `/harness` command may start the app or refresh the live board.

### 3. Desktop launch

Repair the existing desktop shortcut so it opens AI Playground with the active Companion preset and the existing local model. Preserve model files and chat history. The shortcut must not trigger downloads. Acceptance requires the UI to show Companion, the selected abliterated model, the local llama.cpp backend, all media modes enabled, and one successful response after launch.

### 4. Companion behavior

Keep the existing local prompt and tools; load concise repo-owned instructions for evidence-first answers, clear unknowns, proactive follow-through, creative options, and direct tone. Teach the model to discover and read the installed `steal-like-an-artist`, `reverse-engineer-anything`, and `find-skills` skills only when relevant. `browser` is the configured Playwright browser and can be opted into with `--mcp browser`; it is not assumed to be the user's signed-in Chrome profile. Do not claim abliteration makes the model more truthful or smarter. Keep Home Agent messaging channels off.

## Alternatives considered

- **Repo example only:** document a static OpenCode config and require hand-copying MCP entries. Rejected because it would miss Nour's private vault path and drift from the app's enabled tool list.
- **Local generated override (recommended):** mirror the exact installed tool list into a user-only OpenCode override and validate the actual local model endpoint. Chosen for complete tool coverage without publishing personal config.

## Acceptance checks

- One-click shortcut opens Companion (not Assistant), uses the existing GGUF model, and returns a response without downloading.
- The bridge launches OpenCode V2 in the current working project with the local model selected and all 11 configured MCP servers available but disabled by default. Exercise available coding tools; use `--mcp NAME` to enable research/media tools per task. Do not claim the entire 11-server set fits one request: the live full-set request exceeded the 32,768-token limit. A normal OpenCode launch in the repo retains its usual model selection.
- `/harness` shows accurate chat, media, speech, and service states. Start opens the app and reaches a healthy model endpoint; media backend repair uses the vendor flow; timer ticks remain read-only.
- No user-specific paths, secrets, model binaries, or generated configs appear in the diff. Existing global OpenCode settings remain preserved.
- Validate the Claude mod and run the targeted repo checks required for this surface before opening a PR.

## Sources

- [Intel AI Playground feature and setup map](https://github.com/intel/AI-Playground/blob/main/AGENTS.md)
- [Intel AI Playground user guide](https://github.com/intel/AI-Playground/blob/main/readme.md)
- [OpenCode V2 config](https://opencode.ai/docs/en/config/)
- [OpenCode V2 providers](https://opencode.ai/docs/providers)
- [OpenCode V2 JSON schema](https://opencode.ai/config.json)
- [OpenCode MCP servers](https://opencode.ai/docs/en/mcp-servers/)
- [OpenCode official download](https://opencode.ai/download)
- [Huihui Qwen3.5-9B abliterated model card](https://huggingface.co/huihui-ai/Huihui-Qwen3.5-9B-abliterated)
- [Q4 GGUF and projector sizes](https://huggingface.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF/tree/main)
- [Base Qwen3.5-9B benchmarks](https://huggingface.co/Qwen/Qwen3.5-9B)
