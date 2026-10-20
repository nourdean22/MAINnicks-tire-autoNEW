# Reaching the graphify MCP server over Tailscale

Status 2026-10-19 (evening): NATTYNOUR is signed in as `nattynour-1` (100.127.185.69) on the tailnet
`tailae7855.ts.net`, with `nicksmax` online on the same tailnet. The one shared server, `graphify` on
`http://127.0.0.1:8765/mcp` (`config/agent-os/local-services.json`), is published tailnet-only at
**`https://nattynour-1.tailae7855.ts.net/mcp`** through `tailscale serve --bg 8767`: port 8767 is
`scripts/tailnet-host-proxy.mjs`, a loopback pass-through that rewrites the Host header to `127.0.0.1:8765`. It exists
because graphify's loopback bind makes the MCP SDK refuse any other Host with HTTP 421 (measured 2026-10-19 on the first
serve of 8765), graphify has no allowed-hosts switch, and binding `0.0.0.0` would open the port to the shop LAN. The `[health]` line says whether that rule is live
(`tailnet: serving <url>`), not yet enabled (`tailnet: installed, not serving`), or wrongly public (`tailnet: FUNNEL ON`,
a FAIL). Serena was trialled and dropped the same day (`docs/UPSTREAMS.md`), so there is no second port.

Nour gave the go on 2026-10-19 ("get all my computers interconnected", "get it all installed"); `docs/UPSTREAMS.md` records
Tailscale as ADOPTED on that date with this page as the threat model. Two steps stay his alone because they are account
actions: enabling Serve on the tailnet (a one-time admin-console approval the CLI links to) and the ACL rule below.

## Threat model

1. **Read-only.** graphify-mcp answers queries over `graph.json` (query_graph, get_node, get_neighbors,
   get_community, god_nodes, graph_stats, shortest_path, list_prs, get_pr_impact, triage_prs, listed live 2026-10-19).
   No tool writes to the repo.
2. **Tailnet only, never Funnel.** Tailscale's Serve doc: "Tailscale Serve lets you route traffic from other devices on
   your Tailscale network"; for the public internet "use Tailscale Funnel instead". Funnel is never used here.
3. **ACL: the port reaches only Nour's own devices.** Tailscale's Serve doc: "access control rules apply to Serve just
   like any other service". Restrict it to Nour's user, not tagged devices or shared nodes.
4. **What a compromised tailnet node could read from the graph:** the structure of the MAIN checkout's code, no `.env`.
   - graph.json, checked 2026-10-19 on NATTYNOUR: 126 MB, 86,001 nodes over 10,570 source files, **0 `.env` files**.
     graphify merges `.gitignore` into `.graphifyignore` (that file's header says so), and every `.env*` is gitignored
     (`git check-ignore`: `.gitignore:30` for `apps/nickstire/.env`, `apps/statenour/.gitignore:25` for `.env.local`).
     The 8 files with "secret" in their names are code about secrets (scanners, tests, a masker), not secret values.
   - Not covered: a secret someone hardcoded into tracked source. The staged-secret scan in `lefthook.yml` guards that,
     not this setup.
4b. **GitHub data and local paths, through Nour's gh login.** `list_prs`, `get_pr_impact` and `triage_prs` run the
   `gh` CLI with a caller-supplied repo (graphify 0.9.80 `prs.py` builds `gh ... --repo <repo>`, from `serve.py:2317`
   on), and the worktree mapping runs `git worktree list`. So a caller could read PR data for ANY repo Nour's gh
   account can see, plus this machine's worktree paths. Mitigation: the ACL in step 3 (Nour's own devices only), or
   start the server from an account where gh is signed out and `GH_TOKEN` is unset.
5. **No auth on the server itself.** Anything that reaches the port can query it, which is why step 3 is required.

## Setup on NATTYNOUR

Commands from Tailscale's docs (Serve page "Last validated Jan 20, 2026"; CLI page "Last validated Jul 30, 2026") and
from `tailscale serve --help` on 1.104.1 (read 2026-10-19: `--bg` keeps the rule after the command exits; without it the
rule lives only while the command runs).

1. Sign in: `tailscale up` (Nour; done 2026-10-19, node `nattynour-1`). Tailscale 1.104.1 was installed by winget.
2. `tailscale serve --bg 8767` (the pass-through, never 8765 directly: that answers 421). The first run on a tailnet
   where Serve is not yet enabled prints a `https://login.tailscale.com/f/serve?node=...` link and waits; Nour opens it
   once and approves (done 2026-10-19). Nothing else is needed: MagicDNS is enabled tailnet-wide and Serve provisions
   the TLS certificate for `nattynour-1.tailae7855.ts.net` itself. The logon task (`scripts/register-local-mcp-task.ps1`)
   starts both the server and the pass-through; the serve rule persists across reboots on its own.
3. ACL (Nour, admin console, Access controls): allow `nourdean22@` (his own user) to `nattynour-1:443`, and nothing else to
   that port. Tagged or shared nodes must not match. Never `tailscale funnel`: the health line turns FAIL if it sees Funnel.
4. `tailscale serve status` must print `https://nattynour-1.tailae7855.ts.net (tailnet only)` over `proxy http://127.0.0.1:8767`.
   Check from a second device that `https://nattynour-1.tailae7855.ts.net/mcp` answers an MCP initialize with
   `serverInfo.name` graphify (the same probe `scripts/local-mcp-servers.ps1 -Status` runs locally).

Hygiene: the tailnet also lists a stale `nattynour` node (offline, last seen 13 days before 2026-10-19), the old PC's
registration. Remove it in the admin console so the name is not confused with `nattynour-1`.

## Client config on a second PC (NicksMax first)

On NicksMax (signed in to the same tailnet), run these once; they point its clients at the shared graph over the tailnet.
The URL is fixed by MagicDNS, so it survives IP changes:

- Claude Code: `claude mcp add --transport http --scope user graphify https://nattynour-1.tailae7855.ts.net/mcp`
- Codex: `codex mcp add graphify --url https://nattynour-1.tailae7855.ts.net/mcp`
- VS Code: `code --add-mcp '{"name":"graphify","type":"http","url":"https://nattynour-1.tailae7855.ts.net/mcp"}'`

The graph answers only while NATTYNOUR is awake and on the tailnet (it is a laptop); a client that cannot reach it loses
the `graphify` tool for that session and nothing else. The iPhone has no MCP client today; it reads the two PWAs over the
internet, which this does not change. MECHANICS is reached by Chrome Remote Desktop and is not on the tailnet as far as
the repo knows; add it the same way if it is.

## Health

`scripts/agent-os/session-health.mjs` reads `tailscale serve status` (budgeted like every other probe) and prints one of:
`tailnet: serving https://nattynour-1.tailae7855.ts.net/mcp` (the configured port is proxied, tailnet only);
`tailnet: installed, not serving (optional, docs/agent-os/TAILNET-MCP.md)` (no serve config, or another port);
`tailnet: FUNNEL ON <url>`, a FAIL whose fix is `tailscale funnel reset` (never public);
`tailnet: not installed (...)` when the binary is absent; `tailnet UNKNOWN (<reason>)` when the command failed.
