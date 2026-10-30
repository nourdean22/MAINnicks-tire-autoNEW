# Shop OS 12: a local AI box and a machine mesh (plan, nothing installed)

Job 2026-10-30-shop-os-local-ai. Nour, 2026-10-30: "i might want to download a offline ai from huggingface to run
locally n expand our options n cababilities on the shop pc, maybe even interconnect nattynour (this laptop) and
nicksmax (other laptop)". Nobody installs anything from this doc. Labels as in the README; every number carries one.

**Answer first:** not yet. Keep the one local AI that already earns its keep (speech-to-text on the front-desk PC) and
send the copilot's wording jobs to the API. Revisit a local drafting model only after the copilot exists and its
monthly token count is measured (section 3). A three-machine mesh fails on licence, uptime and security today.

Benchmarked against: Home Assistant Assist (Ollama + faster-whisper on one LAN box serving thin clients); Frigate
GenAI review (LLM called once per event, fixed JSON output, small non-thinking model); our own office-ears lane on
MECHANICS (local speech-to-text, heartbeat and producer lease); statenour `lib/ai/provider.ts` (one provider switch,
lanes behind it). Adopted: the model is just an endpoint behind the provider switch with a cloud fallback; one call
per event with a fixed output shape; a heartbeat so a dead box reads "offline", never zero. Rejected: always-on
models and voice satellites (CPU contention on a staff PC).

## 1. What each machine can run today

| | MECHANICS (front desk) | NattyNour (Nour's laptop) | NicksMax (lot PC) |
|---|---|---|---|
| CPU | Ryzen 5 7520U (FACT, memory office-lane-shop-pc) | Core Ultra 7 266V, 8 cores 8 threads (FACT, block below run here 2026-10-30) | UNKNOWN |
| GPU | integrated only, no discrete GPU (FACT, same memory) | Arc 140V iGPU; own memory UNKNOWN, it borrows system RAM; the "(8GB)" in its driver name is not VRAM (FACT, same run) | UNKNOWN |
| RAM | 16 GB (FACT, same memory) | 15.7 GB visible, 0.8 GB free with 8 agent sessions open (FACT, same run) | UNKNOWN |
| Free disk | UNKNOWN | 40.9 GB of 237 GB (FACT, same run) | about 40 MB on 2026-10-27 (FACT, manager brief) |
| AI it runs now | faster-whisper base.en on CPU, 2 threads, rtf 0.267, 0 fails on 10 clips (FACT, bench 2026-10-22) | none; Ollama not on PATH, Tailscale on PATH (FACT, same run) | sign-camera producer when up |
| Always at the shop | yes (staff machine; one Kernel-Power crash 2026-09-29, FACT, memory office-lane-shop-pc) | no, it travels (INFERENCE) | availability UNKNOWN ("down till further notice" 10-26, seen back 10-27 01:28Z, CLAIM, memory lot-vision-v2-2026-10-26) |
| Measured LLM speed | UNKNOWN: no benchmark for this CPU found | Qwen3-8B INT4 about 19.6 tok/s on an Arc 140V with 32 GB (CLAIM, Perplexity 2026-10-18, memory idea-personal-local-ai-helper); this box has 16 GB, so lower | none: no disk |

Traps (2026-10-18 research round): shared RAM is not VRAM; TOPS do not predict speed; "a GGUF exists" is not runtime
support; image plus LLM on one box collapsed decode from 18.5 to 0.12 tok/s (CLAIM); local is not private by itself.
Ollama's Windows page lists NVIDIA and AMD acceleration only; Intel GPUs are not mentioned (FACT,
docs.ollama.com/windows, read 2026-10-30), so the Arc path likely means LM Studio/Vulkan or OpenVINO, not stock Ollama (INFERENCE).

## 2. Which Shop OS jobs could use a local model

| Job | Local? | Why |
|---|---|---|
Our own data, all candidates (Nour 2026-10-30: use our stuff aggressively). Two lines never move: a person taps
send on anything a customer gets, and prices, labor times, torque and intervals come from rules, not a model.

| Our data | Local job and mechanism | Box | State |
|---|---|---|---|
| Office-ears audio | whisper transcribes (live); next, a 3-4B model tags each episode (price asked, declined, came back) as fixed JSON into the existing ingest | MECHANICS | transcribe LIVE; tagging idea |
| Lot camera | car count runs on the front-desk PC (lot-vision v2); plate read per arrival, plate matched to a customer on our server, never kept on the box | MECHANICS | count designed; plate weights licence UNVERIFIED (UPSTREAMS fast-alpr row) |
| Receptionist calls | live calls stay on VAPI; after-call replay, scoring and summary drafts run as a batch (the replay lane is already Ollama-only, memory receptionist-replay-lane-ollama-only) | NattyNour when home, or cloud | lane exists; local run idea |
| SMS and follow-up drafts | an estimate with no invoice (likely a walk-out, INFERENCE) or a closed invoice gets a draft text; staff read it and tap | MECHANICS by day, or cloud | idea |
| Website tire searches | nightly: sizes people searched that the shop had no price or stock for, as a buy list | any node, night batch | idea; which search fields the site keeps is UNKNOWN |
| Copilot pointers | rules pick the pointer; the model words one line (01-DESIGN 7) | MECHANICS or cloud | copilot not built |

Night shift is the cheap trick: when the shop is closed, MECHANICS is idle, so batch jobs (tags, tire-search lists,
call scoring) do not fight the front desk or live whisper for CPU.

## 3. Three options

**A. API only (recommended now).** Copilot calls go through the existing provider switch to a cloud model.
Cost: tokens x the vendor's price on the decision day (section 4). If the internet drops, the whole Shop OS is down
anyway, and 01-DESIGN 8 already plans paper intake. Maintainer: nobody new.
Kill: AI spend passes a monthly ceiling Nour sets, or the vendor's terms start training on paid traffic: go to B.

**B. One local node on MECHANICS.** Keep whisper; add one small model (3-4B, Q4) loaded per job and unloaded after
(Ollama unloads after 5 minutes by default, FACT, docs.ollama.com/faq), bound to 127.0.0.1 (Ollama's default bind,
same page), reached through the provider switch with the cloud as fallback. Cost: no dollars; Nour's setup time
(INFERENCE 2-4 h) and CPU cores shared with whisper and the front desk. Node drop: jobs fall back to cloud; the
heartbeat shows it offline. Maintainer: Nour, by paste blocks (skill shop-pc-remote-session).
Kill: a draft takes over 30 s at the median, OR whisper rtf goes above 0.5 while the model runs, OR a second crash on
MECHANICS: uninstall and return to A.

**C. Mesh over Tailscale with one job queue.** All three boxes join a tailnet; jobs go into one queue table on the
server and any online node claims one (claim-before-act lease, like the camera producer lease). NattyNour is the only
box with a measured LLM speed. Cost: Tailscale's free Personal plan "is only suitable for non-commercial use"; the
cheapest business plan is Standard at $8 per user per month (FACT, tailscale.com/pricing, read 2026-10-30). Node drop:
the laptop leaves the shop daily and NicksMax has no disk, so most hours one weak node or none holds the queue.
Maintainer: Nour, three machines. Kill: any node stores customer data at rest, OR jobs wait over 15 minutes with no
claimer more than twice a week, OR the tailnet ACL review (docs/agent-os/TAILNET-MCP.md shape) is not done first.

Why A: the copilot is last in the build order (05-ROADMAP v3), so no local job exists to serve yet; B's only proven
piece (whisper) is already live; C costs money, adds two unreliable nodes and a network path to maintain.
First local step when a job exists: B as a night-shift batch node (section 2), not a daytime chat model.

## 4. Local vs API cost at a few closed tickets a day

Per-ticket token guesses (INFERENCE, to be replaced by the copilot's own logs): pointer wording 1,500 in / 150 out;
follow-up draft 600 in / 80 out; complaint tag 300 in / 10 out. About 2,400 in and 240 out per ticket, so on the
order of 10^4 tokens a day and 3 x 10^5 a month.
- API: monthly cost = 0.3 x (price per 1M tokens). The price is read off the vendor page that day (NOT CHECKED here).
- Local on MECHANICS: 240 output tokens per ticket at an UNKNOWN rate. The nearest public figure is 7.3 tok/s for a
  Ryzen 7 7840U on CPU, model unstated (CLAIM, community test via web search 2026-10-30); the 7520U is likely slower (INFERENCE: smaller part).
  At 5-10 tok/s that is 24-48 s of decode per ticket plus prompt time, on the cores whisper uses.
- Owner time decides it: local wins only if 0.3 x price per 1M > upkeep hours a month x the value of Nour's hour.
  With half an hour of upkeep a month, the API would have to cost more than 1.7 of his hours per 1M tokens.

## 5. Customer data on a local box (practical rules)
1. Our database stays the only home of customer records. A local box gets one job's text at a time and sends the
   result back; it keeps weights and its queue, not tickets, phones or plates.
2. Wipe: job text lives in memory; temp audio is deleted after transcription; nothing to wipe but the model folder.
3. Bind to 127.0.0.1. The Ollama FAQ describes no built-in auth (FACT, read 2026-10-30), so a LAN bind would let any
   shop device use it; llama.cpp's server has `--api-key` (FACT, its server README). Tailscale Serve, never Funnel.
4. Weights only from the publisher's own Hugging Face org, licence read first (the MiniMax-M3 row in UPSTREAMS shows why).

## 6. Paste block: read a PC's specs (no install, no admin)
Tested 2026-10-30 in Windows PowerShell 5.1 on NattyNour: exit 0, one line per field. Paste the output back; it
holds no secrets, but keep it out of the repo.
```powershell
$c = Get-CimInstance Win32_Processor | Select-Object -First 1
"CPU: $($c.Name.Trim()) | cores $($c.NumberOfCores) | threads $($c.NumberOfLogicalProcessors)"
$os = Get-CimInstance Win32_OperatingSystem
"RAM total GB: {0:N1}" -f ($os.TotalVisibleMemorySize / 1MB)
"RAM free now GB: {0:N1}" -f ($os.FreePhysicalMemory / 1MB)
"OS: $($os.Caption) build $($os.BuildNumber)"
Get-CimInstance Win32_VideoController | ForEach-Object { "GPU: $($_.Name) | driver $($_.DriverVersion)" }
$k = 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*'
$v = @(Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.'HardwareInformation.qwMemorySize' })
foreach ($r in $v) { "GPU own memory GB: {0:N1} ({1})" -f ($r.'HardwareInformation.qwMemorySize' / 1GB), $r.DriverDesc }
if ($v.Count -eq 0) { "GPU own memory GB: UNKNOWN (no value; an integrated GPU borrows system RAM)" }
$d = Get-PSDrive -Name C
"Disk C free GB: {0:N1} of {1:N1}" -f ($d.Free / 1GB), (($d.Used + $d.Free) / 1GB)
"Battery: " + $(if (Get-CimInstance Win32_Battery) { 'yes (laptop)' } else { 'none' })
"Ollama on PATH: " + $(if (Get-Command ollama -ErrorAction SilentlyContinue) { 'yes' } else { 'no' })
"Tailscale on PATH: " + $(if (Get-Command tailscale -ErrorAction SilentlyContinue) { 'yes' } else { 'no' })
```

## 7. What only Nour decides
1. Run the block on MECHANICS (and NicksMax if it is up) to turn the UNKNOWN cells into FACT.
2. Any install on MECHANICS: it is a staff machine.
3. Any spend: a Tailscale business plan, or new hardware.
4. Any port exposed beyond 127.0.0.1.
5. Whether customer text may reach a local model at all.

NOT CHECKED (searched or fetched 2026-10-30, came back empty or failed): a llama.cpp benchmark for the Ryzen 5 7520U
(none found); AMD's 7520U spec page (timed out); Google's Gemini pricing page (DNS failure); a mechanic-shop local-LLM
receptionist case study (host not found); Frigate's GenAI page (404; read through doc mirrors, so CLAIM); whether
Ollama logs prompts; Perplexity in Chrome (blocked by a Chrome policy since 2026-10-22).
