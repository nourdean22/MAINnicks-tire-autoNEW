# Handoff

## State
8 commits on `main`, all pushed to Railway. Latest: `e943907`. Production healthy (nickstire.org). AI gateway live with Ollama local-first + OpenAI fallback. Customer chat + review replies wired through gateway. All remaining invokeLLM calls use JSON schema — correctly staying direct. 24 performance indexes applied to DB. Migrations 0017-0019 applied directly (journal synced). AI endpoints locked with ADMIN_API_KEY + rate limiter.

## Remote Access
- Quick tunnel: `https://bird-cork-bringing-efforts.trycloudflare.com` (changes on restart)
- Named tunnel `nour-local` exists (ID: 6193177a) but `dev.nickstire.org` doesn't resolve — DNS is at globaldomaingroup.com, not Cloudflare
- To fix: add CNAME `dev` → `6193177a-0bd6-45cf-b2f8-0e3ef9162113.cfargotunnel.com` at DNS provider
- Tunnel URL written to `C:\Users\nourd\.cloudflared\tunnel-url.txt`

## In Progress (agents running)
- Permanent tunnel scripts + startup persistence
- Admin control center page
- AI gateway persistent logging + observability
- End-to-end flow validation
- Dead-weight cleanup

## Production Env Vars Needed on Railway
- ADMIN_API_KEY — set via Railway dashboard to enable /api/ai/* admin endpoints (currently fail-closed 503)

## Context
- Structured output calls (JSON schema) MUST stay on OpenAI `invokeLLM()` — Ollama can't do strict schemas
- DO NOT touch `C:\Users\nourd\Documents\nour-os-unified`
- nickstire.org = Railway. autonicks.com = NOUR OS dashboard. Do not confuse.
- Railway CLI not authed (`railway login` needed)
