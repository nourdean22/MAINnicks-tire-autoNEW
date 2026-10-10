// Railway Infrastructure as Code · natural-appreciation · generated 2026-09-18
//
// WHY THIS EXISTS
// railway.json / railway.toml ("Config as Code") is DEPRECATED with a HARD
// CUTOFF of 2026-12-01. After that date the three railway.json files in this
// repo stop being read and each service silently falls back to its dashboard
// values. Silently is the operative word: no error, no failed deploy, no diff.
//
// ⚠⚠ THIS FILE IS NOT A STRAIGHT `railway config pull`. READ BEFORE REGENERATING.
//
// `railway config pull` imports the LIVE PROJECT state. It does NOT read
// railway.json, because railway.json is an override applied at DEPLOY time and
// never written back to the project. So a naive pull-and-commit drops every
// override in this repo. Measured 2026-09-18, the pulled file carried:
//
//   service                pulled   railway.json   lost
//   statenour-web               1             10      9
//   MAINnicks-tire-auto         1              8      7
//   statenour-worker            2              8      6
//
// — 22 watchPatterns, including every `packages/**` entry. That is exactly the
// defect repaired in #2418 ("a shared-package change could not trigger the
// deploy that consumes it"), which would have reverted on 2026-12-01 with no
// diff to notice. The three watchPatterns arrays below are therefore ported
// from the railway.json files ON PURPOSE; everything else is verbatim pulled
// live state.
//
// VERIFIED with `railway config plan` on 2026-09-18:
//   Plan: 0 to add, 3 to change, 0 to destroy
// "0 to destroy" is the safety proof — IaC DELETES any resource omitted from
// the `resources:` array, and this project holds 5 services, a Redis database,
// 2 volumes and a storage bucket. The 3 changes are precisely the ported
// watchPatterns.
//
// APPLIED 2026-09-18, and the three railway.json files are DELETED.
//
// `railway config apply` ran against production: 3 services updated, all rebuilt,
// none went offline; the re-plan reads "already up to date"; all 9 resources are
// present. A service cannot be managed by both systems, so the legacy files came
// out as part of that handover.
//
// ⇒ THIS FILE IS NOW THE ONLY SOURCE OF BUILD/DEPLOY CONFIG IN THE REPO. Nothing
// else overrides it, including after the 2026-12-01 cutoff. `healthcheckPath`
// used to live in apps/<app>/railway.json; comments still pointing there are
// pointing at a deleted file. The gate that enforces watch coverage
// (scripts/agent-os/railwayWatchCoverage.test.mjs) reads THIS file.
//
// 2026-09-23 · THREE HAND EDITS, all so this file matches live; #2 also stops
// redeploying on docs. None is live until the operator runs plan -> apply.
//  1. REGION. MAINnicks-tire-auto and statenour-web were moved live to
//     us-east4-eqdc4a (next to TiDB and Neon in AWS us-east-1; median 72 ms per
//     DB round trip from us-west2, apps/nickstire/docs/operations/
//     REGION-LATENCY-2026-09-23.md). This file still said us-west2, so the next
//     apply would have moved both back. scripts/agent-os/railwayRegion.test.mjs
//     now pins each DB-owning service to its database's region.
//  2. NEGATED WATCH PATHS ("!..."). Doc-only commits redeployed the shop server
//     (8 of 32 deploys on 2026-09-22/23), restarting ~118 in-process jobs each
//     time. Only paths proven to be read by no build or runtime code are
//     negated; nickstire docs/reel-packs is read at runtime and stays watched,
//     which is why docs/ subdirectories are negated one by one. The evidence and
//     the gate are NON_INPUTS in scripts/agent-os/railwayWatchCoverage.test.mjs.
//     A new docs/ subdirectory is simply watched until someone adds a line here.
//  3. VARIABLES SET IN THE DASHBOARD AFTER THE PULL. This file is the desired
//     state, so expect a variable set by hand and never added here to show
//     as a DELETE in the next plan (Railway's IaC guide: a plan "should not
//     show unexpected ... variable deletes"). Added with preserve():
//     OPENWEATHER_API_KEY (nickstire, set 2026-09-23 for the weather lane,
//     #2578) and RAILWAY_WEBHOOK_TOKEN (statenour-web, the deploy pager,
//     #2597). Before every apply, read the plan and stop on any variable
//     delete: add that variable here first.
//
// No secrets here: every variable renders as `preserve()`, which keeps the
// value Railway already holds. Never run `config plan --show-values` into a log.

import { bucket, defineRailway, github, preserve, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Redis = redis("Redis", { region: "us-west2" });
  Redis.deploy = { startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 500 });
  const nickstireMedia = bucket("nickstire-media", { region: "sjc" });
  const statenourWorker = service("statenour-worker", {
    source: github("nourdean22/MAINnicks-tire-autoNEW", { rootDirectory: "/" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/worker/Dockerfile", watchPatterns: ["apps/worker/**", "!apps/worker/AGENTS.md", "!apps/worker/CLAUDE.md", "!apps/worker/DEPLOY.md", "apps/statenour/lib/**", "packages/reel-engine/**", "apps/nickstire/patches/**", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "turbo.json"] },
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: { restartPolicyType: "ALWAYS" },
    env: { ALG_API_BASE: preserve(), APOLLO_API_KEY: preserve(), AUTH_GOOGLE_CLIENT_ID: preserve(), AUTH_GOOGLE_CLIENT_SECRET: preserve(), AUTH_SECRET: preserve(), AUTO_LABOR_PASSWORD: preserve(), AUTO_LABOR_USERNAME: preserve(), BRIDGE_API_KEY: preserve(), CLICKUP_API_KEY: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), DIRECT_URL: preserve(), FIRECRAWL_API_KEY: preserve(), FIREFLIES_API_KEY: preserve(), GEMINI_API_KEY: preserve(), GITHUB_TOKEN: preserve(), GOOGLE_SERVICE_ACCOUNT_EMAIL: preserve(), GOOGLE_SERVICE_ACCOUNT_KEY: preserve(), HUGGINGFACE_API_KEY: preserve(), MAKE_API_KEY: preserve(), MAKE_WEBHOOK_API_KEY: preserve(), MAKE_WEBHOOK_URL: preserve(), META_IG_USER_ID: preserve(), META_PAGE_ACCESS_TOKEN: preserve(), META_PAGE_ID: preserve(), NICKS_ADMIN_URL: preserve(), NODE_ENV: preserve(), OLLAMA_API_KEY: preserve(), OLLAMA_BASE_URL: preserve(), OLLAMA_FALLBACK_MODELS: preserve(), OLLAMA_FAST_MODEL: preserve(), OLLAMA_MODEL: preserve(), OLLAMA_VISION_MODEL: preserve(), OPENAI_API_KEY: preserve(), PORT: preserve(), SERVICE_ROLE: preserve(), STATENOUR_SYNC_KEY: preserve(), STATENOUR_WEB_URL: preserve(), TELEGRAM_BOT_TOKEN: preserve(), TELEGRAM_CHAT_ID: preserve(), VAPID_PRIVATE_KEY: preserve(), VAPID_PUBLIC_KEY: preserve(), VAPI_API_KEY: preserve(), VAPI_WEBHOOK_SECRET: preserve(), VENICE_API_KEY: preserve(), VENICE_MODEL: preserve(), XAI_API_KEY: preserve() },
  });
  const MAINnicksTireAuto = service("MAINnicks-tire-auto", {
    source: github("nourdean22/MAINnicks-tire-autoNEW"),
    build: { buildCommand: "pnpm --filter nicks-tire-auto... build", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["apps/nickstire/**", "!apps/nickstire/.remember/**", "!apps/nickstire/docs/*.md", "!apps/nickstire/docs/_archive/**", "!apps/nickstire/docs/activation/**", "!apps/nickstire/docs/admin-excellence/**", "!apps/nickstire/docs/admin-modernization/**", "!apps/nickstire/docs/admin-surface-audit/**", "!apps/nickstire/docs/analytics/**", "!apps/nickstire/docs/audits/**", "!apps/nickstire/docs/baselines/**", "!apps/nickstire/docs/brand/**", "!apps/nickstire/docs/bridge/**", "!apps/nickstire/docs/diagnostics/**", "!apps/nickstire/docs/eval-rubrics/**", "!apps/nickstire/docs/execution/**", "!apps/nickstire/docs/frontface-audit/**", "!apps/nickstire/docs/integrations/**", "!apps/nickstire/docs/operations/**", "!apps/nickstire/docs/plans/**", "!apps/nickstire/docs/postmortems/**", "!apps/nickstire/docs/recruiting/**", "!apps/nickstire/docs/runbooks/**", "!apps/nickstire/docs/stabilization/**", "!apps/nickstire/docs/whitepaper/**", "packages/gbp-publisher/**", "packages/meta-ads-architect/**", "packages/utils/**", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "turbo.json"] },
    start: "pnpm --filter nicks-tire-auto start",
    healthcheck: "/api/health",
    replicas: { "us-east4-eqdc4a": 1 },
    domains: ["nickstire.org"],
    networking: { privateNetworkEndpoint: "mainnicks-tire-auto" },
    env: { ADMIN_API_KEY: preserve(), ADMIN_EMAIL: preserve(), AI_FORCE_GEMINI: preserve(), AI_FORCE_OLLAMA: preserve(), AUDIO_QA_ENABLED: preserve(), AUTO_LABOR_PASSWORD: preserve(), AUTO_LABOR_USERNAME: preserve(), BRIDGE_API_KEY: preserve(), CAMERA_INGEST_KEY: preserve(), CEO_EMAIL: preserve(), CONTENT_REPLENISH_ENABLED: preserve(), DATABASE_URL: preserve(), EMAIL_FROM: preserve(), ENABLE_CUSTOMER_CONFIRMATIONS: preserve(), FB_APP_SECRET: preserve(), FB_VERIFY_TOKEN: preserve(), FEATURE_CONFIRMATION_CALLS: preserve(), FEATURE_DECLINED_RECOVERY: preserve(), FEATURE_FOLLOWUP_CADENCE: preserve(), FEATURE_UNPAID_INVOICE_RECOVERY: preserve(), FEATURE_VOICE_RECOVERY: preserve(), FIRECRAWL_API_KEY: preserve(), FOLLOWUP_CADENCE_DRY_RUN: preserve(), GATEWAY_TIRE_PASSWORD: preserve(), GATEWAY_TIRE_SHIP_TO: preserve(), GATEWAY_TIRE_USERNAME: preserve(), GBP_CLIENT_ID: preserve(), GBP_CLIENT_SECRET: preserve(), GBP_REDIRECT_URI: preserve(), GEMINI_API_KEY: preserve(), GOOGLE_MAPS_API_KEY: preserve(), GOOGLE_OAUTH_CLIENT_ID: preserve(), GOOGLE_OAUTH_CLIENT_SECRET: preserve(), GOOGLE_PLACES_API_KEY: preserve(), GOOGLE_PLACE_ID: preserve(), GOOGLE_SEARCH_CONSOLE_KEY: preserve(), GOOGLE_SERVICE_ACCOUNT_EMAIL: preserve(), GOOGLE_SERVICE_ACCOUNT_KEY: preserve(), GOOGLE_SHEETS_CRM_ID: preserve(), HF_API_KEY: preserve(), HIGGSFIELD_CREDENTIALS_JSON: preserve(), HIGGSFIELD_WORKSPACE_ID: preserve(), IG_AUTOPOST_DRYRUN: preserve(), IG_AUTOPOST_IMAGE_PROVIDER: preserve(), INNGEST_EVENT_KEY: preserve(), INNGEST_SIGNING_KEY: preserve(), INSTAGRAM_ACCESS_TOKEN: preserve(), INSTAGRAM_BUSINESS_ACCOUNT_ID: preserve(), JWT_SECRET: preserve(), LLM_LEDGER_ENABLED: preserve(), LLM_MODEL: preserve(), META_APP_ID: preserve(), META_APP_SECRET: preserve(), META_CAPI_ACCESS_TOKEN: preserve(), META_CAPI_PIXEL_ID: preserve(), META_IG_USER_ID: preserve(), META_PAGE_ACCESS_TOKEN: preserve(), META_PAGE_ID: preserve(), META_TOKEN_ISSUED_AT: preserve(), MISSED_CALL_RECOVERY_SEND: preserve(), NODE_ENV: preserve(), NODE_OPTIONS: preserve(), OLLAMA_API_KEY: preserve(), OPENAI_API_KEY: preserve(), OPENAI_BASE_URL: preserve(), OPENWEATHER_API_KEY: preserve(), PHOTO_ASSESS_PROVIDER: preserve(), OWNER_OPEN_ID: preserve(), OWNER_PHONE_NUMBER: preserve(), PRERENDER_ON_BUILD: preserve(), RAILPACK_DEPLOY_APT_PACKAGES: preserve(), RAILWAY_DEPLOYMENT_DRAINING_SECONDS: preserve(), REEL_AUTOPOST_ENABLED: preserve(), REEL_AUTO_VISUAL_WORLD: preserve(), REEL_COMMENT_RESPONDER_ENABLED: preserve(), REEL_COMMENT_RESPONDER_LIVE: preserve(), REEL_FILM_GRAIN: preserve(), REEL_GENERATION_ENABLED: preserve(), REEL_IMAGE_CONDITIONING: preserve(), REEL_PUBLISH_ENABLED: preserve(), REEL_VEO_AUDIO_DISABLED: preserve(), REEL_VEO_MODEL: preserve(), REEL_VIDEO_PROVIDER: preserve(), RENDERED_QA_ENABLED: preserve(), RESEND_API_KEY: preserve(), S3_ACCESS_KEY_ID: preserve(), S3_BUCKET: preserve(), S3_ENDPOINT: preserve(), S3_REGION: preserve(), S3_SECRET_ACCESS_KEY: preserve(), SENTRY_DSN: preserve(), SHOP_EMAIL: preserve(), SHOP_SMS_GATEWAY_DEVICE_ID: preserve(), SHOP_SMS_GATEWAY_PASSWORD: preserve(), SHOP_SMS_GATEWAY_URL: preserve(), SHOP_SMS_GATEWAY_USERNAME: preserve(), SHOP_SMS_GATEWAY_WEBHOOK_SECRET: preserve(), SITE_URL: preserve(), SMS_KILL_SWITCH: preserve(), STATENOUR_SYNC_KEY: preserve(), STATENOUR_SYNC_URL: preserve(), STRIPE_NONSTOP_NICK_PLUS_PRICE_ID: preserve(), STRIPE_NONSTOP_NICK_PRICE_ID: preserve(), STRIPE_PUBLISHABLE_KEY: preserve(), STRIPE_SECRET_KEY: preserve(), STRIPE_WEBHOOK_SECRET: preserve(), TELEGRAM_BOT_TOKEN: preserve(), TELEGRAM_CHAT_ID: preserve(), TWILIO_ACCOUNT_SID: preserve(), TWILIO_AUTH_TOKEN: preserve(), TWILIO_PHONE_NUMBER: preserve(), VAPID_EMAIL: preserve(), VAPID_PRIVATE_KEY: preserve(), VAPID_PUBLIC_KEY: preserve(), VAPI_API_KEY: preserve(), VAPI_FOLLOWUP_ASSISTANT_ID: preserve(), VAPI_RECEPTIONIST_ASSISTANT_ID: preserve(), VAPI_WEBHOOK_SECRET: preserve(), VENICE_API_KEY: preserve(), VITE_GOOGLE_OAUTH_CLIENT_ID: preserve(), VITE_SITE_URL: preserve() },
  });
  const statenourWeb = service("statenour-web", {
    source: github("nourdean22/MAINnicks-tire-autoNEW"),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/statenour/Dockerfile", watchPatterns: ["apps/statenour/**", "packages/ai-capabilities/**", "packages/lenses/**", "packages/social-assets/**", "packages/utils/**", "apps/nickstire/patches/**", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "turbo.json"] },
    healthcheck: "/api/system/heartbeat",
    healthcheckTimeout: 60,
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: { restartPolicyType: "ALWAYS" },
    domains: ["bdnick.info"],
    env: { ADMIN_API_KEY: preserve(), AGENT_BRIDGE_ENABLED: preserve(), AGENT_BRIDGE_SECRET_TOKEN: preserve(), AGENT_V2: preserve(), ALG_API_BASE: preserve(), ANTHROPIC_MODEL: preserve(), APOLLO_API_KEY: preserve(), APP_BASE_URL: preserve(), AUTH_ALLOWED_EMAIL: preserve(), AUTH_GOOGLE_CLIENT_ID: preserve(), AUTH_GOOGLE_CLIENT_SECRET: preserve(), AUTH_SECRET: preserve(), AUTH_TRUST_HOST: preserve(), AUTH_URL: preserve(), AUTO_LABOR_PASSWORD: preserve(), AUTO_LABOR_USERNAME: preserve(), BEA_API_KEY: preserve(), BGE_RERANK: preserve(), BRAINTRUST_API_KEY: preserve(), BRIDGE_API_KEY: preserve(), BROWSERBASE_API_KEY: preserve(), BROWSERBASE_PROJECT_ID: preserve(), CARTESIA_API_KEY: preserve(), CARTESIA_VOICE_ID: preserve(), CENSUS_API_KEY: preserve(), CLICKUP_API_KEY: preserve(), COHERE_API_KEY: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), DESCRIPT_API_KEY: preserve(), DIRECT_URL: preserve(), ENABLE_SPECIALIST_ROUTING: preserve(), FEATURE_BULK_SMS_LIVE: preserve(), FINNHUB_API_KEY: preserve(), FIRECRAWL_API_KEY: preserve(), FIREFLIES_API_KEY: preserve(), FRED_API_KEY: preserve(), GEMINI_API_KEY: preserve(), GITHUB_TOKEN: preserve(), GOOGLE_PLACES_API_KEY: preserve(), GOOGLE_PLACE_ID: preserve(), GOOGLE_SERVICE_ACCOUNT_EMAIL: preserve(), GOOGLE_SERVICE_ACCOUNT_KEY: preserve(), HEALTH_INGEST_TOKEN: preserve(), HF_API_KEY: preserve(), HF_EMBED_MODEL: preserve(), HUGGINGFACE_API_KEY: preserve(), IMAGES_REQUIRE_SIGNATURE: preserve(), INNGEST_EVENT_KEY: preserve(), INNGEST_MEGA_V2: preserve(), INNGEST_SIGNING_KEY: preserve(), LANGFUSE_BASE_URL: preserve(), LANGFUSE_PUBLIC_KEY: preserve(), LANGFUSE_SECRET_KEY: preserve(), MAKE_API_KEY: preserve(), MAKE_WEBHOOK_API_KEY: preserve(), MAKE_WEBHOOK_URL: preserve(), MASTRA_MEMORY_BACKEND: preserve(), META_IG_USER_ID: preserve(), META_PAGE_ACCESS_TOKEN: preserve(), META_PAGE_ID: preserve(), META_TOKEN_ISSUED_AT: preserve(), NARRATOR_LLM_SYNTHESIS: preserve(), NEXTAUTH_URL: preserve(), NEXT_PUBLIC_APP_URL: preserve(), NEXT_PUBLIC_SENTRY_DSN: preserve(), NEXT_PUBLIC_SITE_URL: preserve(), NICKSTIRE_URL: preserve(), NICKS_ADMIN_URL: preserve(), NICK_ANTICIPATORY_RECALL: preserve(), NICK_AUTONOMY: preserve(), NICK_CONTEXTUAL_RETRIEVAL: preserve(), NICK_CONTRADICTION_CLEANUP: preserve(), NICK_COVE: preserve(), NICK_DEEP_REASONING: preserve(), NICK_DEPTH_UNCAP: preserve(), NICK_EPISODIC_SPLIT: preserve(), NICK_EVENT_TRIGGERS: preserve(), NICK_FAILOVER_RESCUE: preserve(), NICK_IMPORTANCE_RECALL: preserve(), NICK_MULTI_AGENT_AUTO: preserve(), NICK_OUTCOME_LEARNING: preserve(), NICK_PRIME_PROMPT: preserve(), NICK_REFLECTION_TREES: preserve(), NICK_SELF_CONSISTENCY: preserve(), NICK_VERIFIED_REGEN: preserve(), NODE_ENV: preserve(), NOTEBOOKLM_MCP_URL: preserve(), OLLAMA_API_KEY: preserve(), OLLAMA_BASE_URL: preserve(), OLLAMA_FALLBACK_MODELS: preserve(), OLLAMA_FAST_MODEL: preserve(), OLLAMA_MODEL: preserve(), OLLAMA_VISION_MODEL: preserve(), OPENAI_API_KEY: preserve(), OPENROUTER_API_KEY: preserve(), PORT: preserve(), RAILWAY_WEBHOOK_TOKEN: preserve(), REDIS_URL: preserve(), RESEND_API_KEY: preserve(), SEMANTIC_DEDUP_LIVE: preserve(), SENTRY_DSN: preserve(), SERVICE_ROLE: preserve(), STATENOUR_SYNC_KEY: preserve(), TAVILY_API_KEY: preserve(), TELEGRAM_BOT_TOKEN: preserve(), TELEGRAM_CHAT_ID: preserve(), TELEGRAM_OWNER_ID: preserve(), TELEGRAM_WEBHOOK_SECRET: preserve(), TTS_ENGINE: preserve(), VAPID_PRIVATE_KEY: preserve(), VAPID_PUBLIC_KEY: preserve(), VAPI_API_KEY: preserve(), VAPI_WEBHOOK_SECRET: preserve(), VENICE_API_KEY: preserve(), VENICE_MODEL: preserve(), VIDEO_DB_API_KEY: preserve(), XAI_API_KEY: preserve() },
  });

  return project("natural-appreciation", {
    resources: [statenourWorker, MAINnicksTireAuto, statenourWeb, Redis, redisVolume, nickstireMedia],
  });
});
