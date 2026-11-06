# Shop OS 12: a local AI box and a machine mesh

# Current status (2026-11-06)

Gemma 3 4B/Ollama is a historical candidate, not a verified deployment. Planning notes say a front-desk install handoff was sent, but its receipt was still owed. Re-check the PC before treating it as installed. Section 8 below and [the newer design](18-SUPPLIER-DESKTOP-OFFLINE-AI.md) supersede earlier "install now" wording. Full offline CRM is a separate project.


Job 2026-10-30-shop-os-local-ai. Nour, 2026-10-30: "i might want to download a offline ai from huggingface to run
locally n expand our options n cababilities on the shop pc, maybe even interconnect nattynour (this laptop) and
nicksmax (other laptop)". Labels as in the README; every number carries one.

**Historical recommendation (2026-10-30; superseded by section 8):** evaluate an Ollama local node on the front-desk PC (option B), subject to a hardware check and install receipt.
Ollama plus gemma3:4b (3.4 GB, text and image, FACT ollama.com/library/gemma3), mostly a night-shift batch worker on
our own data (section 2). The PCs link through our own server (option C), not a VPN. The first install is a hand-off
block for Nour; nothing is installed until he runs it.

Benchmarked against: Home Assistant Assist (Ollama + faster-whisper on one LAN box serving thin clients); Frigate
GenAI review (LLM called once per event, fixed JSON output, small non-thinking model); our office-ears lane on
MECHANICS (local speech-to-text, heartbeat and producer lease); statenour `lib/ai/provider.ts` (one provider switch).
Adopted: a worker on the box pulls jobs and calls the model locally; one call per event with a fixed output shape; a
heartbeat so a dead box reads "offline", never zero. Rejected: always-on models and voice satellites (CPU contention).

## 1. What each machine can run today

| | MECHANICS (front desk) | NattyNour (Nour's laptop) | NicksMax (lot PC) |
|---|---|---|---|
| CPU | Ryzen 5 7520U (FACT, memory office-lane-shop-pc) | Core Ultra 7 266V, 8 cores 8 threads (FACT, block below run here 2026-10-30) | Core i5-5350U (FACT, the NicksMax session, 2026-10-30) |
| GPU | integrated only, no discrete GPU (FACT, same memory) | Arc 140V iGPU; own memory UNKNOWN, it borrows system RAM; the "(8GB)" in its name is not VRAM (FACT, same run) | UNKNOWN |
| RAM | 16 GB (FACT, same memory) | 15.7 GB visible, 0.4-0.8 GB free with 8 agent sessions open (FACT, same day) | 7.9 GB (FACT, the NicksMax session, 2026-10-30) |
| Free disk | UNKNOWN | 38-41 GB of 237 GB (FACT, same day) | 8.26 GB after the 2026-10-30 cleanup, up from 1.26 GB; the earlier 40 MB figure was stale (FACT, the NicksMax session) |
| AI it runs now | faster-whisper base.en on CPU, 2 threads, rtf 0.267, 0 fails on 10 clips (FACT, bench 2026-10-22) | none; Ollama not on PATH (FACT, same run) | sign-camera producer when up; the camera stack holds the CPU at 100% (FACT, the NicksMax session) |
| Always at the shop | yes (staff machine; one Kernel-Power crash 2026-09-29, FACT, memory office-lane-shop-pc) | no, it travels (INFERENCE) | UNKNOWN ("down till further notice" 10-26, seen back 10-27, CLAIM, memory lot-vision-v2-2026-10-26) |
| Measured LLM speed | UNKNOWN until step 4 of the hand-off block prints its eval rate | Qwen3-8B INT4 about 19.6 tok/s on an Arc 140V with 32 GB (CLAIM, Perplexity 2026-10-18, memory idea-personal-local-ai-helper); this box has 16 GB | none: no room for a local model (7.9 GB RAM, CPU already full) |

Traps (2026-10-18 research round): shared RAM is not VRAM; TOPS do not predict speed; "a GGUF exists" is not runtime
support; image plus LLM on one box collapsed decode from 18.5 to 0.12 tok/s (CLAIM); local is not private by itself.
Ollama's GPU page says Vulkan gives "additional GPU support on Windows" and "is enabled by default"; it does not name
Intel GPUs (FACT, docs.ollama.com/gpu, read 2026-10-30). Whether stock Ollama uses the Arc 140V is unmeasured:
benchmark it before reaching for LM Studio or OpenVINO.

## 2. Which jobs a local model could run

Our own data, all candidates (Nour 2026-10-30: use our stuff aggressively). Two lines never move: a person taps
send on anything a customer gets, and prices, labor times, torque and intervals come from rules, not a model.

| Our data | Local job and mechanism | Box | State |
|---|---|---|---|
| Office-ears audio | whisper transcribes (live); next, a 3-4B model tags each episode (price asked, declined, came back) as fixed JSON into the existing ingest | MECHANICS | transcribe LIVE; tagging idea |
| Lot camera | car count on the front-desk PC (lot-vision v2); plate read per arrival, matched to a customer on our server, never kept on the box | MECHANICS | count designed; plate weights licence UNVERIFIED (UPSTREAMS fast-alpr row) |
| Receptionist calls | live calls stay on VAPI; after-call replay, scoring and summary drafts as a batch (replay lane is already Ollama-only, memory receptionist-replay-lane-ollama-only) | NattyNour when home, or cloud | lane exists; local run idea |
| SMS and follow-up drafts | an estimate with no invoice (likely a walk-out, INFERENCE) or a closed invoice gets a draft text; staff read and tap | MECHANICS, or cloud | idea |
| Website tire searches | nightly: sizes searched that the shop had no price or stock for, as a buy list | any node, night batch | idea; which search fields the site keeps is UNKNOWN |
| Copilot pointers | rules pick the pointer; the model words one line (01-DESIGN 7) | MECHANICS or cloud | copilot not built |

Night shift is the cheap trick: when the shop is closed MECHANICS is idle, so batch jobs do not fight the front desk
or live whisper for CPU.

## 3. Three options

**A. API only.** Calls go through the existing provider switch (nickstire `server/_core/llm.ts`) to a cloud model.
Cost: section 4. If the internet drops the whole Shop OS is down anyway (01-DESIGN 8 plans paper intake).
Kill: AI spend passes a monthly ceiling Nour sets: go to B with cloud fallback; or the vendor starts training on paid
traffic: go to B with cloud fallback OFF (or to a no-training provider Nour approves).

**B. One local node on MECHANICS (chosen).** The Railway server cannot reach a model bound to 127.0.0.1 on a shop
PC, so the node pulls: a small worker on MECHANICS claims a job from a queue on our server over outbound HTTPS, calls
Ollama on 127.0.0.1 (Ollama's default bind, FACT, docs.ollama.com/faq), posts the result back and heartbeats. The model
loads per job and unloads after 5 idle minutes (Ollama default, same page). Cost: no dollars; Nour's paste time and CPU
shared with whisper. Node drop: the job waits, then goes to cloud unless A was killed for training. Maintainer: Nour,
by paste blocks (skill shop-pc-remote-session).
Kill: a draft takes over 30 s at the median, OR whisper rtf goes above 0.5 while the model runs, OR a second crash on
MECHANICS: run the rollback line and return to A.

**C. Mesh through our own server (no VPN, no spend).** The same pull queue, with more than one node claiming
(claim-before-act lease, like the camera producer lease). No inbound port, no VPN. A Tailscale mesh was the first idea,
but its free plan "is only suitable for non-commercial use" and the cheapest business plan is $8 per user per month
(FACT, tailscale.com/pricing, read 2026-10-30); Nour ruled no spend. The laptop travels and NicksMax has no room for a model, so
MECHANICS carries the queue. Kill: jobs wait over 15 minutes with no claimer more than twice a week.

Order: B now, C when a second node is worth adding; A stays the fallback.

## 4. Local vs API cost at a few closed tickets a day

Per-ticket token guesses (INFERENCE, to be replaced by real logs): pointer wording 1,500 in / 150 out; follow-up draft
600 in / 80 out; complaint tag 300 in / 10 out. About 2,400 in and 240 out per ticket; at a few tickets a day that is
roughly 0.2M input and 0.02M output tokens a month.
- API: monthly cost = 0.2 x (input price per 1M) + 0.02 x (output price per 1M), plus thinking tokens at the output
  rate if the model bills them. Read both prices off the vendor page on the day (NOT CHECKED here).
- Local on MECHANICS: 240 output tokens per ticket at an UNKNOWN rate (step 4 measures it). The nearest public figure
  is 7.3 tok/s for a Ryzen 7 7840U on CPU, model unstated (CLAIM, web search 2026-10-30); the 7520U is likely slower
  (INFERENCE). At 5-10 tok/s that is 24-48 s of decode per ticket plus prompt time.
- Local wins on money only if the API line above beats Nour's upkeep hours a month times the value of his hour.
  It already wins on his ruling that customer text stays on our own box.

## 5. Customer data on a local box (practical rules)
1. Our database stays the only home of customer records. A local box gets one job's text at a time and sends the
   result back; it keeps weights and its queue, not tickets, phones or plates.
2. Wipe: job text lives in memory; temp audio is deleted after transcription; nothing to wipe but the model folder.
3. Bind to 127.0.0.1. The Ollama FAQ describes no built-in auth (FACT, read 2026-10-30), so a LAN bind would let any
   shop device use it; llama.cpp's server has `--api-key` (FACT, its server README). The pull design needs no port.
4. Weights only from the publisher's own org, licence read first (the MiniMax-M3 row in UPSTREAMS shows why).

## 6. Paste block: read a PC's specs (no install, no admin)
Tested 2026-10-30 in Windows PowerShell 5.1 on NattyNour: exit 0, one line per field. Keep the output out of the repo.
```powershell
$c = Get-CimInstance Win32_Processor | Select-Object -First 1
"CPU: $($c.Name.Trim()) | cores $($c.NumberOfCores) | threads $($c.NumberOfLogicalProcessors)"
$os = Get-CimInstance Win32_OperatingSystem
"RAM total GB: {0:N1}" -f ($os.TotalVisibleMemorySize / 1MB)
"RAM free now GB: {0:N1}" -f ($os.FreePhysicalMemory / 1MB)
"OS: $($os.Caption) build $($os.BuildNumber)"
Get-CimInstance Win32_VideoController | ForEach-Object { "GPU: $($_.Name) | driver $($_.DriverVersion)" }
$k = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*'
$v = @(Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.'HardwareInformation.qwMemorySize' })
foreach ($r in $v) { "GPU own memory GB: {0:N1} ({1})" -f ($r.'HardwareInformation.qwMemorySize' / 1GB), $r.DriverDesc }
if ($v.Count -eq 0) { "GPU own memory GB: UNKNOWN (no value; an integrated GPU borrows system RAM)" }
$d = Get-PSDrive -Name C
"Disk C free GB: {0:N1} of {1:N1}" -f ($d.Free / 1GB), (($d.Used + $d.Free) / 1GB)
"Ollama on PATH: " + $(if (Get-Command ollama -ErrorAction SilentlyContinue) { 'yes' } else { 'no' })
```

## 7. Nour's rulings (2026-10-30, his words) and status
1. Spec block on both PCs: "u do that". Chrome Remote Desktop would not load from NattyNour, so the front-desk PC got a
   hand-off block (specs, winget install, model pull, speed test, health, one-line rollback). NicksMax: specs only, via
   the session already on it (8.26 GB free after cleanup, no install, no room for a model).
2. Installs: "install anything yes". 3. Spend: "not spending". 4. Ports: "any port is fin" (the pull design needs none).
5. Customer text: "always reach the local model, thats what its there for".

NOT CHECKED (2026-10-30, empty or failed): a llama.cpp benchmark for the Ryzen 5 7520U (none found); AMD's 7520U spec
page (timed out); Google's Gemini pricing page (DNS failure); a mechanic-shop local-LLM case study (host not found);
Frigate's GenAI page (404; read through doc mirrors, so CLAIM); whether Ollama logs prompts; whether Ollama's Vulkan
backend picks up the Arc 140V; Perplexity in Chrome (blocked by policy since 2026-10-22).

## 8. 2026-11-06 update: PC cleanup, CRM harness, and honest offline scope

**Status correction:** the 2026-10-30 recommendation to try Ollama plus Gemma 3 4B is a candidate, not a measured production choice. The prior planning-manager notes say a front-desk paste block was handed to Nour and that installation receipts were still owed. This repository has no verified receipt that the model or worker is installed. Re-check the actual machine before relying on any prior hardware measurement or install state.

**Machine boundaries:** MECHANICS (front desk) is the only candidate to evaluate first; its older snapshot was Ryzen 5 7520U, 16 GB RAM, integrated graphics, and CPU Whisper use. Refresh this before a cleanup or model test. NattyNour is mobile, not a reliable shop worker. NicksMax is a different camera/lot PC; the older snapshot recorded 7.9 GB RAM and CPU saturation by its camera workload. Do not install, clean, stop, reboot, or change camera/voice services on NicksMax without its current owner handing it off.

**Cleanup sequence:** record disk/RAM/CPU/GPU, apps and startup items, active camera/sign/phone/mic/printer/Whisper services, browser/vendor profiles, backups and process owners. Propose a reversible ranked list. Preserve credentials, customer/work records, browser/vendor sessions, drivers, recovery logs, camera/sign/voice and other session-owned workloads. Change one thing at a time, only with the required specific go for deletion/uninstall/config changes, then verify each shop workflow and rollback path. Do not optimize disk space at the cost of counter or camera reliability.

**Model harness:** choose models only after fresh hardware inventory and publisher-license review. Pin model digest, quantization, backend, runtime, prompt/eval version and machine. Run fixed synthetic/redacted cases for vehicle/part/tire fitment, ambiguous VIN, stale/contradictory stock, fees/core arithmetic, source timeout, unknown facts, portal prompt injection, tool choice, and customer draft. Measure p50/p95, schema-valid rate, citation/grounding, abstention, human edits, CPU/GPU/RAM/disk/thermal load, Whisper real-time factor, crash/restart, upkeep and cost. Safety gate: zero invented price/stock/fitment/safety facts; median draft under 30 seconds; Whisper RTF stays under 0.5 during concurrent use. If no model passes, stay deterministic or use the explicitly approved fallback/no-AI path.

**Worker:** only if the model passes, use an outbound-HTTPS job pull with bounded payload, lease, heartbeat, claim-before-act, idempotent completion, expiry, retry limit, schema validation, redacted telemetry, and one-line rollback. Keep Ollama loopback-only; do not add a LAN port or VPN by default. Customer data stays in the approved server store; minimize each job and erase temporary payloads.

**Offline boundary:** local inference is not offline CRM. Phase 1 still needs the Railway app/database connection to get the job and persist its result. If the shop needs full offline CRM, first prove outage frequency/cost, then design encrypted local data, durable outbox, conflicts, device identity, expiry, backup/restore and replay. Until then, offline means paper intake and unsent draft only; do not queue payments, supplier orders, approvals, customer sends or price changes.

Full sourcing and computer handoff design: [18-SUPPLIER-DESKTOP-OFFLINE-AI](18-SUPPLIER-DESKTOP-OFFLINE-AI.md).