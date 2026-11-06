# Sovereign developer control plane

This directory is developer infrastructure. It is deliberately separate from
StateNour's product AI router.

## Daily path

1. Deterministic tools first: path search, ripgrep, AST/LSP, git, tests.
2. OpenCode is the default interactive coding shell.
3. Cheap/open models handle bounded work when they pass verification.
4. Stronger remote/open models are escalation lanes.
5. Paid frontier APIs are reserved for high-risk work or verifier failures.

Never give an autonomous agent production-write credentials by default.

## Portable bootstrap

- Linux/devcontainer: `bash scripts/dev/bootstrap.sh --install`
- Windows: `powershell scripts/dev/bootstrap.ps1 -Install`
- Inspection only: `node scripts/dev/doctor.mjs`

The repository pins Node 24 and its pnpm version in `package.json`.
Bootstrap uses Corepack so a machine-global pnpm version is not authoritative.

## Local model lane

Use the AI Playground bridge from any repository. Run the script by its absolute
path when the current directory is a different project:

```powershell
node tools/sovereign-dev/ai-playground.mjs health --json
node tools/sovereign-dev/ai-playground.mjs configure --json
node tools/sovereign-dev/ai-playground.mjs opencode
```

`health` only reads the installed app's MCP config, process state, and local
llama.cpp `/health` and `/v1/models`. It discovers the running llama-server port
on Windows, falling back to loopback port 39100 when discovery has no result.
Multiple discovered ports or anything other than one valid model stays unknown.
Use `--endpoint http://127.0.0.1:PORT` for an explicit local server; remote model
endpoints, credentials, redirects, and arbitrary URL paths are rejected.

The version 1 health contract is:

```json
{
  "schemaVersion": 1,
  "status": "OK",
  "services": {
    "playground": "OK",
    "llamaCpp": "OK",
    "coreServices": "UNKNOWN",
    "homeAgent": "UNKNOWN",
    "comfyui": "UNKNOWN",
    "openvino": "UNKNOWN",
    "tts": "UNKNOWN",
    "whisper": "UNKNOWN"
  },
  "modelId": "MODEL_ID_RETURNED_BY_LOCAL_SERVER",
  "mcp": { "status": "OK", "names": ["SERVER_NAMES_FROM_LOCAL_CONFIG"] }
}
```

Service states are `OK`, `OFF`, `UNAVAILABLE`, or `UNKNOWN`. `playground` describes
process presence; `llamaCpp` requires both successful endpoint checks and a unique
model ID. `status: OK` means the chat bridge and MCP configuration are ready; it
does not claim tool connectivity, media readiness, speech readiness, or coding
quality. The remaining services have no independently verified readiness probe
and stay `UNKNOWN`. `modelId` is null when discovery is ambiguous, unavailable,
or unsafe to publish; absolute model paths are represented by the filename only.
A missing/malformed MCP file reports `UNAVAILABLE`, never
an empty healthy list. Health exits 0 when it has produced a valid health receipt,
including an unavailable state; invalid arguments exit 1.

`configure` mirrors every entry from the user-local AI Playground `config/mcp.json`,
including Desktop Commander and disabled entries, preserving command arguments,
environment values, remote URLs and headers, enablement, and supported timeouts.
Unknown transport/config fields fail closed rather than silently dropping a tool.
It requires valid MCP config and a verified model, then atomically replaces only
`%LOCALAPPDATA%\ai-playground\config\opencode.playground.json`. The directory must
be outside Git checkouts and remain inside the resolved user-local data directory.
Every directory component must already exist and be a plain directory: symlinks
and Windows junctions are rejected before creating a temporary or output file.
The bridge never creates an app/config directory, including through a redirected
parent path.
On Windows the built-in PowerShell/.NET writer creates the temporary file with
an explicit protected DACL granting FullControl only to the current Windows user
and SYSTEM. It verifies the owner, rules, inheritance protection, and empty length
on the open handle before Node sends any configuration bytes over stdin. The
file never inherits a broad parent DACL; rename preserves its restricted DACL.
If ACL creation/verification or the write acknowledgement fails, generation
stops, removes the temporary file, and preserves the previous override. POSIX
uses exclusive creation with mode `0600`.
Private values stay in that generated file; receipts contain only states, the
verified model ID, and MCP names. No app settings or global OpenCode files change.
If a model ID reflects any nonempty string value from the MCP configuration,
including command arguments, working folders, URLs, or metadata, the probe
withholds that ID and reports `UNKNOWN` instead of echoing private configuration.
The guard derives decoded URL userinfo, values of credential or unclassified
query keys, option/assignment values, and compound tokens inside paths or text.
Only common non-secret keys (for example, format, limit, and version) are
excluded; ordinary URL host/path fragments stay private only when they contain
long opaque components. These comparison values stay in memory. Server names are checked against credentials
from every entry before any name is published; a collision rejects the MCP config.
Bearer/Basic credentials and opaque text/path tokens of at least 16 characters
are guarded as substrings too; short URL and assignment credentials have no
minimum length. Common short directory words are not substring guards.
An ID consisting entirely of a plain path/text component is also withheld;
plain components use equality so shared Windows directory words do not reject
every valid model path.
Failed validation leaves a previous override untouched and exits 1.

`opencode` requires OpenCode V2 already installed, writes a private per-run
override, then launches in the caller's current directory with `OPENCODE_CONFIG`
set. The run-specific file is removed when that OpenCode process exits, so
simultaneous runs cannot replace one another's tool selection. The bridge keeps
cleanup active from the start of private config creation through the OpenCode
process exit. On Windows it lets Ctrl+C reach the attached OpenCode console
instead of force-killing it; termination closes the child and removes the run
file. The persistent `configure` command writes the
stable user-local reference file. Since the OpenAI-compatible model listing does
not report context/output limits, the bridge does not assign unverified limits
to whichever model AI Playground currently serves. A live request with all 11
MCP servers enabled exceeded the selected model's context. The local `skills`
MCP also timed out during startup on this PC. The default therefore starts no
MCP servers and uses OpenCode's built-in coding tools. All configured MCP
entries remain in the generated catalog; add any server by repeating `--mcp`, for example
`opencode --mcp browser -- run "inspect this page in the browser"` or
`opencode --mcp skills --mcp web-search --mcp fetch -- run "research this API"`. Explicitly
selected servers are enabled only if present and enabled in AI Playground; absent,
disabled, or unknown selections fail before a config file is created. Missing
optional servers in the installed catalog are skipped in the default profile.

The generated config runs OpenCode with its own local standalone server and sets
the selected model in both the override and inline config, so project or
background-session settings cannot silently route work elsewhere. For the
recognized abliterated Qwen3.5 9B model basename (whether or not its ID includes
the `.gguf` suffix), the regular coding shortcut selects a
fast alias with hidden reasoning disabled in the request; the Deep Think
shortcut selects the same model ID with its normal reasoning behavior. Other
models use the normal Companion alias. This changes request mode, not the GGUF
file. Model-specific request bodies are supported by [OpenCode V2 provider configuration](https://opencode.ai/v2/docs/providers/).
It loads
`AI-PLAYGROUND-INSTRUCTIONS.md`, which tells Companion to discover and read
installed skills on demand, including `steal-like-an-artist`,
`reverse-engineer-anything`, and `find-skills`. This avoids loading those full
skill texts in every request. The instructions guide tool selection, fact
checking, and secret handling. `browser` enables the configured Playwright browser;
it does not promise access to the user's signed-in Chrome profile. Desktop
Commander has its own Desktop shortcut and can also be enabled with `--mcp`.

`install-playground-shortcuts.ps1` creates five durable Desktop shortcuts:
the saved AI Playground Companion, fast coding, deeper-thinking coding, coding
with Desktop Commander, and coding with the Playwright `browser` MCP.
Run it once from the checked-out repo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/sovereign-dev/install-playground-shortcuts.ps1
```

The installer finds a dedicated checkout on `main`, so the shortcuts keep
working after a feature worktree is removed and always open the merged project.
Run it after the launcher has reached that checkout. Both coding shortcuts open
the monorepo root as the starting folder. The regular coding profile connects no
MCP server by default. Use the Desktop Commander shortcut or add `--mcp NAME`
for any other configured tool, such as `skills`, `vault`,
`graphify`, or `browser`. For another project, change to its
folder from the opened terminal before starting OpenCode.

The monorepo now has a project-level `opencode.jsonc` that loads the
task-selection instructions. The coding shortcut selects the local Companion
through the bridge. Keeping model selection in that launch preserves ordinary
OpenCode usage in the repo and works only when AI Playground is healthy. The
Desktop shortcuts open the repo root, so OpenCode picks up its `AGENTS.md` and
project instructions before using project tools.

Pass `--thinking` before `--` to select full reasoning; the matching Desktop
shortcut does this for you. Pass OpenCode arguments after `--`, for example
`opencode -- run "inspect the tests"`. Existing
global/project settings follow [OpenCode's normal merge order](https://opencode.ai/docs/en/config/);
the bridge's model selector takes precedence while preserving inline settings,
including permissions. The bridge adds no approval or permission rules. A missing or
older CLI reports the [official download](https://opencode.ai/download), without
installing anything or changing paid-provider credentials.
On Windows the bridge resolves the official npm package's native executable as
well as binaries on PATH, so it works after install before PATH is refreshed and
never passes project arguments through a command shell.

The generated provider follows the current [official JSON schema](https://opencode.ai/config.json):
V2 `providers`, `package`, `settings`, and `capabilities.tools`. The older singular
`provider` examples still appear on the providers documentation page as of
2026-11-05; the machine-readable schema governs this bridge. The exact live model
ID is mapped to the stable local alias `ai-playground/companion`.
MCP entries use the schema-supported per-server compatibility form; OpenCode V2
normalizes it to `mcp.servers` and `disabled` when reading the override.

For explicit app actions only:

```powershell
node tools/sovereign-dev/ai-playground.mjs start --json
node tools/sovereign-dev/ai-playground.mjs open --json
```

Both invoke the installed AI Playground application entry point with no preset,
download, channel, or settings arguments. `open` can be used to reach the vendor's
repair UI; selecting repair steps and accepting terms remain in that UI. Their
`{ "schemaVersion": 1, "status": "OK" }` receipt means the launch request was
accepted, not that a model/preset is ready or that window focus was verified.
Failure returns `UNAVAILABLE` and exit 1. A subsequent `health --json` probes chat.
Neither action runs from a health poll.

`opencode.example.jsonc` contains only portable project instructions. The bridge
discovers the live local endpoint and model and creates the provider/tool config
per run; a static example would go stale or select an unavailable backend.
Model visibility/tool capability metadata is not proof of usable latency,
successful tool calls, or coding quality. Benchmark the local model on the
intended work before assigning autonomous changes.

Focused verification: `node --test tools/sovereign-dev/ai-playground.test.mjs`.

## Safety

- one write owner per branch/worktree
- never commit plaintext secrets
- do not bypass red verification
- no direct production DB/customer/Railway side effects
- vendor-neutral handoffs live in `handoff-template.md`

Remote CPU/GPU resources are intentionally not auto-created by bootstrap.
Provisioning those can incur spend and therefore remains an operator-approved
step after the portable environment is verified.
