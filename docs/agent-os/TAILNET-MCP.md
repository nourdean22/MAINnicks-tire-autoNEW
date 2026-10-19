# Reaching the graphify MCP server over Tailscale (runbook, not wired)

Status 2026-10-19: **not set up, and nothing in the PR that added this file installs Tailscale.** The one shared
server, `graphify` on `http://127.0.0.1:8765/mcp` (`config/agent-os/local-services.json`), listens on loopback only.
This page says how another PC could reach it once Nour signs NATTYNOUR into a tailnet. Serena was trialled and dropped
the same day (`docs/UPSTREAMS.md`), so there is no second port.

`docs/UPSTREAMS.md:65` records Tailscale as ADOPT-CANDIDATE, not adopted, and says exposing anything over it "needs
the operator's explicit go-ahead and a threat model, not an agent's initiative". This page is that threat model. No
agent runs these steps; Nour does, after he says go.

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

## Setup on NATTYNOUR (Nour, once, after go)

Commands quoted from Tailscale's docs, read 2026-10-19 (Serve page "Last validated Jan 20, 2026"; CLI page "Last
validated Jul 30, 2026"):

- `tailscale serve 3000` proxies a local web server at `http://127.0.0.1:3000` to the tailnet (Serve page example).
- `tailscale serve status` shows the configuration; `tailscale serve reset` clears it (CLI page subcommands).
- Flags for running it in the background were not on either page: read `tailscale serve --help` before relying on one.

Steps:

1. Sign in: `tailscale up` (Nour). Tailscale 1.104.1 was installed 2026-10-19 by winget; nothing in this repo installs it.
2. `tailscale serve 8765`
3. Add the ACL rule from threat-model step 3 in the admin console.
4. `tailscale serve status`, then check from the other device that the URL it prints answers.

## Client config on a second PC

Replace `<url>` with the HTTPS URL `tailscale serve status` prints, plus `/mcp`:

- Claude Code: `claude mcp add --transport http --scope user graphify <url>`
- Codex: `codex mcp add graphify --url <url>`
- VS Code: `code --add-mcp '{"name":"graphify","type":"http","url":"<url>"}'`

The iPhone has no MCP client today; it reads the two PWAs over the internet, which this does not change.

## Health

`scripts/agent-os/session-health.mjs` prints `tailnet: not installed (optional, docs/agent-os/TAILNET-MCP.md)` or
`tailnet: installed (...)` as information. It is never a FAIL.
