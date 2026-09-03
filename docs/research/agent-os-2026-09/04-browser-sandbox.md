# Track 4 — Browser / Computer Use + Sandboxes (researched 2026-09-03)

Merged from two passes. ⚠ = secondary aggregator, not a primary leaderboard/repo.
Version/date/activity figures pulled live from npm, PyPI and GitHub API on 2026-09-03.

## HEADLINE FOR THIS STACK
**Playwright 1.62 now bundles the MCP server and the agent CLI.** `npx playwright mcp` and
`npx playwright cli` ship in the package already depended on. **Do not install `@playwright/mcp`
separately, and do not add a new framework to get an agent-driving browser.**
Net recommendation: augment Playwright, add one caching/script-distillation layer, add
Chrome DevTools MCP for debugging, **buy nothing**.

## A. Master comparison
| Tool | License | Latest | Date | Stars | Commits/90d | Uniq authors/90d | Verdict |
|---|---|---|---|---|---|---|---|
| **playwright** | Apache-2.0 | **1.62.1** | 2026-07-30 | 95,577 | daily | Microsoft + broad | **KEEP** |
| **@playwright/mcp** | Apache-2.0 | **0.0.80** | 2026-09-01 | 36,770 | 26 | 7 | **AUGMENT — adopt now (bundled in PW 1.62)** |
| **Playwright Agents** (planner/generator/healer) | Apache-2.0 | in 1.56+ | 2025-10-06 | — | — | Microsoft | **AUGMENT** |
| **chrome-devtools-mcp** | Apache-2.0 | **1.8.0** | 2026-08-25 | 50,819 | 269 | **50** | **AUGMENT (debug lane only)** |
| puppeteer | Apache-2.0 | 25.10.0 | 2026-09-03 | — | daily | Google | **DO NOT ADD** — redundant w/ PW |
| **microsoft/Webwright** | MIT | *no tagged release* | pushed 2026-08-03 | 5,961 | **1** | **1** | **AUGMENT THE PATTERN, WATCH THE REPO** |
| browserbase/stagehand | MIT | **4.0.2** npm / 3.7.3 GH | 2026-08-20 | 24,136 | 185 | 14 | **AUGMENT (guarded)** |
| browser-use | MIT | **0.13.8** | 2026-08-16 | 112,170 | **572** | 49 | **WATCH** |
| Skyvern-AI/skyvern | **AGPL-3.0** | v1.0.52 | 2026-08-31 | 22,924 | 1,563 | 18 | **DO NOT USE** (license + 30–50k tok/10 steps) |
| steel-dev/steel-browser | Apache-2.0 | **v0.5.4-beta** | 2026-08-25 | 7,590 | **12** (62/12mo) | 6 | **WATCH** |
| browserless | **SSPL-1.0 OR commercial** | v2.56.2 | 2026-09-02 | 13,659 | 135 | 13 | **DO NOT USE** (SSPL) |
| lightpanda | **AGPL-3.0** | nightly only | tagged 2024-07-16 | 34,404 | **1,976** | 23 | **WATCH** — fastest-moving repo here; **no native Windows** |
| camoufox / rebrowser-patches / puppeteer-real-browser | mixed | stale 12–16 mo | — | — | 0 | 0 | **DO NOT USE** (stealth) |
| nanobrowser | Apache-2.0 | v0.1.13 · **2025-11-22** | — | 13,720 | **1** | 1 | **DO NOT USE** (dormant) |
| playwright-crx | Apache-2.0 | v0.15.0 · **2025-06-11** | — | 665 | **0** | 0 | **DO NOT USE** (dormant) |
| Hosted SaaS (Browserbase/Hyperbrowser/Kernel/Anchor) | proprietary | — | — | — | — | — | **DO NOT USE** at $0 preference |

**Maintainer-diversity read:** only **Playwright** and **chrome-devtools-mcp** (50 authors/90d) are
not effectively single-vendor. browser-use has 49 authors/90d but its **top-2 contributors hold
5,516 of ~10,180 commits** — high bus-factor behind a VC-funded company whose cloud is the
monetization path.

## B. Grounding modes — tokens, cost, latency
| Mode | Payload/step | Tokens/10 steps | Cost/task | Latency/step |
|---|---|---|---|---|
| **API-first (no browser)** | — | 0 | **$0** | 50–300 ms |
| **Cached/replayed script** | — | **0** | **~$0** | ~40 s full task |
| **a11y snapshot** (PW MCP, Stagehand) | 2–5 KB | ~2k–5k | $0.01–0.10 | 1–3 s (<100 ms cached) |
| **DOM-serialized tree** (browser-use) | full tree | ~7k–15k | $0.02–0.30 | ~3 s |
| **Screenshot/vision** | 100 KB+ | **~30k–50k** | **$0.10–0.50** | slowest |

**The 20–50x rule:** an a11y snapshot is 2–5 KB where the same page's screenshot is 100 KB+.
Vision costs ~an order of magnitude more per step and is **not** more accurate on structured pages.

⚠ **Counter-intuitive finding:** a11y grounding is not free on latency. OSWorld-Human
(arXiv 2506.16042) measured **tree generation alone at 3–26 s/step** on heavy pages, re-sent every
step — so long-horizon tasks can be *slower* wall-clock than vision despite far lower token cost.
Playwright MCP is actively attacking this: v0.0.78 added `browser_find` (regex/text search over the
snapshot returning snippets instead of the whole tree) + "distilled" snapshots; v0.0.80 stopped
silently downscaling screenshots.

## C. Benchmarks
### Online-Mind2Web (300 tasks / 136 sites) — leaderboard.steel.dev, updated 2026-06-29
| Agent | Score | Verifiable? |
|---|---|---|
| Browser Use Cloud (bu-max) | **97.0%** | self-reported; prompts/results published |
| GPT-5.4 Native Computer Use | 93.0% | **not independently verifiable** |
| ABP + Claude Opus 4.6 | 90.53% | third-party |
| **Webwright + GPT-5.4** | **86.7%** (top open-source framework) | MSR, code + harness open |
| ChatGPT Atlas Agent Mode | 71.0% | vendor |
| Stagehand (Gemini 2.5 CU) | 65.0% | Browserbase's own entry |

⚠ **The leaderboard is run by Steel.dev, a vendor in this market** — treat rankings as directional.
Browser Use's 97% came from "Auto-Research": Claude Code looping 20 cycles over their own eval CLI
doing tree search over agent variants. **That is benchmark-directed optimization and will not
transfer 1:1.** Notte's independent eval could **not reproduce** browser-use's 89% WebVoyager figure.
**Online-Mind2Web is effectively saturated** (top 97%, and it contains 2 impossible tasks) — expect
**Odysseys** (200 long-horizon tasks; Webwright 60.1% vs base GPT-5.4's 33.5%) to become the
discriminating benchmark, and it maps far better to multi-step operational workflows.

### OSWorld / computer use
| System | OSWorld | Notes |
|---|---|---|
| Human baseline | ~72% | |
| **UI-TARS-2** (open weights) | **47.5** | arXiv 2509.02544 |
| **Agent S3** (open *framework*) | **69.9** (72.6 w/ Behavior Best-of-N — above human) | wraps a strong closed model; 3–4x inference cost |
| Qwen3.8 Max ⚠ | 86.1 | aggregator |
| Claude Fable 5 / Mythos 5 ⚠ | ~85 | aggregator |
| **Holo2-235B-A22B** (research lic.) | OSWorld-G 76.1; **ScreenSpot-Pro 70.6 1-step / 78.5 @3-step (SOTA)** | |
| **Holo2-4B / 8B** (**Apache-2.0**) | ScreenSpot-Pro 66.1 (family) | runs on ~8–16 GB VRAM |

**Where open weights win and lose:**
- **UI grounding (click the right pixel): open weights WIN.** Holo2-4B/8B are Apache-2.0 and near-SOTA
  on ScreenSpot-Pro. **No reason to pay an API for grounding.**
- **Full OS task completion: open weights LOSE badly.** 47.5 vs ~85. That is a capability gap, not tuning.
- **Scaffolding: open wins** — Agent S3 hits 69.9–72.6 by wrapping a closed model. The *scaffold* is
  the open contribution, not the brain.

⇒ **Correct 2026 split: open-weights grounding + closed frontier reasoning + open scaffold.
Do not attempt a fully-open OSWorld-class desktop agent.**

## D. Anti-brittleness — who actually caches traces into deterministic scripts
**This is the most important axis for a single-operator agent, and only three tools genuinely do it.**

| Tool | Mechanism | Deterministic replay? | Replay cost |
|---|---|---|---|
| **Webwright Skill Factory** | Every successful solve distilled into a **parameterized Python/Playwright skill**; double-verified (at ingest + by **standalone replay without the model**); library consulted *before* solving | **Yes — real code artifacts** | **~40 s, zero tokens** |
| **Stagehand `cacheDir`** | Caches act/observe/extract resolutions; on miss or failed replay falls back to LLM and rewrites cache; v4 adds hit-count threshold | Partial (actions, not standalone script) | <100 ms, ~0 tokens |
| **Playwright MCP v0.0.80 recorder** | Records manual actions, **returns Playwright code** (TS/Py/Java/C# since v0.0.79) | **Yes — real source** | 0 |
| **Playwright Healer** (1.56+) | Runs suite, finds equivalent elements, patches locators/waits until green | Yes, on committed tests | LLM only on failure |
| browser-use / Skyvern | replan per step, no distillation | **No** | **full LLM cost every run, forever** |

**Measured payoff: Webwright's skill reuse lifted held-out WebArena accuracy 55% → 70% (+15 pp)
while cutting step counts.** Highest-leverage pattern in the landscape — MIT, ~1.5k LoC, built on
Playwright.

⚠ **Caveat:** Webwright is a **Microsoft Research drop, not a maintained product** — 44 commits
total, **1 in the last 90 days**, no tagged releases, one MSR author. **Steal the pattern, vendor the
~450-line loop; do not take it as a load-bearing dependency expecting security patches.**

⚠ **Stagehand caveat:** v3's selector cache **stores entries on Browserbase servers** — a hosted
dependency and data-egress consideration. Pin to a **local `cacheDir`** or you have silently added a
SaaS to a self-host stack. Strongest v4 features (server-side cache, Model Router, Browserbase
Agents) all require the paid cloud.

## E. Credential safety & session isolation
| Capability | Playwright MCP | Stagehand | browser-use |
|---|---|---|---|
| Ephemeral session | `--isolated` (in-memory, never hits disk) | per-session ctx | yes |
| Persistent profile | `--user-data-dir` (**default: persists logins**) | yes | yes |
| Seed cookies | `--storage-state <json>` | yes | `storage_state` |
| **Network fencing** | **`--allowed-origins` / `--blocked-origins`** | `setDomainPolicy()` (v3.7) | `allowed_domains` |
| Secret injection | `--secrets` — **explicitly documented as NOT a security feature** | `%var%` substitution | `sensitive_data` → LLM sees only `x_user`/`x_pass`; **construction fails with `InsecureSensitiveDataError` if `allowed_domains` unset** |

**The single most important line in the Playwright MCP README: "Playwright MCP is not a security
boundary."** `--secrets` is plain-text replacement to stop the LLM *accidentally* seeing values.

**browser-use has the best-designed secrets model** — domain-pinned by construction, masked in logs
and history, refuses to start unsafely. Its docs correctly warn: **disable vision when handling
secrets**, because a screenshot renders the password field's surroundings and defeats placeholder
substitution entirely.

**Practical rule: never let any framework be the only thing between an LLM and a credential.** Put
secrets in a Playwright `storage_state` JSON generated by a **human-run** login script, mount it
read-only, hand the agent an *already authenticated* session. The LLM then never touches a
credential in any modality.

## F. CAPTCHA / ToS / stealth — compliance boundary
Tools marketing circumvention (risk signal, not a feature list): Browser Use Cloud ("CAPTCHA
solving: Yes" on **every tier incl. Free"), Browserbase ("Auto captcha solving" on $20/$99 tiers),
Hyperbrowser, Skyvern's **cloud-only proprietary anti-bot** (the AGPL core explicitly excludes it),
Steel stealth plugins, and camoufox / rebrowser-patches / puppeteer-real-browser whose **entire
purpose is circumvention**.

⚠ Beyond ethics, those three are **technically obsolete**: anti-bot vendors ship detection updates
monthly, and rebrowser-patches last shipped **2025-05-09**, puppeteer-real-browser **2025-09-03** —
a 12–16-month detection-vector backlog by definition.

**Compliant posture (not legal advice):**
1. **First-party first** — automating *your own* accounts/properties (nickstire.org admin, bdnick
   `/brain`, GBP, Railway/Neon dashboards) is the overwhelming majority of real use cases and carries
   none of this risk.
2. **API before browser, always.** A browser agent touching a site with a documented API is an
   architectural failure, not a capability.
3. **Honor `robots.txt`** — Playwright does not; implement the check in your fetch layer.
4. **If a CAPTCHA appears, stop and escalate to a human.** Hard stop, not a retry.
5. **Never adopt a tool whose value proposition is defeating access controls** — including choosing a
   paid tier *because* it solves CAPTCHAs.
6. Rate-limit + descriptive UA on third-party sites; unmetered on your own.

Relevant US case law (hiQ v. LinkedIn + CFAA; Van Buren narrowing "exceeds authorized access";
Meta v. Bright Data on contract/ToS) is genuinely unsettled and jurisdiction-dependent — **but all of
it turns on access to systems you do not control. First-party automation sidesteps the question.**

## G. Sandboxes
### Managed
| Service | Isolation | Cold start | Price (Sep 2026) | Self-host? | Verdict |
|---|---|---|---|---|---|
| E2B | Firecracker microVM | ~150–200 ms | Free 100 h/mo; **Pro $150/mo** | Yes — `e2b-dev/infra` Apache-2.0, Terraform+Nomad+Consul, GCP | **AUGMENT** — self-host path real but heavy (≠ one laptop) |
| **Daytona** | Docker warm pool | <90 ms | usage-based | ❌ **CLOSED Jun 2026** — repo frozen at v0.190.0, AGPL-3.0, **no further security patches** | **DO NOT USE** — a frozen unpatched isolation boundary is worse than plain Docker |
| Modal | **gVisor** | sub-second; memory snapshots | ≈**$0.014 per 5-min 1-core sandbox** | ❌ | **AUGMENT** — best pay-per-use, ~$0 idle |
| Cloudflare Sandbox SDK | Containers + Durable Objects | fast | composite | ❌ | **WATCH** — TS-only SDK, fits the stack |
| Vercel Sandbox | ephemeral Linux VM | — | Active-CPU billing (I/O wait free) | ❌ | **WATCH** — GA 2026-01-30 |

Normalized managed cost 2026: **$55–$288/mo** for comparable workloads.

### Primitives
| Tech | License | Boot | Overhead | Snapshots | Verdict |
|---|---|---|---|---|---|
| **Firecracker** | Apache-2.0, AWS + multi-org | **~120 ms** | near-native | **✅ best-in-class** (UFFD memory streaming, kernel ≥6.1) | **KEEP as target** — needs `/dev/kvm` |
| **gVisor** (`runsc`) | Apache-2.0, Google | ms | **+18% median**, −34% net throughput | ✅ checkpoint/restore | **KEEP — best effort/benefit ratio**; ⚠ `--runtime=runsc` does NOT work under rootless Docker |
| Kata | Apache-2.0, OpenInfra multi-vendor | 150–480 ms | +47% median | ✅ | **WATCH** — K8s-oriented, overkill solo |
| Docker + hardening | Apache-2.0 | 50–200 ms | none | ❌ | **AUGMENT** — read-only rootfs, `--cap-drop ALL`, seccomp, UID 65534, tmpfs, `--pids-limit`, `--network none`. **Shared kernel = NOT a security boundary for hostile code** |
| K8s Jobs | Apache-2.0 | seconds | — | ❌ | **DO NOT USE** — enormous burden for one operator |
| **Wasmtime** | Apache-2.0 WITH LLVM-exception, Bytecode Alliance | **µs** | native-ish | ❌ | **AUGMENT** — capability-based, zero ambient authority; **WASI 0.3 preview landed in Wasmtime 37, Feb 2026** |
| WasmEdge | Apache-2.0, CNCF | µs | — | ❌ | **WATCH** |

### ⚠ Windows 11 reality check — this constrains everything
| Want | Status |
|---|---|
| Docker Desktop + WSL2 | ✅ works |
| gVisor / `runsc` | ⚠ Linux-only; inside WSL2 with caveats, not native Windows |
| **Firecracker / `/dev/kvm`** | ⚠ needs `nestedVirtualization=true` **plus** kernel/device-mapper tweaks; **broken inside `wslc` containers — the utility VM never requests virt extensions, so no `vmx`/`svm`, no `/dev/kvm`** (microsoft/WSL#40736) |
| Wasmtime | ✅ **native Windows binary, zero VM** |
| E2B self-host | ❌ not on one Windows laptop |

**Practical read: on Windows 11 the genuinely-free strong-isolation options are Wasmtime (native)
and hardened Docker/WSL2 (moderate). Firecracker is aspirational locally and belongs on a Linux VPS.**

**Genuinely $0 self-host:** Wasmtime, WasmEdge, hardened Docker, gVisor (Linux), Firecracker
(Linux+KVM), Kata, steel-browser, Playwright + MCP, browser-use, Holo2-4B/8B weights.
**Paid only:** Browserbase, Modal, Cloudflare/Vercel Sandbox, E2B managed, Daytona (self-host dead).
**OSS-but-encumbered:** Skyvern (AGPL-3.0 — genuine blocker next to a closed Next.js monorepo),
Holo2-30B/235B (research-only license), browserless (SSPL).

## H. RECOMMENDED LAYERED STRATEGY
```
L0  DETERMINISTIC API            Neon/Postgres, tRPC, gh, Railway CLI, Google APIs, Stripe
    $0 · ms · 100% reliable · NO LLM IN THE LOOP
    RULE: an agent may not open a browser for anything that has an API.
      v only if no API exists
L1  COMMITTED PLAYWRIGHT SCRIPT  hand-written or Webwright-distilled skill
    $0 · ~40s/task · deterministic replay · versioned in-repo
      v only if the script fails or the flow is new
L2  PLAYWRIGHT MCP (a11y mode)   npx playwright mcp --isolated --allowed-origins=...
    ~$0.01-0.10/task · 1-3s/step · agent explores, then EMITS a script -> promote to L1
      v only if the a11y tree can't express it (canvas, PDF, WebGL)
L3  VISION                       --caps=vision on the SAME MCP server
    $0.10-0.50/task · slowest · NEVER with secrets in scope
      v
L4  OS-LEVEL COMPUTER USE        DO NOT BUILD YET (open weights 47.5% OSWorld)
      v
L5  HUMAN                        CAPTCHA · payment · publish/send · account settings · destructive
```

**The promotion loop is the whole design. L2 is not a runtime — it is a compiler.** Every successful
L2 exploration must terminate in a committed L1 script (PW MCP v0.0.80 recorder + v0.0.79
multi-language codegen make this first-class). Steady-state cost then trends to **$0/step** and
reliability trends to deterministic. **Tools that never let you leave L2 (browser-use, Skyvern)
charge full LLM price on every run, forever.**

**Human-confirmation gates:** reuse the in-DOM two-tap pattern (iOS standalone PWA suppresses
`window.confirm`). Gate at minimum: any POST/PUT/DELETE to a third party, publish/send, payment,
credential entry, account-settings change. `--allowed-origins` is the **default-deny enforcement
layer underneath** so a prompt-injected agent cannot navigate somewhere never sanctioned.

## I. Adoption plan
| # | Action | Cost | Effort |
|---|---|---|---|
| 1 | Confirm Playwright ≥1.62; use bundled `npx playwright mcp` — do NOT add `@playwright/mcp` as a separate dep | $0 | minutes |
| 2 | Register in `.mcp.json` with `--isolated --allowed-origins=<your domains> --caps=vision` (present but off-path) | $0 | minutes |
| 3 | Add `chrome-devtools-mcp` for perf/network/console on nickstire.org + bdnick.info — **debug lane only** | $0 | minutes |
| 4 | `npx playwright init-agents` → wire the **healer** into `verify:hard` so locator drift self-repairs | $0 | ~1 h |
| 5 | **Vendor Webwright's Skill Factory pattern** (~450-line loop, MIT): agent run → parameterized Playwright script → double-verify by model-free replay → commit | $0 | ~1 day — **highest ROI** |
| 6 | Third-party auth as human-generated `storage_state` JSON, mounted read-only | $0 | ~2 h |
| 7 | Human-confirm gate on every mutating third-party action, in-DOM two-tap | $0 | ~2 h |

**Evaluate only if L1/L2 provably fails:** Stagehand v4 pinned to local `cacheDir`.
**Explicitly reject:** Skyvern (AGPL), browserless (SSPL), all stealth libs, nanobrowser +
playwright-crx (dormant), every hosted browser SaaS.

## J. Watch list (re-check ~Dec 2026)
- **Webwright** — if MSR resumes commits or a maintained fork emerges, promote pattern → dependency.
- **Playwright MCP** still 0.0.x at v0.0.80 after 18 months; a 1.0 would signal pin-worthy stability.
- **steel-browser** — 62 commits/12mo, still `v0.5.4-beta`. A 1.0 makes it the credible $0 session layer.
- **Lightpanda** — 1,976 commits/90d (9x faster / 16x less memory than Chrome on 933 real pages).
  AGPL + beta + no Windows keeps it out today.
- **Odysseys** benchmark replacing saturated Online-Mind2Web.

**Biggest risks:** Daytona's Jun-2026 closure (frozen unpatched isolation code), Skyvern's AGPL,
Stagehand's server-side cache dependency, and the Windows/`wslc` KVM gap that quietly rules out
local Firecracker.
