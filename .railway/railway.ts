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
// ⚠ THE railway.json FILES ARE DELIBERATELY STILL PRESENT. They remain the
// effective config until `railway config apply` runs, and a service cannot be
// managed by both systems — so they are removed as part of the apply step, not
// before it. See .railway/README.md for the ordered runbook.
//
// No secrets here: every variable renders as `preserve()`, which keeps the
// value Railway already holds. Never run `config plan --show-values` into a log.

import { bucket, defineRailway, github, image, preserve, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Redis = redis("Redis", { region: "us-west2" });
  Redis.deploy = { startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis", tcpProxies: { "6379": {} } };
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 500 });
  const perplexicaVolume = volume("perplexica-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 50000 });
  const nickstireMedia = bucket("nickstire-media", { region: "sjc" });
  const statenourWorker = service("statenour-worker", {
    source: github("nourdean22/MAINnicks-tire-autoNEW", { checkSuites: false, rootDirectory: "/" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/worker/Dockerfile", watchPatterns: ["apps/worker/**", "apps/statenour/lib/**", "packages/reel-engine/**", "apps/nickstire/patches/**", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "turbo.json"] },
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "ALWAYS" },
    env: { ALG_API_BASE: preserve(), APOLLO_API_KEY: preserve(), AUTH_GOOGLE_CLIENT_ID: preserve(), AUTH_GOOGLE_CLIENT_SECRET: preserve(), AUTH_SECRET: preserve(), AUTO_LABOR_PASSWORD: preserve(), AUTO_LABOR_USERNAME: preserve(), BRIDGE_API_KEY: preserve(), CLICKUP_API_KEY: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), DIRECT_URL: preserve(), FIRECRAWL_API_KEY: preserve(), FIREFLIES_API_KEY: preserve(), GEMINI_API_KEY: preserve(), GITHUB_TOKEN: preserve(), GOOGLE_SERVICE_ACCOUNT_EMAIL: preserve(), GOOGLE_SERVICE_ACCOUNT_KEY: preserve(), HUGGINGFACE_API_KEY: preserve(), MAKE_API_KEY: preserve(), MAKE_WEBHOOK_API_KEY: preserve(), MAKE_WEBHOOK_URL: preserve(), META_IG_USER_ID: preserve(), META_PAGE_ACCESS_TOKEN: preserve(), META_PAGE_ID: preserve(), NICKS_ADMIN_URL: preserve(), NODE_ENV: preserve(), OLLAMA_API_KEY: preserve(), OLLAMA_BASE_URL: preserve(), OLLAMA_FALLBACK_MODELS: preserve(), OLLAMA_FAST_MODEL: preserve(), OLLAMA_MODEL: preserve(), OLLAMA_VISION_MODEL: preserve(), OPENAI_API_KEY: preserve(), PERPLEXICA_API_URL: preserve(), PERPLEXICA_CHAT_MODEL: preserve(), PERPLEXICA_CHAT_PROVIDER: preserve(), PORT: preserve(), SERVICE_ROLE: preserve(), STATENOUR_SYNC_KEY: preserve(), STATENOUR_WEB_URL: preserve(), TELEGRAM_BOT_TOKEN: preserve(), TELEGRAM_CHAT_ID: preserve(), VAPID_PRIVATE_KEY: preserve(), VAPID_PUBLIC_KEY: preserve(), VAPI_API_KEY: preserve(), VAPI_WEBHOOK_SECRET: preserve(), VENICE_API_KEY: preserve(), VENICE_MODEL: preserve(), XAI_API_KEY: preserve() },
  });
  const perplexica = service("perplexica", {
    source: image("itzcrazykns1337/perplexica:slim-v1.12.0"),
    replicas: { "us-west2": 1 },
    volumeMounts: { "/home/perplexica/data": perplexicaVolume },
    env: { HOSTNAME: preserve(), PORT: preserve(), SEARXNG_API_URL: preserve() },
  });
  const MAINnicksTireAuto = service("MAINnicks-tire-auto", {
    source: github("nourdean22/MAINnicks-tire-autoNEW", { checkSuites: false }),
    build: { buildCommand: "pnpm --filter nicks-tire-auto... build", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["apps/nickstire/**", "packages/gbp-publisher/**", "packages/meta-ads-architect/**", "packages/utils/**", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "turbo.json"] },
    start: "pnpm --filter nicks-tire-auto start",
    healthcheck: "/api/health",
    replicas: { "us-west2": 1 },
    domains: ["nickstire.org"],
    networking: { privateNetworkEndpoint: "mainnicks-tire-auto" },
    env: { ADMIN_API_KEY: preserve(), ADMIN_EMAIL: preserve(), AI_FORCE_GEMINI: preserve(), AI_FORCE_OLLAMA: preserve(), AUDIO_QA_ENABLED: preserve(), AUTO_LABOR_PASSWORD: preserve(), AUTO_LABOR_USERNAME: preserve(), BRIDGE_API_KEY: preserve(), CAMERA_INGEST_KEY: preserve(), CEO_EMAIL: preserve(), CONTENT_REPLENISH_ENABLED: preserve(), DATABASE_URL: preserve(), EMAIL_FROM: preserve(), ENABLE_CUSTOMER_CONFIRMATIONS: preserve(), FB_APP_SECRET: preserve(), FB_VERIFY_TOKEN: preserve(), FEATURE_CONFIRMATION_CALLS: preserve(), FEATURE_DECLINED_RECOVERY: preserve(), FEATURE_FOLLOWUP_CADENCE: preserve(), FEATURE_UNPAID_INVOICE_RECOVERY: preserve(), FEATURE_VOICE_RECOVERY: preserve(), FIRECRAWL_API_KEY: preserve(), FOLLOWUP_CADENCE_DRY_RUN: preserve(), GATEWAY_TIRE_PASSWORD: preserve(), GATEWAY_TIRE_SHIP_TO: preserve(), GATEWAY_TIRE_USERNAME: preserve(), GBP_CLIENT_ID: preserve(), GBP_CLIENT_SECRET: preserve(), GBP_REDIRECT_URI: preserve(), GEMINI_API_KEY: preserve(), GOOGLE_MAPS_API_KEY: preserve(), GOOGLE_OAUTH_CLIENT_ID: preserve(), GOOGLE_OAUTH_CLIENT_SECRET: preserve(), GOOGLE_PLACES_API_KEY: preserve(), GOOGLE_PLACE_ID: preserve(), GOOGLE_SEARCH_CONSOLE_KEY: preserve(), GOOGLE_SERVICE_ACCOUNT_EMAIL: preserve(), GOOGLE_SERVICE_ACCOUNT_KEY: preserve(), GOOGLE_SHEETS_CRM_ID: preserve(), HF_API_KEY: preserve(), HIGGSFIELD_CREDENTIALS_JSON: preserve(), IG_AUTOPOST_DRYRUN: preserve(), IG_AUTOPOST_IMAGE_PROVIDER: preserve(), INNGEST_EVENT_KEY: preserve(), INNGEST_SIGNING_KEY: preserve(), INSTAGRAM_ACCESS_TOKEN: preserve(), INSTAGRAM_BUSINESS_ACCOUNT_ID: preserve(), JWT_SECRET: preserve(), LLM_LEDGER_ENABLED: preserve(), LLM_MODEL: preserve(), META_APP_ID: preserve(), META_APP_SECRET: preserve(), META_CAPI_ACCESS_TOKEN: preserve(), META_CAPI_PIXEL_ID: preserve(), META_IG_USER_ID: preserve(), META_PAGE_ACCESS_TOKEN: preserve(), META_PAGE_ID: preserve(), META_TOKEN_ISSUED_AT: preserve(), MISSED_CALL_RECOVERY_SEND: preserve(), NODE_ENV: preserve(), NODE_OPTIONS: preserve(), OLLAMA_API_KEY: preserve(), OPENAI_API_KEY: preserve(), OPENAI_BASE_URL: preserve(), OWNER_OPEN_ID: preserve(), OWNER_PHONE_NUMBER: preserve(), PRERENDER_ON_BUILD: preserve(), RAILPACK_DEPLOY_APT_PACKAGES: preserve(), REEL_AUTOPOST_ENABLED: preserve(), REEL_AUTO_VISUAL_WORLD: preserve(), REEL_COMMENT_RESPONDER_ENABLED: preserve(), REEL_COMMENT_RESPONDER_LIVE: preserve(), REEL_FILM_GRAIN: preserve(), REEL_GENERATION_ENABLED: preserve(), REEL_IMAGE_CONDITIONING: preserve(), REEL_PUBLISH_ENABLED: preserve(), REEL_VEO_AUDIO_DISABLED: preserve(), REEL_VEO_MODEL: preserve(), REEL_VIDEO_PROVIDER: preserve(), RENDERED_QA_ENABLED: preserve(), RESEND_API_KEY: preserve(), S3_ACCESS_KEY_ID: preserve(), S3_BUCKET: preserve(), S3_ENDPOINT: preserve(), S3_REGION: preserve(), S3_SECRET_ACCESS_KEY: preserve(), SENTRY_DSN: preserve(), SHOP_EMAIL: preserve(), SHOP_SMS_GATEWAY_DEVICE_ID: preserve(), SHOP_SMS_GATEWAY_PASSWORD: preserve(), SHOP_SMS_GATEWAY_URL: preserve(), SHOP_SMS_GATEWAY_USERNAME: preserve(), SHOP_SMS_GATEWAY_WEBHOOK_SECRET: preserve(), SITE_URL: preserve(), SMS_KILL_SWITCH: preserve(), SOCIAL_INVENTORY_PUBLISH_ENABLED: preserve(), STATENOUR_SYNC_KEY: preserve(), STATENOUR_SYNC_URL: preserve(), STRIPE_NONSTOP_NICK_PLUS_PRICE_ID: preserve(), STRIPE_NONSTOP_NICK_PRICE_ID: preserve(), STRIPE_PUBLISHABLE_KEY: preserve(), STRIPE_SECRET_KEY: preserve(), STRIPE_WEBHOOK_SECRET: preserve(), TELEGRAM_BOT_TOKEN: preserve(), TELEGRAM_CHAT_ID: preserve(), TWILIO_ACCOUNT_SID: preserve(), TWILIO_AUTH_TOKEN: preserve(), TWILIO_PHONE_NUMBER: preserve(), VAPID_EMAIL: preserve(), VAPID_PRIVATE_KEY: preserve(), VAPID_PUBLIC_KEY: preserve(), VAPI_API_KEY: preserve(), VAPI_FOLLOWUP_ASSISTANT_ID: preserve(), VAPI_RECEPTIONIST_ASSISTANT_ID: preserve(), VAPI_WEBHOOK_SECRET: preserve(), VENICE_API_KEY: preserve(), VITE_GOOGLE_OAUTH_CLIENT_ID: preserve(), VITE_SITE_URL: preserve() },
  });
  const searxngPerplexica = service("searxng-perplexica", {
    replicas: { "us-west2": 1 },
    env: { SEARXNG_SECRET: preserve() },
  });
  const statenourWeb = service("statenour-web", {
    source: github("nourdean22/MAINnicks-tire-autoNEW", { checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/statenour/Dockerfile", watchPatterns: ["apps/statenour/**", "packages/ai-capabilities/**", "packages/lenses/**", "packages/social-assets/**", "packages/utils/**", "apps/nickstire/patches/**", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "turbo.json"] },
    healthcheck: "/api/system/heartbeat",
    healthcheckTimeout: 60,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "ALWAYS" },
    domains: ["bdnick.info"],
    env: { ADMIN_API_KEY: preserve(), AGENT_BRIDGE_ENABLED: preserve(), AGENT_BRIDGE_SECRET_TOKEN: preserve(), AGENT_V2: preserve(), ALG_API_BASE: preserve(), ANTHROPIC_MODEL: preserve(), APOLLO_API_KEY: preserve(), APP_BASE_URL: preserve(), AUTH_ALLOWED_EMAIL: preserve(), AUTH_GOOGLE_CLIENT_ID: preserve(), AUTH_GOOGLE_CLIENT_SECRET: preserve(), AUTH_SECRET: preserve(), AUTH_TRUST_HOST: preserve(), AUTH_URL: preserve(), AUTO_LABOR_PASSWORD: preserve(), AUTO_LABOR_USERNAME: preserve(), BEA_API_KEY: preserve(), BGE_RERANK: preserve(), BRAINTRUST_API_KEY: preserve(), BRIDGE_API_KEY: preserve(), BROWSERBASE_API_KEY: preserve(), BROWSERBASE_PROJECT_ID: preserve(), CARTESIA_API_KEY: preserve(), CARTESIA_VOICE_ID: preserve(), CENSUS_API_KEY: preserve(), CLICKUP_API_KEY: preserve(), COHERE_API_KEY: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), DESCRIPT_API_KEY: preserve(), DIRECT_URL: preserve(), ENABLE_SPECIALIST_ROUTING: preserve(), FEATURE_BULK_SMS_LIVE: preserve(), FINNHUB_API_KEY: preserve(), FIRECRAWL_API_KEY: preserve(), FIREFLIES_API_KEY: preserve(), FRED_API_KEY: preserve(), GEMINI_API_KEY: preserve(), GITHUB_TOKEN: preserve(), GOOGLE_PLACES_API_KEY: preserve(), GOOGLE_PLACE_ID: preserve(), GOOGLE_SERVICE_ACCOUNT_EMAIL: preserve(), GOOGLE_SERVICE_ACCOUNT_KEY: preserve(), HEALTH_INGEST_TOKEN: preserve(), HF_API_KEY: preserve(), HF_EMBED_MODEL: preserve(), HUGGINGFACE_API_KEY: preserve(), IMAGES_REQUIRE_SIGNATURE: preserve(), INNGEST_EVENT_KEY: preserve(), INNGEST_MEGA_V2: preserve(), INNGEST_SIGNING_KEY: preserve(), LANGFUSE_BASE_URL: preserve(), LANGFUSE_PUBLIC_KEY: preserve(), LANGFUSE_SECRET_KEY: preserve(), MAKE_API_KEY: preserve(), MAKE_WEBHOOK_API_KEY: preserve(), MAKE_WEBHOOK_URL: preserve(), MASTRA_MEMORY_BACKEND: preserve(), META_IG_USER_ID: preserve(), META_PAGE_ACCESS_TOKEN: preserve(), META_PAGE_ID: preserve(), META_TOKEN_ISSUED_AT: preserve(), NARRATOR_LLM_SYNTHESIS: preserve(), NEXTAUTH_URL: preserve(), NEXT_PUBLIC_APP_URL: preserve(), NEXT_PUBLIC_SENTRY_DSN: preserve(), NEXT_PUBLIC_SITE_URL: preserve(), NICKSTIRE_URL: preserve(), NICKS_ADMIN_URL: preserve(), NICK_ANTICIPATORY_RECALL: preserve(), NICK_AUTONOMY: preserve(), NICK_CONTEXTUAL_RETRIEVAL: preserve(), NICK_CONTRADICTION_CLEANUP: preserve(), NICK_COVE: preserve(), NICK_DEEP_REASONING: preserve(), NICK_DEPTH_UNCAP: preserve(), NICK_EPISODIC_SPLIT: preserve(), NICK_EVENT_TRIGGERS: preserve(), NICK_FAILOVER_RESCUE: preserve(), NICK_IMPORTANCE_RECALL: preserve(), NICK_MULTI_AGENT_AUTO: preserve(), NICK_OUTCOME_LEARNING: preserve(), NICK_PRIME_PROMPT: preserve(), NICK_REFLECTION_TREES: preserve(), NICK_SELF_CONSISTENCY: preserve(), NICK_VERIFIED_REGEN: preserve(), NODE_ENV: preserve(), NOTEBOOKLM_MCP_URL: preserve(), OLLAMA_API_KEY: preserve(), OLLAMA_BASE_URL: preserve(), OLLAMA_FALLBACK_MODELS: preserve(), OLLAMA_FAST_MODEL: preserve(), OLLAMA_MODEL: preserve(), OLLAMA_VISION_MODEL: preserve(), OPENAI_API_KEY: preserve(), OPENROUTER_API_KEY: preserve(), PERPLEXICA_API_URL: preserve(), PERPLEXICA_CHAT_MODEL: preserve(), PERPLEXICA_CHAT_PROVIDER: preserve(), PORT: preserve(), REDIS_URL: preserve(), RESEND_API_KEY: preserve(), SEMANTIC_DEDUP_LIVE: preserve(), SENTRY_DSN: preserve(), SERVICE_ROLE: preserve(), STATENOUR_SYNC_KEY: preserve(), TAVILY_API_KEY: preserve(), TELEGRAM_BOT_TOKEN: preserve(), TELEGRAM_CHAT_ID: preserve(), TELEGRAM_OWNER_ID: preserve(), TELEGRAM_WEBHOOK_SECRET: preserve(), TTS_ENGINE: preserve(), VAPID_PRIVATE_KEY: preserve(), VAPID_PUBLIC_KEY: preserve(), VAPI_API_KEY: preserve(), VAPI_WEBHOOK_SECRET: preserve(), VENICE_API_KEY: preserve(), VENICE_MODEL: preserve(), VIDEO_DB_API_KEY: preserve(), XAI_API_KEY: preserve() },
  });

  return project("natural-appreciation", {
    resources: [statenourWorker, perplexica, MAINnicksTireAuto, searxngPerplexica, statenourWeb, Redis, redisVolume, perplexicaVolume, nickstireMedia],
  });
});
