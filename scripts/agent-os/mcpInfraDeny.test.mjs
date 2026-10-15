/**
 * Infra MCP mutation tools are DENIED BY NAME - canaries (job 2026-10-15-infra-deny-by-name). This file replaces mcpAskRules.test.mjs.
 *
 * THE GAP. AGENTS.md > Protected operations says credential rotation, Railway env or deploy-config edits, destructive schema commands
 * and production writes need Nour's explicit instruction every time. For MCP tools only an honour rule backed that: a tool such as
 * Railway set-variables, Neon delete_project or Vercel create_project_env carries no command text, so the PreToolUse command rules
 * never see it. The tool name and its arguments ARE the operation.
 *
 * WHAT FAILED. Job 2026-10-15-guard-sql-lease-infra wrote 135 native `permissions.ask` entries (`mcp__*__<leaf>`). Their live check
 * (2026-10-15 17:56Z, fresh session, bypassPermissions) showed they gate NOTHING: Railway delete-service, Vercel pause_project and
 * Prisma delete_prisma_postgres_database got no prompt and reached the provider. The cause was never separated (a mid-string glob
 * Claude Code does not honour, UUID server names, or ask not honoured in this app). They were removed in this job.
 *
 * THE FIX UNDER TEST. A hook DENY (exit 2), the only mechanism proven live on this machine in the same session (push-to-main and the
 * Neon SQL rows were refused). Rule `infra-mutation-tool` in config/agent-os/policy.json judges the TOOL NAME, anchored
 * `^mcp__.+__(?:leaf|...)$`, on the LAST segment only: connector UUIDs change when a connector is re-added, so the server segment
 * is never matched. The adapter row `infra-name` (`nameAsText: true`) hands the name to the rule. There is NO override: a first version
 * had an operator env var; review showed any non-blank value switched the rule off for every tool and target for the whole session (and
 * for later sessions through .claude/settings.local.json), which contradicts "explicit instruction for the specific action, every time".
 * An infra deny cannot wedge a session the way lease-check can, so nothing needs a way around it.
 *
 * WHAT THIS FILE PROVES, each block a way the gate could be a silent instrument:
 *   1. the fixtures (the classification: the SINGLE source of truth for the leaf list) are consistent
 *   2. policy.json: the rule and the row are well formed, both patterns equal the pattern built from the fixtures, no rule or row has an override
 *   3. every classified leaf on 4 server forms per provider is claimed and denied BY THIS RULE, IN PROCESS (adaptToolCall + evaluate: the same
 *      functions pretool.mjs calls); every MUST-ALLOW read, additive create, other connector's tool and known-unclassified writer is not denied.
 *      The REAL hook (a subprocess, exit 2 plus the rule id on stderr, never just "nonzero") is probed on a representative sample (4 leaves per
 *      provider x 4 forms, reads, controls) and a positive control asserts the in-process verdict and the real hook agree on every sampled name.
 *      Why not every leaf through the hook: 135 leaves x 4 forms plus the reads was 550+ node starts, 110 s of a CI job that has a 5-minute limit.
 *   4. the registration: each leaf is routed to pretool.mjs exactly once and never to lease-check; reads are NOT routed (they must not spawn the hook)
 *   5. NO override: AGENT_OS_INFRA_OVERRIDE set to a reason, and the look-alikes AGENT_OS_INFRA_OVERRIDES and INFRA_OVERRIDE, leave a denied tool denied through
 *      the real hook (a BREAKS arm re-adds an env check to a copy of policy.mjs and the canary goes red)
 *   6. the pattern is linear (hyphen, underscore, long-name sweep, a 100000-character name) and a positive control proves the sweep can see a slow one
 *   7. BREAKS: a leaf removed from the pattern flips exactly that leaf; no rule, no row, no nameAsText or no matcher registration flips the probes
 *   8. docs truth: the README names every denied leaf (derived from policy.json), states there is no override, and has the live check; AGENTS.md and the ledger say the same
 *
 * WHAT IT CANNOT PROVE: that a connector keeps the tool names in the fixtures (README live check step 7 is the receipt for the whole mechanism). FIXTURES: tool names read
 * from the live tool lists on 2026-10-15. A tool a connector ADDS later is in no fixture, so it is neither denied nor reported (README
 * "Refresh recipe"). A stale name in a fixture is a name that proves nothing: the 2026-10-15 refresh found one (list_edge_configs, live name get_edge_configs).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Namespace import on purpose: against a tree that has no nameAsText the module still loads and the canaries fail one by one.
import * as engine from "./policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const HOOK = join(HERE, "pretool.mjs");
const RULE_ID = "infra-mutation-tool";
const ROW_ID = "infra-name";
const OVERRIDE = "AGENT_OS_INFRA_OVERRIDE";

const policy = engine.loadPolicy();
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const README = readFileSync(join(ROOT, "docs", "agent-os", "README.md"), "utf8");
const NORMAL = "C:/Users/nourd/NOURCITY";

// The hook env carries no GIT_* (guard-red-team rule 6). AGENT_OS_INFRA_OVERRIDE is deliberately NOT stripped: the rule has no override, so a session
// that happens to export one must still get every deny below (the 'no override' canary sets it explicitly too).
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

const w = (s) => s.trim().split(/\s+/);

// --- fixtures (snapshot 2026-10-15) ------------------------------------------------------------------

// Server segments, as registered on this machine (UUIDs are per account). FORMS below adds the plugin, claude_ai_ and made-up forms.
const RAILWAY = "mcp__7f852746-c86d-4f4d-9dc6-3ca49eb07004__";
const NEON = "mcp__08daf860-d901-4ecf-8033-a2b41fe7f23d__";
const VERCEL = "mcp__0793f47a-c53c-42f1-9a1b-cea0ed09ac0e__";
const PRISMA_CONNECTOR = "mcp__1c28426e-fc0c-4e02-a13b-409e6d539b14__";
const PRISMA_PLUGIN = "mcp__plugin_prisma_Prisma-Remote__";

// MUST-DENY (the classification, the single source of truth for the leaf list): every one is denied by name. Mutations, deploys, credentials, destructive operations.
const RAILWAY_GATE = w(`set-variables redeploy restart-service update-service update-volume update-domain update-bucket update-webhook
  update-function-source-code delete-service delete-volume delete-domain delete-bucket delete-tcp-proxy delete-webhook delete-feature-flag
  set-feature-flag accept-deploy create-deployment deploy-template connect-service-source create-service create-function
  reset-bucket-credentials railway-agent`);
const NEON_GATE = w(`delete_project delete_branch delete_postgres_database delete_postgres_endpoint delete_postgres_role delete_snapshot
  delete_storage_bucket delete_storage_object delete_storage_objects_by_prefix delete_function delete_functions_custom_domain delete_data_api
  delete_trigger delete_auth_user delete_auth_oauth_provider delete_auth_trusted_domain disable_auth reset_from_parent restore_snapshot
  finalize_branch_restore set_default_branch suspend_postgres_endpoint restart_postgres_endpoint rotate_credential revoke_credential
  reset_postgres_role_password create_credential complete_database_migration complete_query_tuning update_project update_branch
  update_postgres_database update_postgres_endpoint update_auth_config update_auth_user_role update_auth_oauth_provider add_auth_oauth_provider
  add_auth_trusted_domain update_data_api update_function update_trigger update_snapshot deploy_function`);
const VERCEL_GATE = w(`add_project_domain assign_alias buy_domain create_or_transfer_domain cancel_deployment create_deployment create_project_env
  edit_project_env pause_project unpause_project update_project update_project_protection_bypass patch_url_protection_bypass put_firewall_config
  update_firewall_config update_attack_challenge_mode replace_domain_dns_records create_record update_record request_promote request_rollback
  start_rolling_release complete_rolling_release approve_rolling_release_stage update_rolling_release_config patch_edge_config_items
  update_edge_config restore_edge_config_backup create_edge_config_token restore_redirects stage_redirects update_bulk_redirect_version
  stage_routes add_route edit_route update_route_versions create_kms_signing_key activate_kms_signing_key revoke_kms_signing_key
  update_kms_issuer update_kms_issuer_policy issue_cert create_sdk_key update_flag update_flag_segment update_flag_settings update_connector
  upsert_connector_project_connection accept_project_transfer_request run_session_command write_session_files`);
const PRISMA_GATE = w(`delete_object_store_bucket delete_object_store_bucket_key delete_prisma_compute_app delete_prisma_compute_deployment
  delete_prisma_compute_env_var delete_prisma_postgres_connection_string delete_prisma_postgres_database set_prisma_compute_env_var
  rollback_prisma_compute_app promote_prisma_compute_deployment start_prisma_compute_deployment stop_prisma_compute_deployment
  create_prisma_postgres_connection_string create_prisma_postgres_recovery create_object_store_bucket_key execute_prisma_postgres_schema_update
  link_prisma_github_repository`);
const GATE_FAMILIES = [RAILWAY_GATE, NEON_GATE, VERCEL_GATE, PRISMA_GATE];
const ALL_GATE = [...new Set(GATE_FAMILIES.flat())];

// MUST-ALLOW: reads and additive creates of the same four families. None may be denied.
const RAILWAY_ALLOW = w(`get-logs list-deployments list-projects list-services list-variables list-domains list-workspaces list-feature-flags
  list-tcp-proxies list-traces list-webhooks get-service-config get-service-metrics get-deployment-diagnosis get-status get-trace get-tracing
  get-tracing-coverage get-feature-flag get-function-source-code get-staged-changes get-bucket-credentials describe-environment describe-service
  describe-template environment-status domain-status http-error-rate http-requests http-response-time search-docs search-templates fetch-docs
  whoami test-webhook create-project create-volume create-bucket create-tcp-proxy create-webhook generate-domain retry-domain-certificate
  set-service-tracing`);
const NEON_ALLOW = w(`run_sql run_sql_transaction explain_sql_statement prepare_database_migration prepare_query_tuning get_branch
  get_connection_string get_database_tables get_default_branch get_postgres_database get_postgres_endpoint get_postgres_role get_snapshot_schedule
  get_storage get_trigger get_function get_data_api get_auth get_operation list_projects list_branches list_credentials list_functions
  list_operations list_organizations list_postgres_databases list_postgres_endpoints list_postgres_roles list_project_members list_regions
  list_slow_queries list_snapshots list_storage_buckets list_storage_objects list_triggers describe_branch describe_project describe_table_schema
  compare_database_schema inspect_database query_logs search fetch send_feedback create_branch create_project create_snapshot
  create_postgres_database create_postgres_endpoint create_postgres_role create_storage_bucket create_trigger create_auth_user
  start_postgres_endpoint provision_neon_auth provision_neon_data_api recover_project register_functions_custom_domain set_snapshot_schedule`);
const VERCEL_ALLOW = w(`get_project get_deployment get_runtime_logs get_runtime_errors get_domain get_domain_config get_firewall_config
  get_project_env get_alias get_flag get_edge_config get_records get_team list_projects list_deployments list_domains list_aliases list_teams
  list_project_domains list_flags get_edge_configs list_deployment_events list_deployment_files list_sessions list_team_members
  search_vercel_documentation web_fetch_vercel_url search_repo search_domains verify_project_domain create_project create_flag
  create_edge_config get_session get_session_command_logs list_session_commands read_session_file`);
const PRISMA_ALLOW = w(`list_prisma_projects list_prisma_branches list_prisma_postgres_databases list_prisma_postgres_backups
  list_prisma_postgres_connection_strings list_prisma_compute_apps list_prisma_compute_deployments list_prisma_compute_builds
  list_object_store_buckets get_prisma_compute_deployment_logs get_prisma_github_setup get_agent_approval get_agent_connection
  introspect_database_schema fetch_workspace_details search_prisma_documentation execute_sql_query create_prisma_project create_prisma_branch
  create_prisma_postgres_database create_object_store_bucket`);
const ALL_ALLOW = [...new Set([...RAILWAY_ALLOW, ...NEON_ALLOW, ...VERCEL_ALLOW, ...PRISMA_ALLOW])];

// BENIGN controls from other connectors (Linear, Gmail, Calendar, Drive, Shopify, Canva, Figma, Higgsfield, ads): must never be denied.
const BENIGN = w(`delete_attachment delete_comment delete_diff_comment delete_status_update restore_issue_label restore_project_label
  retire_issue_label save_issue save_project save_comment update_diff merge_diff delete_draft delete_label trash_message trash_thread
  create_draft send_message reply forward update_label delete_event create_event update_event respond_to_event trash_file create_file copy_file
  update-product update-collection create-product create-discount set-inventory bulk-update-product-status edit-design create-design
  remove-background create_new_file use_figma send_code_to_figma upload_assets create_project create_folder deploy_website publish_website
  rename_website sandbox_exec manage_campaign update_budget pause_campaign launch_campaign`);

// KNOWN-UNCLASSIFIED: live writers and secret-bearing reads nobody has classified yet (README "Unclassified infrastructure
// tools"). Deliberately NOT denied until someone decides: disjoint from every list above, so denying
// one is a conscious edit that moves the name out of here first. Names are from the live registry on 2026-10-15.
const KNOWN_UNCLASSIFIED = w(`create_sandboxes_v2 create_sandboxes_v3 create_sandboxes_v4 create_sandboxes_sessions_by_session_id_snapshot_v2
  create_sandboxes_sessions_by_session_id_snapshot_v3 create_session_directory extend_session_timeout record_events get_access_to_vercel_url
  create_drain update_drain test_drain get_shared_env_var filter_project_envs create_git_project create_kms_issuer create_kms_issuer_policy
  update_sandbox update_session_network_policy kill_session_command stop_session invalidate_by_tags invalidate_by_src_images upload_file
  upload_artifact create_storage_stores_blob get_edge_config_token get_edge_config_tokens get_project_deletion_link create_trace_session
  create_observability_query rerequest_check retry_vercel_ci_invocation add_toolbar_reaction change_toolbar_thread_resolve_status
  edit_toolbar_message reply_to_toolbar_thread presign_storage_object get_neon_auth_config`);

// The SQL text tools are judged by TEXT in the PreToolUse hook (mcpAdapters), not denied by name.
const SQL_TEXT_LEAVES = ["run_sql", "run_sql_transaction", "explain_sql_statement", "execute_sql_query"];


// --- derived helpers ---------------------------------------------------------------------------------

// One server segment per provider and form. Each denied leaf is probed on FOUR forms of its own provider: the connector UUID registered on this
// machine, the plugin form, the claude_ai_ form and a made-up UUID (a connector re-added under a new id).
const MADE_UP = "mcp__a1b2c3d4-0000-4000-8000-123456789abc__";
const FORMS = {
  railway: [RAILWAY, "mcp__plugin_railway_railway__", "mcp__claude_ai_Railway__", MADE_UP],
  neon: [NEON, "mcp__plugin_neon_neon__", "mcp__claude_ai_Neon__", MADE_UP],
  vercel: [VERCEL, "mcp__plugin_vercel_vercel__", "mcp__claude_ai_Vercel__", MADE_UP],
  prisma: [PRISMA_CONNECTOR, PRISMA_PLUGIN, "mcp__claude_ai_Prisma__", MADE_UP],
};
const FAMILY_OF = [
  ["railway", RAILWAY_GATE, RAILWAY_ALLOW],
  ["neon", NEON_GATE, NEON_ALLOW],
  ["vercel", VERCEL_GATE, VERCEL_ALLOW],
  ["prisma", PRISMA_GATE, PRISMA_ALLOW],
];
/** Every `<form><leaf>` of the denied leaves, per provider (a leaf two providers share is probed on both). */
const DENY_NAMES = FAMILY_OF.flatMap(([provider, gate]) => gate.flatMap((leaf) => FORMS[provider].map((form) => ({ name: `${form}${leaf}`, leaf, provider }))));
/** Reads and additive creates of each provider on its UUID connector and its claude_ai_ form. */
const ALLOW_NAMES = FAMILY_OF.flatMap(([provider, , allow]) => allow.flatMap((leaf) => [FORMS[provider][0], FORMS[provider][2]].map((form) => ({ name: `${form}${leaf}`, leaf, provider }))));
const OTHER_NAMES = [...BENIGN, ...KNOWN_UNCLASSIFIED].flatMap((leaf) => [MADE_UP, "mcp__plugin_small-business_shopify__"].map((form) => ({ name: `${form}${leaf}`, leaf })));

// The leaf order is the fixtures' order: providers in this order, each sorted, a shared leaf listed once in the first provider.
const LEAF_ORDER = (() => {
  const seen = new Set();
  return GATE_FAMILIES.flatMap((family) => [...family].sort().filter((l) => !seen.has(l) && seen.add(l)));
})();
const patternFor = (leaves) => `^mcp__.+__(?:${leaves.join("|")})$`;
const EXPECTED_PATTERN = patternFor(LEAF_ORDER);
/** The leaves a pattern of the shipped shape names, parsed from the pattern text (so the README canary derives from policy.json, not from the fixtures). */
const leavesOf = (pattern) => /^\^mcp__\.\+__\(\?:(.+)\)\$$/.exec(pattern)?.[1].split("|") ?? [];

const rule = () => policy.rules.find((r) => r.id === RULE_ID);
const row = () => (policy.mcpAdapters ?? []).find((a) => a.id === ROW_ID);

// Tools that the SQL text rows already route to pretool: two of them are also denied leaves.
const SQL_ROUTED = ["run_sql", "run_sql_transaction", "explain_sql_statement", "complete_database_migration", "execute_sql_query", "execute_prisma_postgres_schema_update"];

// --- the REAL hook -------------------------------------------------------------------------------------

function run(tool_name, tool_input = {}, env = {}, hook = HOOK, cwd = NORMAL) {
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name, tool_input, cwd }), env: { ...ENV, ...env }, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status, signal: r.signal, err: r.stderr ?? "" };
}
function runAsync(tool_name, tool_input = {}, env = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [HOOK], { env: { ...ENV, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    const timer = setTimeout(() => child.kill(), 30000);
    child.stderr.on("data", (d) => { err += d; });
    child.stdout.resume();
    child.on("close", (code) => { clearTimeout(timer); done({ code, err }); });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ tool_name, tool_input, cwd: NORMAL }));
  });
}
/** Run `tasks` (functions returning promises) `width` at a time. */
async function pool(tasks, width = 8) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
  return out;
}
const isDenyByRule = (r, id = RULE_ID) => r.code === 2 && new RegExp(`BLOCKED by repo policy: ${id}(?![\\w-])`).test(r.err);
const isCleanAllow = (r) => r.code === 0 && !/hook error|adapter problem/.test(r.err);

// A copy of the REAL hook (pretool.mjs + policy.mjs) beside a policy.json (and optionally a policy.mjs) we are free to break.
function withTree(mutate, fn, mutateSource) {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-infra-"));
  try {
    mkdirSync(join(dir, "scripts", "agent-os"), { recursive: true });
    mkdirSync(join(dir, "config", "agent-os"), { recursive: true });
    for (const f of ["pretool.mjs", "policy.mjs"]) copyFileSync(join(HERE, f), join(dir, "scripts", "agent-os", f));
    if (mutateSource) {
      const path = join(dir, "scripts", "agent-os", "policy.mjs");
      const before = readFileSync(path, "utf8");
      const after = mutateSource(before);
      assert.notEqual(after, before, "the source mutation changed nothing in policy.mjs: the BREAKS arm would be vacuous");
      writeFileSync(path, after);
    }
    const p = JSON.parse(readFileSync(engine.POLICY_PATH, "utf8"));
    mutate?.(p);
    writeFileSync(join(dir, "config", "agent-os", "policy.json"), JSON.stringify(p));
    return fn(join(dir, "scripts", "agent-os", "pretool.mjs"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** In process: the verdict of the adapters plus the rules for a tool name, exactly as pretool.mjs builds it (no override). */
function judgeName(name, input = {}, pol = policy) {
  const calls = engine.adaptToolCall(name, input, NORMAL, pol);
  if (!calls) return { claimed: false, denied: false };
  for (const call of calls) {
    const res = engine.evaluate(call, pol);
    if (res.denied) return { claimed: true, denied: true, rule: res.rule, via: call.via };
  }
  return { claimed: true, denied: false };
}

// --- 1 - the fixtures --------------------------------------------------------------------------------

test("fixtures are consistent: nothing is both MUST-DENY and MUST-ALLOW or BENIGN, no list has a duplicate, the one shared leaf is update_project", () => {
  for (const [name, list] of Object.entries({ RAILWAY_GATE, NEON_GATE, VERCEL_GATE, PRISMA_GATE, RAILWAY_ALLOW, NEON_ALLOW, VERCEL_ALLOW, PRISMA_ALLOW, BENIGN })) {
    assert.ok(list.length >= 10, `${name} looks empty`);
    assert.equal(new Set(list).size, list.length, `${name} has a duplicate`);
  }
  const clash = ALL_GATE.filter((leaf) => ALL_ALLOW.includes(leaf) || BENIGN.includes(leaf) || KNOWN_UNCLASSIFIED.includes(leaf));
  assert.deepEqual(clash, [], "a leaf is either denied, allowed, benign or known-unclassified, never two of them: a name rule cannot tell a provider from another");
  assert.deepEqual(GATE_FAMILIES.flat().filter((leaf, i, all) => all.indexOf(leaf) !== i), ["update_project"], "the one leaf Neon and Vercel share");
  assert.deepEqual(KNOWN_UNCLASSIFIED.filter((leaf) => ALL_ALLOW.includes(leaf) || BENIGN.includes(leaf)), [], "move a name, do not copy it");
  assert.equal(new Set(LEAF_ORDER).size, ALL_GATE.length, "the derived leaf order must name every classified leaf once");
  assert.ok(ALL_ALLOW.length >= 150 && BENIGN.length >= 50, "the allow and benign lists are the false-positive proof surface");
  for (const leaf of SQL_TEXT_LEAVES) assert.ok(ALL_ALLOW.includes(leaf) || ALL_GATE.includes(leaf), `${leaf} must be classified`);
});

// --- 2 - policy.json ---------------------------------------------------------------------------------

test("policy.json: the rule and the adapter row exist and are well formed, and both patterns equal the pattern built from the classification", () => {
  const r = rule();
  assert.ok(r, `policy.json has no rule ${RULE_ID}`);
  assert.deepEqual(r.tools, ["Bash"], "the rule judges the Bash text the name row hands it");
  assert.equal(r.pattern, EXPECTED_PATTERN, "the rule's pattern drifted from the classification in this file: update both together (README 'Refresh recipe')");
  assert.equal(r.overrideEnv, undefined, "the rule has no override");
  assert.ok(r.why.length > 100 && r.fix.length > 100, "why and fix must tell an agent what happened and what to do");
  for (const needle of ["Nour", "provider dashboard or CLI", "no override"]) assert.ok(r.fix.includes(needle), `fix must mention ${needle}`);
  for (const text of [r.why, r.fix, row()?.why ?? ""]) assert.ok(!text.includes(OVERRIDE) && !/settings\.local\.json/.test(text), "no text of the rule or the row may point at an environment variable or a settings file that lifts it");
  assert.ok(r.denyExamples.length >= 8 && r.allowExamples.length >= 8, "the rule needs examples on several providers");
  assert.equal(r.flags, undefined, "tool names are case-sensitive");
  const a = row();
  assert.ok(a, `policy.json mcpAdapters has no row ${ROW_ID}`);
  assert.equal(a.as, "Bash");
  assert.equal(a.nameAsText, true, "the row must judge the tool NAME");
  assert.deepEqual(a.onlyRules, [RULE_ID], "the row is judged by this rule alone");
  assert.equal(a.toolPattern, r.pattern, "the row must claim exactly the tools the rule denies");
  assert.equal(a.rawText, undefined, "rawText would replace the hyphens the Railway names are made of");
  assert.equal(a.commandFields, undefined, "a name row reads no input field");
  assert.equal(a.clientHint, undefined);
  assert.deepEqual(leavesOf(a.toolPattern).sort(), [...ALL_GATE].sort(), "the leaves parsed from policy.json are exactly the classified ones");
  assert.equal(leavesOf(r.pattern).length, ALL_GATE.length);
  for (const t of a.exampleTools) assert.deepEqual((policy.mcpAdapters ?? []).filter((b) => new RegExp(b.toolPattern).test(t)).map((b) => b.id), [ROW_ID], `${t} must be claimed by this row alone`);
});

/** Every object key in a JSON value, recursively. */
const keysOf = (v) => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

test("NO rule, adapter row or engine source has an override of any kind; only infra-name judges the tool name", () => {
  assert.deepEqual(keysOf(policy.rules).concat(keysOf(policy.mcpAdapters)).filter((k) => /override|bypass|lift|unless|env/i.test(k)), [], "no policy key may name an override");
  for (const file of ["policy.mjs", "pretool.mjs"]) {
    const src = readFileSync(join(HERE, file), "utf8");
    assert.doesNotMatch(src, /overrideEnv|overrideReason|AGENT_OS_INFRA|process\.env/, `${file} must not read an environment variable to lift a rule`);
  }
  assert.deepEqual((policy.mcpAdapters ?? []).filter((a) => a.nameAsText !== undefined).map((a) => a.id), [ROW_ID]);
  for (const a of policy.mcpAdapters ?? []) for (const id of a.onlyRules ?? []) assert.ok(policy.rules.some((r) => r.id === id), `${a.id}: onlyRules names ${id}, which is not a rule`);
});

test("the pattern is anchored at both ends, matches the LAST segment only, and never names a server", () => {
  const re = new RegExp(rule().pattern);
  for (const [name, want] of [
    ["mcp__x__delete_project", true], ["mcp__a__b__c__delete_project", true], ["mcp__x__delete-service", true], ["mcp____delete_project", false], // an empty server segment is no registered tool
    ["mcp__x__delete_project_extra", false], ["xmcp__x__delete_project", false], ["mcp__delete_project", false], ["mcp__x__not_delete_project_", false],
    ["mcp__x__DELETE_PROJECT", false], ["Bash", false], ["delete_project", false], ["mcp__x__delete_project ", false], ["mcp__x__list_projects", false],
    ["mcp__plugin_github_github__delete_branch", true], // the leaf collides with a possible GitHub plugin: documented in the README collision section
  ]) assert.equal(re.test(name), want, `${JSON.stringify(name)} should ${want ? "match" : "not match"}`);
  assert.doesNotMatch(rule().pattern, /[0-9a-f]{8}-[0-9a-f]{4}-|plugin|claude_ai/i, "the pattern must not pin a UUID, a plugin or a claude_ai_ name: connectors are re-added under new ids");
});

// --- 3 - every leaf on every form --------------------------------------------------------------------

test("in process: every denied leaf on its 4 server forms is claimed by the row and denied BY THIS RULE", () => {
  assert.ok(DENY_NAMES.length >= 4 * ALL_GATE.length, "the matrix is every leaf x 4 forms (a loop over nothing is a silent green)");
  const bad = [];
  for (const { name } of DENY_NAMES) {
    const j = judgeName(name);
    if (!(j.claimed && j.denied && j.rule.id === RULE_ID && j.via === `${ROW_ID}.toolName`)) bad.push(`${name}: ${JSON.stringify({ claimed: j.claimed, denied: j.denied, rule: j.rule?.id, via: j.via })}`);
  }
  assert.deepEqual(bad, []);
});

test("in process: no MUST-ALLOW read or additive create, no other connector's tool and no known-unclassified writer is denied by ANY rule on any form", () => {
  assert.ok(ALLOW_NAMES.length >= 300 && OTHER_NAMES.length >= 100);
  const bad = [];
  for (const { name } of [...ALLOW_NAMES, ...OTHER_NAMES]) {
    const j = judgeName(name); // empty input: the SQL text tools are claimed by their own rows but have no text to judge
    if (j.denied) bad.push(`${name} (${j.rule.id})`);
  }
  assert.deepEqual(bad, []);
});

test("the SQL text tools are judged by TEXT and NOT by name; the two tools that also change schema are denied by name AND judged by text", () => {
  for (const leaf of ["run_sql", "run_sql_transaction", "explain_sql_statement", "execute_sql_query"]) {
    assert.ok(!ALL_GATE.includes(leaf), `${leaf} must not be denied by name: it is judged by TEXT in pretool.mjs`);
    assert.ok(ALL_ALLOW.includes(leaf), `${leaf} must be a MUST-ALLOW fixture`);
  }
  for (const leaf of ["complete_database_migration", "execute_prisma_postgres_schema_update"]) assert.ok(ALL_GATE.includes(leaf), `${leaf} applies a migration: denied by name`);
  // both rows judge the migration tool: the destructive statement is attributed to destructive-sql, a benign one to the name rule
  const m = `${NEON}complete_database_migration`;
  const calls = engine.adaptToolCall(m, { migration_sql: "SELECT 1" }, NORMAL, policy);
  assert.deepEqual(calls.map((c) => c.via), ["neon-migration-apply.migration_sql", `${ROW_ID}.toolName`], "text first, then the name");
  assert.equal(judgeName(m, { migration_sql: "DROP TABLE leads" }).rule.id, "destructive-sql");
  assert.equal(judgeName(m, { migration_sql: "SELECT 1" }).rule.id, RULE_ID);
});

// REAL-HOOK SAMPLE. The exhaustive matrix above is in process. The subprocess probes are representative: 4 leaves per provider (a delete, a variable
// or credential edit, a deploy or restart, and a leaf the SQL rows also claim or a shared one) on all 4 server forms, ten or so reads, and other
// connectors' tools. A node start costs about 0.1 s, so 135 leaves x 4 forms plus the reads (about 550 starts) was most of a CI job with a 5-minute limit.
const SAMPLE_DENY_LEAVES = {
  railway: ["delete-service", "set-variables", "redeploy", "restart-service"],
  neon: ["delete_project", "rotate_credential", "update_project", "complete_database_migration"],
  vercel: ["pause_project", "create_project_env", "update_project", "run_session_command"],
  prisma: ["delete_prisma_postgres_database", "set_prisma_compute_env_var", "execute_prisma_postgres_schema_update", "delete_object_store_bucket"],
};
const SAMPLE = [
  ...Object.entries(SAMPLE_DENY_LEAVES).flatMap(([provider, leaves]) => leaves.flatMap((leaf) => FORMS[provider].map((form) => ({ name: `${form}${leaf}`, deny: true })))),
  ...[
    [RAILWAY, "list-projects"], [RAILWAY, "get-logs"], [RAILWAY, "create-project"], [NEON, "list_projects"], [NEON, "run_sql"], [NEON, "create_branch"],
    [VERCEL, "list_deployments"], [VERCEL, "get_runtime_logs"], [VERCEL, "create_project"], [PRISMA_CONNECTOR, "list_prisma_projects"], [PRISMA_PLUGIN, "introspect_database_schema"],
    [MADE_UP, "update_budget"], [MADE_UP, "create_draft"], [MADE_UP, "create_drain"], ["mcp__claude_ai_Linear__", "delete_comment"],
  ].map(([form, leaf]) => ({ name: `${form}${leaf}`, deny: false })),
];

test("the REAL hook (a subprocess) agrees with the in-process verdict on a representative sample of at least 40 names: every sampled leaf denied with this rule id and the Judged-through line, every read exit 0", async () => {
  assert.ok(SAMPLE.length >= 40, `the agreement sample is ${SAMPLE.length} names, it must be at least 40`);
  assert.ok(SAMPLE.filter((s) => s.deny).length >= 4 * 4 * 4 && SAMPLE.filter((s) => !s.deny).length >= 10, "4 leaves x 4 providers x 4 forms denied, and 10 or so reads");
  const results = await pool(SAMPLE.map(({ name }) => () => runAsync(name, {})));
  const bad = [];
  results.forEach((r, i) => {
    const { name, deny } = SAMPLE[i];
    const real = isDenyByRule(r);
    const inProcess = judgeName(name).rule?.id === RULE_ID;
    const last = r.err.trimEnd().split("\n").at(-1);
    if (real !== deny || inProcess !== deny) bad.push(`${name}: expected deny=${deny}, real hook deny=${real} (exit ${r.code}), in-process deny=${inProcess}`);
    else if (deny && last !== `Judged through MCP adapter ${ROW_ID}.toolName on tool ${name}.`) bad.push(`${name}: wrong last line: ${last}`);
    else if (!deny && !isCleanAllow(r)) bad.push(`${name}: read not clean: exit ${r.code} ${r.err.slice(0, 120)}`);
  });
  assert.deepEqual(bad, [], "the in-process matrix and the real hook must give the same verdict on every sampled name, or the exhaustive in-process proof proves something the hook does not do");
});

test("the denial message tells an agent what to do: the rule, why, the exact action to report to Nour, that he runs it or edits the rule in a PR, and that there is no override", () => {
  const r = run(`${RAILWAY}delete-service`, { serviceId: "nonexistent" });
  assert.equal(r.code, 2);
  for (const needle of [`BLOCKED by repo policy: ${RULE_ID}`, "Why:", "Do:", "Nour", "provider dashboard or CLI", "changes this rule in a PR", "no override", "There is no bypass flag"]) assert.ok(r.err.includes(needle), `the denial must say: ${needle}\n${r.err}`);
  assert.ok(!r.err.includes(OVERRIDE) && !/settings\.local\.json/.test(r.err), "the denial must not point at an environment variable or a settings file");
  // the footer is the same for every rule
  const push = run("Bash", { command: "git push origin main" });
  assert.match(push.err, /There is no bypass flag/);
});

// --- 4 - the registration ----------------------------------------------------------------------------

const EXACT_ONLY = /^[A-Za-z0-9_\-\s,|]*$/;
const matcherMatches = (matcher, name) => (matcher === undefined || matcher === "" || matcher === "*" ? true : EXACT_ONLY.test(matcher) ? matcher.split(/[|,]/).map((s) => s.trim()).includes(name) : new RegExp(matcher).test(name));
const preGroups = (s) => s.hooks?.PreToolUse ?? [];
const groupsFor = (s, name) => preGroups(s).filter((g) => matcherMatches(g.matcher, name));
const commandsOf = (g) => (g.hooks ?? []).filter((h) => h.type === "command").map((h) => h.command);
const hooksFor = (s, name) => groupsFor(s, name).flatMap((g) => commandsOf(g).map((c) => c.match(/([\w-]+)\.mjs/)?.[1]));

/** Every way the registration of the infra tools is wrong, as readable lines. [] means right. */
function infraRoutingProblems(s) {
  const problems = [];
  const expect = (name, want) => {
    const got = hooksFor(s, name);
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: runs [${got}], expected [${want}]`);
  };
  for (const { name } of DENY_NAMES) expect(name, ["pretool"]); // exactly once, and never lease-check: these tools never touch the worktree
  for (const { name, leaf } of ALLOW_NAMES) expect(name, SQL_ROUTED.includes(leaf) ? ["pretool"] : []); // reads must not spawn the hook
  for (const { name } of OTHER_NAMES) expect(name, []);
  return problems;
}

test("registration: every denied leaf on every form runs pretool.mjs exactly once and never lease-check; reads and other connectors' tools run no hook", () => {
  assert.deepEqual(infraRoutingProblems(settings), []);
});

test("registration: the matcher is one anchored regex that means the same anchored or unanchored for every name probed", () => {
  const group = groupsFor(settings, `${RAILWAY}delete-service`)[0];
  assert.ok(group, "no group routes a Railway delete-service");
  const m = group.matcher;
  assert.ok(!EXACT_ONLY.test(m), "a matcher of only letters, digits and _ - , | would be an EXACT-name list, not a regex");
  assert.doesNotThrow(() => new RegExp(m));
  for (const { name } of [...DENY_NAMES, ...ALLOW_NAMES, ...OTHER_NAMES]) {
    assert.equal(new RegExp(m).test(name), new RegExp(`^(?:${m})$`).test(name), `${name}: the matcher gives a different answer anchored and unanchored`);
  }
});

test("registration: the configured command string, run VERBATIM through a shell, denies a Railway delete-service and lets a read through (guard-red-team rule 5)", () => {
  const name = `${RAILWAY}delete-service`;
  const group = groupsFor(settings, name).find((g) => commandsOf(g).some((c) => /pretool\.mjs/.test(c)));
  assert.ok(group, `no group routes ${name}`);
  const command = commandsOf(group).find((c) => /pretool\.mjs/.test(c));
  assert.ok(!command.includes("\\"), "a backslash separator does not resolve on Linux (cloud sessions)");
  const env = { ...ENV, CLAUDE_PROJECT_DIR: ROOT };
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const go = (tool_name) => spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify({ tool_name, tool_input: {}, cwd: NORMAL }), encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  const bad = go(name);
  assert.equal(bad.status, 2, `expected a deny through the configured command, got ${bad.status}\n${bad.stdout}${bad.stderr}`);
  assert.match(bad.stderr, new RegExp(`BLOCKED by repo policy: ${RULE_ID}`));
  const ok = go(`${RAILWAY}list-projects`);
  assert.equal(ok.status, 0, `a read was not allowed (exit ${ok.status})\n${ok.stdout}${ok.stderr}`);
});

test("BREAKS: a matcher without the infra leaves, or no pretool group at all, is reported by tool name; the unbroken registration is clean", () => {
  assert.deepEqual(infraRoutingProblems(settings), [], "control: the real registration is right");
  const pretool = (s) => preGroups(s).find((g) => matcherMatches(g.matcher, `${RAILWAY}delete-service`) && commandsOf(g).some((c) => /pretool\.mjs/.test(c)));
  // the matcher as it stood before this job: runners, writers and the SQL text tools only
  const old = structuredClone(settings);
  pretool(old).matcher = "^(?:Monitor|mcp__.+__(?:run_in_terminal|start_process|interact_with_process|write_file|edit_file|edit_block|write_pdf|move_file|run_sql|run_sql_transaction|explain_sql_statement|complete_database_migration|execute_sql_query|execute_prisma_postgres_schema_update))$";
  const missing = infraRoutingProblems(old);
  const expectedMissing = DENY_NAMES.filter(({ leaf }) => !SQL_ROUTED.includes(leaf)).length;
  assert.equal(missing.length, expectedMissing, `exactly the denied leaves the SQL group did not already route are reported (${missing.length} vs ${expectedMissing})`);
  assert.ok(missing.some((l) => l.startsWith(`${RAILWAY}delete-service:`)) && missing.some((l) => l.includes("pause_project")));
  // one leaf dropped from the matcher: exactly that leaf, on every form, is reported
  for (const leaf of ["delete-service", "set-variables", "delete_project", "pause_project", "delete_prisma_postgres_database", "update_project", "run_session_command"]) {
    const s = structuredClone(settings);
    const g = pretool(s);
    const next = g.matcher.replace(new RegExp(`\\|${leaf}(?=\\||\\)\\)\\$$)`), "");
    assert.notEqual(next, g.matcher, `${leaf}: not found in the matcher as its own alternative`);
    g.matcher = next;
    const reported = infraRoutingProblems(s);
    const names = DENY_NAMES.filter((d) => d.leaf === leaf).length;
    assert.equal(reported.length, names, `${leaf}: expected one report per denied name (${names}), got ${reported.length}: ${reported.slice(0, 3).join(" | ")}`);
    assert.ok(reported.every((l) => l.includes(`__${leaf}:`)), `${leaf}: the canary named something else: ${reported.slice(0, 3).join(" | ")}`);
  }
  // no pretool group at all for these tools
  const none = structuredClone(settings);
  none.hooks.PreToolUse = none.hooks.PreToolUse.filter((g) => !matcherMatches(g.matcher, `${RAILWAY}delete-service`) || !commandsOf(g).some((c) => /pretool\.mjs/.test(c)));
  assert.ok(infraRoutingProblems(none).length >= DENY_NAMES.length, "with the MCP group gone every denied name must be reported");
});

test("settings.json: the 135 inert ask rules are gone, and no allow entry names a denied tool", () => {
  const ask = settings.permissions?.ask;
  assert.ok(ask === undefined || (Array.isArray(ask) && ask.length === 0), `permissions.ask must be absent or empty, it has ${ask?.length} entries: they gated nothing in the live check`);
  for (const rule of settings.permissions?.allow ?? []) {
    if (!rule.startsWith("mcp__")) continue;
    assert.ok(!ALL_GATE.includes(rule.split("__").pop()), `${rule} is allowed but its leaf is denied by name: the allow entry would be dead`);
  }
});

// --- 5 - there is NO override ---------------------------------------------------------------------

const DELETE_PROJECT = `${NEON}delete_project`;

test("NO override: AGENT_OS_INFRA_OVERRIDE set to a reason, and the look-alikes, leave a denied tool denied (exit 2, this rule id), through the real hook", () => {
  const variants = [
    { AGENT_OS_INFRA_OVERRIDE: "operator asked for it" }, { AGENT_OS_INFRA_OVERRIDE: "1" }, { AGENT_OS_INFRA_OVERRIDE: " " }, { AGENT_OS_INFRA_OVERRIDE: "" },
    { AGENT_OS_INFRA_OVERRIDES: "operator asked for it" }, { INFRA_OVERRIDE: "operator asked for it" }, { AGENT_OS_LEASE_OVERRIDE: "operator asked for it" },
    { AGENT_OS_INFRA_OVERRIDE: "operator asked for it", AGENT_OS_INFRA_OVERRIDES: "x", INFRA_OVERRIDE: "x", AGENT_OS_LEASE_OVERRIDE: "x" },
  ];
  for (const tool of [DELETE_PROJECT, `${RAILWAY}delete-service`]) {
    for (const env of variants) {
      const r = run(tool, { project_id: "nonexistent" }, env);
      assert.ok(isDenyByRule(r), `${tool} with env ${JSON.stringify(env)}: expected a deny by ${RULE_ID}, got exit ${r.code}\n${r.err}`);
      assert.ok(!/WARNING|allowing a call/.test(r.err), "a denial is never downgraded to a warning");
    }
  }
  // a destructive migration through the tool the SQL rows also claim stays denied, and attributed to the SQL rule first
  const mig = run(`${NEON}complete_database_migration`, { migration_sql: "DROP TABLE leads", migration_id: "m" }, variants[0]);
  assert.ok(isDenyByRule(mig, "destructive-sql"), mig.err);
});

test("BREAKS: a copy of the engine that DID honour AGENT_OS_INFRA_OVERRIDE is caught by the no-override canary, and the unbroken copy denies", () => {
  const env = { AGENT_OS_INFRA_OVERRIDE: "operator asked for it" };
  withTree(null, (hook) => assert.ok(isDenyByRule(run(DELETE_PROJECT, {}, env, hook)), "control: the unbroken copy denies with the variable set"));
  withTree(
    null,
    (hook) => {
      const r = run(DELETE_PROJECT, {}, env, hook);
      assert.equal(r.code, 0, "BREAKS: with an env check added to evaluate() the call passes, which is exactly what the canary above must catch");
      assert.ok(!isDenyByRule(r), "and it is no longer attributed to the rule");
    },
    (src) => src.replace(
      "export function evaluate({ toolName, command = \"\", filePath = \"\", cwd = \"\", skipRules, onlyRules, rawText }, policy) {",
      "export function evaluate({ toolName, command = \"\", filePath = \"\", cwd = \"\", skipRules, onlyRules, rawText }, policy) {\n  if ((process.env.AGENT_OS_INFRA_OVERRIDE ?? \"\").trim()) return { denied: false };",
    ),
  );
});

// --- 6 - nameAsText in the engine --------------------------------------------------------------------

const clone = () => structuredClone(policy);
const rowOf = (p) => p.mcpAdapters.find((a) => a.id === ROW_ID);
const NAME = `${NEON}delete_project`;

test("nameAsText: true judges the tool name (whole), false or absent judges the fields only; a row needs no field list", () => {
  const calls = engine.adaptToolCall(NAME, { project_id: "x", command: "git push origin main" }, NORMAL, policy);
  assert.deepEqual(calls.map((c) => [c.toolName, c.command, c.rawText, c.onlyRules, c.via]), [["Bash", NAME, false, [RULE_ID], `${ROW_ID}.toolName`]], "the name only: no field is read");
  for (const off of [undefined, false]) {
    const p = clone();
    const r = rowOf(p);
    if (off === undefined) delete r.nameAsText; else r.nameAsText = off;
    r.commandFields = ["command"];
    const c = engine.adaptToolCall(NAME, { command: "echo hi" }, NORMAL, p);
    assert.deepEqual(c.map((x) => [x.command, x.via]), [["echo hi", `${ROW_ID}.command`]], `nameAsText ${off}: the field is judged, the name is not`);
  }
  // both: a row may carry a field list as well
  const both = clone();
  rowOf(both).commandFields = ["command"];
  assert.deepEqual(engine.adaptToolCall(NAME, { command: "echo hi" }, NORMAL, both).map((x) => x.via), [`${ROW_ID}.toolName`, `${ROW_ID}.command`]);
});

test("nameAsText is validated toward DENIAL: a malformed value still judges the name and is reported; a bad field list is ignored and reported, never the row", () => {
  for (const bad of ["true", 1, null, [], {}, "false", 0]) {
    const lines = [];
    const p = clone();
    rowOf(p).nameAsText = bad;
    const c = engine.adaptToolCall(NAME, {}, NORMAL, p, (l) => lines.push(l));
    assert.deepEqual(c.map((x) => x.via), [`${ROW_ID}.toolName`], `nameAsText ${JSON.stringify(bad)}: the name is still judged`);
    assert.ok(lines.some((l) => /nameAsText malformed, the tool name is judged/.test(l)), `reported: ${lines.join(" | ")}`);
    assert.ok(engine.evaluate(c[0], p).denied, "and the call is still denied");
  }
  for (const bad of [[], [7], [""], "command", null, {}]) {
    const lines = [];
    const p = clone();
    rowOf(p).commandFields = bad;
    const c = engine.adaptToolCall(NAME, { command: "x" }, NORMAL, p, (l) => lines.push(l));
    assert.deepEqual(c.map((x) => x.via), [`${ROW_ID}.toolName`], `commandFields ${JSON.stringify(bad)}: ignored, the name is still judged`);
    assert.ok(lines.some((l) => /commandFields .* ignored, the tool name is still judged/.test(l)), `reported: ${lines.join(" | ")}`);
  }
  // on a Write row it means nothing: reported, the path fields are judged as before
  const lines = [];
  const p = clone();
  p.mcpAdapters = [{ id: "w", toolPattern: "^mcp__.+__write_file$", as: "Write", pathFields: ["path"], nameAsText: true, exampleTools: ["x"], why: "a name flag on a file row must not hide the path judgment" }];
  const c = engine.adaptToolCall("mcp__s__write_file", { path: "a/.env" }, NORMAL, p, (l) => lines.push(l));
  assert.deepEqual(c.map((x) => [x.toolName, x.filePath]), [["Write", "a/.env"]]);
  assert.ok(lines.some((l) => /nameAsText malformed/.test(l)));
});

test("nameAsText cap: a name is judged WHOLE up to SQL_FIELD_CAP when only this rule runs (a 100000-character name is denied in process; the real hook has its own 2 long-name probes in the sweep), and sliced like a field otherwise", () => {
  const long = `mcp__${"x".repeat(100_000)}__delete_project`;
  const calls = engine.adaptToolCall(long, {}, NORMAL, policy);
  assert.deepEqual(calls.map((c) => c.via), [`${ROW_ID}.toolName`], "one whole judgment");
  assert.ok(engine.evaluate(calls[0], policy).denied);
  const sliced = clone();
  delete rowOf(sliced).onlyRules; // every rule applies, so the generic cap applies
  assert.deepEqual(engine.adaptToolCall(long, {}, NORMAL, sliced).map((c) => c.via), [`${ROW_ID}.toolName#head`, `${ROW_ID}.toolName#tail`]);
  const huge = `mcp__${"x".repeat(engine.SQL_FIELD_CAP + 10)}__delete_project`;
  assert.deepEqual(engine.adaptToolCall(huge, {}, NORMAL, policy).map((c) => c.via), [`${ROW_ID}.toolName#head`, `${ROW_ID}.toolName#tail`], "beyond SQL_FIELD_CAP: head and tail (a documented pin, no real tool name is that long)");
});

test("a row that names a rule that does not exist is reported and ignored, so every rule applies: a half-deleted config is loud (BREAKS)", () => {
  withTree((p) => { p.rules = p.rules.filter((r) => r.id !== RULE_ID); }, (hook) => {
    const r = run(DELETE_PROJECT, {}, {}, hook);
    assert.equal(r.code, 0, "with the rule gone nothing denies");
    assert.match(r.err, /onlyRules ignored, every rule applies/, "but the dangling onlyRules is reported on stderr");
  });
});

// --- 7 - linear, not catastrophic --------------------------------------------------------------------

function timedChild(pattern, text, killMs) {
  const child = `const { readFileSync, writeSync } = require("node:fs");
const { source, text } = JSON.parse(readFileSync(0, "utf8"));
const re = new RegExp(source);
const t0 = process.hrtime.bigint();
const hit = re.test(text);
writeSync(1, JSON.stringify({ ms: Number(process.hrtime.bigint() - t0) / 1e6, hit }));`;
  const r = spawnSync(process.execPath, ["-e", child], { input: JSON.stringify({ source: pattern, text }), encoding: "utf8", timeout: killMs, maxBuffer: 1 << 20 });
  return r.signal ? { killed: true } : { killed: false, ...JSON.parse(r.stdout) };
}

test("SWEEP: hyphen, underscore, dot, space, digits and the leaves themselves repeated to 100,000 characters: every name is judged fast and with the right verdict", () => {
  const re = new RegExp(rule().pattern);
  const units = ["_", "__", "-", "--", "a", "7", ".", " ", "mcp__", "__mcp__", "__delete_", "__delete_project", "delete_project", "__delete-", "__a", "_delete_project_", "__update_project__"];
  const slow = [];
  const wrong = [];
  for (const unit of units) {
    for (const size of [30, 300, 3000, 100_000]) {
      const body = unit.repeat(Math.ceil(size / unit.length));
      for (const [name, want] of [[`mcp__${body}`, body.endsWith("__delete_project")], [`mcp__${body}__delete_project`, true], [`mcp__${body}__delete_project_x`, false], [`mcp__x__${body}`, body.endsWith("__delete_project")]]) {
        const t0 = process.hrtime.bigint();
        const got = re.test(name);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (got !== want) wrong.push(`${JSON.stringify(unit)} x${size} ${JSON.stringify(name.slice(0, 20))}...: ${got}, expected ${want}`);
        if (ms > 500) slow.push(`${JSON.stringify(unit)} x${size}: ${ms.toFixed(0)} ms`);
      }
    }
  }
  assert.deepEqual(wrong, []);
  assert.deepEqual(slow, [], "a name that costs half a second in a regex is not linear");
});

test("SWEEP through the real hook, 2 long-name cases: a 100,000-character name of repeated underscores returns inside the hook timeout, denied when it ends in a leaf and clean when it does not", async () => {
  const body = "__delete_".repeat(Math.ceil(100_000 / 9));
  const jobs = [{ name: `mcp__${body}__delete_project`, deny: true }, { name: `mcp__${body}__list_projects`, deny: false }];
  const t0 = Date.now();
  const results = await Promise.all(jobs.map((j) => runAsync(j.name, {})));
  results.forEach((r, i) => assert.ok(jobs[i].deny ? isDenyByRule(r) : isCleanAllow(r), `${jobs[i].name.slice(0, 24)}...(${jobs[i].name.length} chars): exit ${r.code}`));
  assert.ok(Date.now() - t0 < 9_000, "the probe must finish far inside the 10 s hook timeout (a timeout fails OPEN)");
});

test("SWEEP positive control: the same sweep sees a catastrophic pattern (a nested quantifier on the same alternation is killed or at least 10x slower on the same text)", () => {
  const shipped = rule().pattern;
  const catastrophic = shipped.replace("^mcp__.+__", "^mcp__(?:.+)+__");
  assert.notEqual(catastrophic, shipped, "the shipped prefix changed shape: update this control");
  const text = `mcp__${"a".repeat(25)}`;
  const good = timedChild(shipped, text, 20000);
  const bad = timedChild(catastrophic, text, 15000);
  assert.ok(!good.killed, "the shipped pattern must finish the control text");
  assert.ok(bad.killed || bad.ms >= 10 * Math.max(good.ms, 20), `positive control: the nested quantifier took ${bad.ms} ms against ${good.ms} ms for the shipped pattern: under 10x, so this sweep cannot see a slow pattern`);
});

// --- 8 - BREAKS: the leaf list, the rule, the row, nameAsText ----------------------------------------

test("BREAKS in process: removing one leaf from the pattern flips exactly that leaf, on every form, and no other", () => {
  assert.equal(new RegExp(patternFor(LEAF_ORDER)).test(`${MADE_UP}delete_project`), true, "control: the full pattern denies");
  for (const leaf of LEAF_ORDER) {
    const re = new RegExp(patternFor(LEAF_ORDER.filter((l) => l !== leaf)));
    for (const other of LEAF_ORDER) assert.equal(re.test(`${MADE_UP}${other}`), other !== leaf, `without ${leaf}: ${other} should ${other === leaf ? "pass" : "still deny"}`);
  }
});

test("BREAKS through the real hook: a policy copy without one leaf lets exactly that leaf through on two server forms while a neighbour still denies (the in-process arm above covers every leaf)", () => {
  for (const [leaf, neighbour, forms] of [["delete-service", "set-variables", [RAILWAY, "mcp__claude_ai_Railway__"]], ["delete_prisma_postgres_database", "set_prisma_compute_env_var", [PRISMA_PLUGIN, MADE_UP]]]) {
    const without = patternFor(LEAF_ORDER.filter((l) => l !== leaf));
    withTree((p) => { p.rules.find((r) => r.id === RULE_ID).pattern = without; rowOf(p).toolPattern = without; }, (hook) => {
      for (const form of forms) {
        const free = run(`${form}${leaf}`, {}, {}, hook);
        assert.equal(free.code, 0, `${leaf} on ${form}: removed from the pattern, expected exit 0\n${free.err}`);
        assert.ok(isDenyByRule(run(`${form}${neighbour}`, {}, {}, hook)), `${neighbour} on ${form} must still be denied`);
      }
    });
  }
});

test("BREAKS: no row, no nameAsText, or a row whose rule is gone lets the denied tool through (the unbroken copy and native Bash still deny)", () => {
  withTree(null, (hook) => assert.ok(isDenyByRule(run(DELETE_PROJECT, {}, {}, hook)), "control: the unbroken copy denies"));
  withTree((p) => { p.mcpAdapters = p.mcpAdapters.filter((a) => a.id !== ROW_ID); }, (hook) => {
    assert.equal(run(DELETE_PROJECT, {}, {}, hook).code, 0, "no row: the name is never handed to the rule");
    assert.ok(isDenyByRule(run("Bash", { command: "git push origin main" }, {}, hook), "push-to-main"), "native Bash in the same tree");
  });
  withTree((p) => { delete rowOf(p).nameAsText; }, (hook) => {
    const r = run(DELETE_PROJECT, {}, {}, hook);
    assert.equal(r.code, 0, "without nameAsText the row has no field to read and is skipped");
    assert.match(r.err, /adapter problem/, "and the skipped row is reported loudly");
  });
  withTree((p) => { rowOf(p).toolPattern = "^nothing$"; }, (hook) => assert.equal(run(DELETE_PROJECT, {}, {}, hook).code, 0, "a row that claims no real tool"));
  withTree((p) => { rowOf(p).as = "Write"; rowOf(p).pathFields = ["path"]; }, (hook) => assert.equal(run(DELETE_PROJECT, { path: "x" }, {}, hook).code, 0, "a row that maps the name onto a file path"));
});

test("a plain Bash command is not denied by this rule (railway logs, variables and run are Bash and unaffected); only a command that IS a tool name is (a documented pin)", () => {
  for (const command of ["git status", "echo mcp__x__delete_project", "mcp__x__delete_project now", "rg -n delete_project apps/", "railway logs --service web", "railway variables", "railway run -- node scripts/x.mjs", "gh pr list --state open", "railway status"]) {
    assert.equal(engine.evaluate({ toolName: "Bash", command, cwd: NORMAL }, policy).rule?.id, undefined, `Bash ${JSON.stringify(command)} must not be denied`);
    assert.ok(isCleanAllow(run("Bash", { command })), `Bash ${command}`);
  }
  // pin: the rule is typed Bash so the name row can hand it text, which means a Bash command that is exactly a denied tool name is denied too. No real command looks like that.
  assert.equal(engine.evaluate({ toolName: "Bash", command: "mcp__x__delete_project", cwd: NORMAL }, policy).rule?.id, RULE_ID);
});

// --- 9 - docs truth ----------------------------------------------------------------------------------

const normal = (s) => s.replace(/\s+/g, " ");

test("README 'Infra tools: deny by name': the why, the denied list by provider (every leaf, derived from policy.json), that there is no override, what is unaffected, the collisions and the live check", () => {
  const start = README.indexOf("### Infra tools: deny by name");
  assert.ok(start >= 0, "README needs the section '### Infra tools: deny by name'");
  const section = README.slice(start, README.indexOf("### Still unguarded", start));
  const text = normal(section);
  assert.ok(section.length > 3000, "the section is too short to carry the denied list");
  assert.ok(text.includes(`The denied tool list (${leavesOf(rule().pattern).length}).`), "the README must state the denied-leaf count, derived from policy.json (a count in prose is a cache with no invalidation)");
  assert.ok(!README.includes("### Native ask rules"), "the ask section was replaced");
  for (const leaf of leavesOf(rule().pattern)) assert.ok(section.includes(`\`${leaf}\``), `the README denied-tool table must list \`${leaf}\` (derived from policy.json)`);
  for (const provider of ["Railway", "Neon", "Vercel", "Prisma"]) assert.match(section, new RegExp(`\\| ${provider} \\|`), `the table needs a ${provider} row`);
  for (const phrase of [RULE_ID, "FAILED their live check", "pause_project", "delete_prisma_postgres_database", "bypassPermissions", "railway run", "railway variables", "railway logs", "`gh`",
    "MCP reads", "nameAsText", "Refresh recipe", "Collisions", "list-projects", "There is NO override", "**No override.**", "provider dashboard or CLI", "edits the rule in a PR"]) assert.ok(text.includes(phrase), `README 'Infra tools: deny by name' must say: ${phrase}`);
  // derived from policy.json: the README says there is no override exactly because the rule has none, and it never tells anyone how to set one
  assert.equal(rule().overrideEnv, undefined, "the README says there is no override: the rule must not declare one");
  assert.doesNotMatch(section, /(?:set|export|add|put)s?\s+(?:the\s+)?(?:variable\s+)?`?AGENT_OS_INFRA_OVERRIDE/i, "the README must not tell anyone to set the override variable");
  assert.doesNotMatch(section, /Only the OPERATOR can lift|operator override exists|lifts `infra-mutation-tool` only|step 8/i, "old override wording returned");
  assert.ok(!/Override probe/.test(README), "the override live-check step is gone");
  assert.doesNotMatch(README, /permissions\.ask.{0,40}(?:prompt|prompts) before each|135 protected leaves prompt/, "an old claim that the ask rules prompt returned");
  const live = normal(README.slice(README.indexOf("### Live check after merge")));
  for (const phrase of [`BLOCKED by repo policy: ${RULE_ID}`, "no operator taps", "delete-service", "delete_project", "pause_project", "delete_prisma_postgres_database", "list-projects", "positive control", "bypassPermissions"]) assert.ok(live.includes(phrase), `README live check step must say: ${phrase}`);
  assert.doesNotMatch(live, /Step 7 FAIL[^.]*replace the `mcp__\*__<leaf>` entries/, "the recorded FAIL stays as history but must not remain the instruction");
});

test("AGENTS.md and CLAUDE.md say infra MCP mutation tools are DENIED by name, name the rule, say there is no override, and keep the Bash paths unaffected; the rule count is current", () => {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  const lines = agents.split("\n");
  const rowText = lines.find((l) => l.startsWith("| ") && l.includes("config/agent-os/policy.json") && l.includes("blocked at the tool call")) ?? "";
  assert.ok(rowText, "AGENTS.md first Enforcement-map row not found");
  for (const phrase of ["DENIED by name", RULE_ID, "no override", "Bash", "unaffected", "`lease-check.mjs`", "SQL text tools", "were never covered", "docs/agent-os/README.md"]) assert.ok(rowText.includes(phrase), `AGENTS.md row must say: ${phrase}`);
  assert.ok(!rowText.includes(OVERRIDE), "the row must not mention an override variable: there is none");
  assert.doesNotMatch(rowText, /gate nothing yet|NO working gate|permissions\.ask|FAILED their live check/, "the row says the gate WORKS now: the old 'no working gate' wording must not return");
  const lineCount = lines.length - (agents.endsWith("\n") ? 1 : 0); // the gate's own metric: a file ending in a newline has N lines, not N+1
  assert.ok(lineCount <= 200, `AGENTS.md has ${lineCount} lines, the cap is 200`);
  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  const stated = [...claude.matchAll(/\((\d+) rules,/g)].map((m) => Number(m[1]));
  assert.deepEqual(stated, [policy.rules.length], "CLAUDE.md states the policy rule count (derived from policy.json, never hardcoded here)");
});

// The ledger is state, not a spec: rows are appended, Status moves BUILT -> MERGED -> LIVE-VERIFIED and Next is rewritten as the job advances. A first version of this test pinned
// "last row", Status BUILT and the guard row's Next text; the next PR that appended a row failed the every-PR policy job (2026-10-15). So this pins only what holds for the row's
// whole life: one row, eight cells, no override mention, and, while the row is still open, who acts and by when. Row order, the Status word and any Next text are NOT pinned.
test("ledger: this job has ONE row with eight cells and no override mention; while open (PLANNED, RUNNING, BUILT) Next names an owner and a date; the guard row exists once with eight cells", () => {
  const text = readFileSync(join(ROOT, "docs", "agent-os", "MANAGER-LEDGER.md"), "utf8");
  const rows = text.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Job id") && !l.startsWith("|---"));
  const mine = rows.filter((l) => l.startsWith("| 2026-10-15-infra-deny-by-name |"));
  assert.equal(mine.length, 1, "exactly one ledger row for this job");
  const cell = mine[0].split("|").map((c) => c.trim());
  assert.equal(cell.length, 10, "eight cells, no pipe inside any cell");
  if (["PLANNED", "RUNNING", "BUILT"].includes(cell[5])) {
    assert.match(cell[7], /\b(?:Nour|manager|operator)\b/i, `an open row (${cell[5]}) names an owner in Next`);
    assert.match(cell[7], /\b\d{4}-\d\d-\d\d\b/, `an open row (${cell[5]}) names a date in Next`);
  }
  assert.ok(!mine[0].includes(OVERRIDE), "the ledger row must not mention an override variable: there is none");
  const guard = rows.filter((l) => l.startsWith("| 2026-10-15-guard-sql-lease-infra |"));
  assert.equal(guard.length, 1, "the guard row exists exactly once");
  assert.equal(guard[0].split("|").length, 10, "the guard row has eight cells");
});
