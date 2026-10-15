/**
 * Native `permissions.ask` rules for protected infrastructure MCP tools - canaries
 * (job 2026-10-15-guard-sql-lease-infra, commit 4).
 *
 * THE GAP. AGENTS.md > Protected operations says credential rotation, Railway env or deploy-config edits,
 * destructive schema commands and production writes need Nour's explicit instruction every time. For MCP tools
 * only an honour rule backed that. The PreToolUse hook judges COMMAND and SQL text, and a tool such as Railway
 * set-variables, Neon delete_project or Vercel create_project_env carries no command text: the tool name and its
 * arguments ARE the operation.
 *
 * THE FIX. `permissions.ask` in .claude/settings.json, one `mcp__*__<leaf>` entry per protected tool. Why a native
 * rule and not hook code (Claude Code docs, code.claude.com/docs/en/permissions, read 2026-10-15): a tool matched by
 * an explicit ask rule still prompts in bypassPermissions mode, there is no JavaScript to crash (a hook fails OPEN
 * on its own bugs and on timeout, a rule does not), and a prompt nobody can answer (claude -p, Night Shift) is
 * denied. A hook `ask` is not documented to prompt in bypass, and a hook deny cannot honour "explicit instruction".
 * No UUID and no plugin name in an entry: connector UUIDs are per account and change on reconnect (the stale
 * 16f59cb5-... allow entries in this very file are the proof).
 *
 * WHAT THIS FILE PROVES, each block a way the rules could be a silent instrument:
 *   1. the glob emulation itself is right (positive control: the docs' own examples) before anything is judged by it
 *   2. every entry is a plain `mcp__*__<leaf>` string, UUID-free, parenthesis-free, duplicate-free, in the intended order
 *   3. every protected leaf is asked on every server form (the four connector UUIDs, the Prisma-Remote plugin, and
 *      two synthetic reconnect forms), and no read, additive create or other connector's tool is asked
 *   4. the SQL text tools are NOT asked per call: they are judged by TEXT in the hook
 *   5. BREAKS: delete or mistype one entry in a copy and the canary names exactly that leaf
 *
 * WHAT IT CANNOT PROVE: that Claude Code itself applies a glob in the SERVER segment of an ask rule. The docs' own
 * example is only `mcp__*` and `mcp__<server>__*`; `mcp__*__<leaf>` rests on "deny and ask rules accept glob
 * patterns in the tool-name position". This file runs an emulation of that rule. The live check is in
 * docs/agent-os/README.md ("Live check after merge"): a nonexistent-id Railway delete-service and Neon
 * delete_project must each PROMPT before anything is sent. If one returns a provider error instead, the glob form
 * is wrong and the entries must become exact names.
 *
 * WHAT IT CANNOT SEE EITHER: drift. This file compares settings.json to the fixtures below and to nothing else. A tool
 * a connector renamed or ADDED after the 2026-10-15 snapshot is in no fixture, so it is neither asked nor reported.
 * Claude Code gives no startup warning for a mistyped or missing rule, so the refresh recipe (README, "Native ask
 * rules", "The drift caveat, exactly") is the only check on the fixtures themselves.
 *
 * FIXTURES: tool names read from the live tool lists on 2026-10-15; every MUST-GATE name was resolved with
 * ToolSearch select: (schemas read, no tool called). Update the lists and settings.json together when a connector
 * adds a tool. The 2026-10-15 refresh found one stale ALLOW name (list_edge_configs, live name get_edge_configs):
 * a stale name in a fixture is a name that proves nothing.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
// Missing or malformed is an empty list here, so every canary below fails with a readable diff instead of crashing on undefined.
const ask = Array.isArray(settings.permissions?.ask) ? settings.permissions.ask : [];

const w = (s) => s.trim().split(/\s+/);

// --- fixtures (snapshot 2026-10-15) ------------------------------------------------------------------

// Server segments, as registered on this machine (UUIDs are per account), plus two synthetic reconnect forms.
const RAILWAY = "mcp__7f852746-c86d-4f4d-9dc6-3ca49eb07004__";
const NEON = "mcp__08daf860-d901-4ecf-8033-a2b41fe7f23d__";
const VERCEL = "mcp__0793f47a-c53c-42f1-9a1b-cea0ed09ac0e__";
const PRISMA_CONNECTOR = "mcp__1c28426e-fc0c-4e02-a13b-409e6d539b14__";
const PRISMA_PLUGIN = "mcp__plugin_prisma_Prisma-Remote__";
const SERVER_FORMS = [RAILWAY, NEON, VERCEL, PRISMA_CONNECTOR, PRISMA_PLUGIN, "mcp__00000000-0000-0000-0000-000000000000__", "mcp__plugin_neon_neon__"];

// MUST-GATE: every one prompts. Mutations, deploys, credentials, destructive operations.
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

// MUST-ALLOW: reads and additive creates of the same four families. None may prompt.
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

// BENIGN controls from other connectors (Linear, Gmail, Calendar, Drive, Shopify, Canva, Figma, Higgsfield, ads): must never prompt.
const BENIGN = w(`delete_attachment delete_comment delete_diff_comment delete_status_update restore_issue_label restore_project_label
  retire_issue_label save_issue save_project save_comment update_diff merge_diff delete_draft delete_label trash_message trash_thread
  create_draft send_message reply forward update_label delete_event create_event update_event respond_to_event trash_file create_file copy_file
  update-product update-collection create-product create-discount set-inventory bulk-update-product-status edit-design create-design
  remove-background create_new_file use_figma send_code_to_figma upload_assets create_project create_folder deploy_website publish_website
  rename_website sandbox_exec manage_campaign update_budget pause_campaign launch_campaign`);

// KNOWN-UNCLASSIFIED: live writers and secret-bearing reads nobody has classified yet (README "Unclassified infrastructure
// tools"). Deliberately NOT prompted until someone decides: disjoint from every list above and asserted not asked, so asking
// for one is a conscious edit that moves the name out of here first. Names are from the live registry on 2026-10-15.
const KNOWN_UNCLASSIFIED = w(`create_sandboxes_v2 create_sandboxes_v3 create_sandboxes_v4 create_sandboxes_sessions_by_session_id_snapshot_v2
  create_sandboxes_sessions_by_session_id_snapshot_v3 create_session_directory extend_session_timeout record_events get_access_to_vercel_url
  create_drain update_drain test_drain get_shared_env_var filter_project_envs create_git_project create_kms_issuer create_kms_issuer_policy
  update_sandbox update_session_network_policy kill_session_command stop_session invalidate_by_tags invalidate_by_src_images upload_file
  upload_artifact create_storage_stores_blob get_edge_config_token get_edge_config_tokens get_project_deletion_link create_trace_session
  create_observability_query rerequest_check retry_vercel_ci_invocation add_toolbar_reaction change_toolbar_thread_resolve_status
  edit_toolbar_message reply_to_toolbar_thread presign_storage_object get_neon_auth_config`);

// The SQL text tools are judged by TEXT in the PreToolUse hook (mcpAdapters), not prompted per call.
const SQL_TEXT_LEAVES = ["run_sql", "run_sql_transaction", "explain_sql_statement", "execute_sql_query"];

// --- the emulation under test ------------------------------------------------------------------------

/** `*` is any run of characters (including "_"), every other character is literal, and the WHOLE tool name must match. */
function globToRegExp(pattern) {
  return new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}
const asking = (rules, name) => rules.filter((r) => globToRegExp(r).test(name));

/** Every `<server><leaf>` full name of a MUST-GATE leaf that no rule in `rules` would prompt for. */
function unaskedGate(rules) {
  const out = [];
  for (const leaf of ALL_GATE) for (const server of SERVER_FORMS) if (asking(rules, `${server}${leaf}`).length === 0) out.push(`${server}${leaf}`);
  return out;
}
/** Every `<server><leaf>` full name of a read, additive create or other connector's tool that a rule in `rules` WOULD prompt for. */
function wronglyAsked(rules) {
  const out = [];
  for (const leaf of [...ALL_ALLOW, ...BENIGN]) for (const server of SERVER_FORMS) if (asking(rules, `${server}${leaf}`).length) out.push(`${server}${leaf}`);
  return out;
}

/** Every `<server><leaf>` full name of a KNOWN_UNCLASSIFIED leaf that a rule in `rules` WOULD prompt for. */
function askedUnclassified(rules) {
  const out = [];
  for (const leaf of KNOWN_UNCLASSIFIED) for (const server of SERVER_FORMS) if (asking(rules, `${server}${leaf}`).length) out.push(`${server}${leaf}`);
  return out;
}

// --- 1 - the emulation, positive control first -------------------------------------------------------

test("glob emulation, positive control first: * is any run of characters, the whole tool name must match, the docs' own examples hold", () => {
  const g = globToRegExp;
  // the documented examples: `mcp__*` is every MCP tool of every server, `mcp__puppeteer__*` only puppeteer's, `*` everything
  assert.ok(g("mcp__*").test("mcp__puppeteer__navigate") && g("mcp__*").test("mcp__plugin_prisma_Prisma-Remote__delete_prisma_postgres_database"));
  assert.ok(!g("mcp__*").test("Bash") && !g("mcp__*").test("Monitor"));
  assert.ok(g("mcp__puppeteer__*").test("mcp__puppeteer__navigate") && !g("mcp__puppeteer__*").test("mcp__playwright__navigate"));
  assert.ok(g("*").test("Bash") && g("*").test("mcp__a__b"));
  // the form this file ships
  assert.ok(g("mcp__*__delete_project").test(`${NEON}delete_project`), "matches a UUID server");
  assert.ok(g("mcp__*__delete_project").test("mcp__plugin_neon_neon__delete_project"), "matches a plugin server");
  assert.ok(!g("mcp__*__delete_project").test("mcp__x__delete_project_extra"), "the whole name must match: no suffix");
  assert.ok(!g("mcp__*__delete_project").test("xmcp__x__delete_project"), "the whole name must match: no prefix");
  assert.ok(!g("mcp__*__delete_project").test("mcp__x__not_delete_project"), "the leaf starts after a double underscore");
  assert.ok(!g("mcp__*__delete_project").test("mcp__delete_project"), "a server segment is required");
  // every other character is literal
  assert.ok(g("mcp__a.b__x").test("mcp__a.b__x") && !g("mcp__a.b__x").test("mcp__aXb__x"));
  assert.ok(g("mcp__*__a-b").test("mcp__s__a-b") && !g("mcp__*__a-b").test("mcp__s__aXb"));
});

// --- 2 - the entries ---------------------------------------------------------------------------------

test("ask entries: a plain list of mcp__*__<leaf> strings, no UUID, no plugin name, no parentheses, no duplicates", () => {
  assert.ok(Array.isArray(settings.permissions?.ask), "settings.json permissions.ask is missing or not a list");
  assert.ok(ask.length >= 100, `expected the protected-tool list (about 135 entries), got ${ask.length}`);
  for (const entry of ask) {
    assert.equal(typeof entry, "string", `ask entry ${JSON.stringify(entry)} is not a string`);
    assert.match(entry, /^mcp__\*__[A-Za-z0-9_-]+$/, `ask entry ${JSON.stringify(entry)} must be mcp__*__<leaf> with no parentheses (Claude Code skips a settings rule for an mcp__ tool that has them)`);
    assert.doesNotMatch(entry, /[0-9a-f]{8}-[0-9a-f]{4}-/i, `ask entry ${entry} pins a connector UUID, which changes on reconnect`);
    assert.doesNotMatch(entry, /plugin/i, `ask entry ${entry} pins a plugin name`);
  }
  assert.equal(new Set(ask).size, ask.length, "duplicate ask entries");
});

test("ask entries are grouped Railway, Neon, Vercel, Prisma and sorted inside each group; a leaf two families share is listed once, in the first group", () => {
  const seen = new Set();
  const expected = [];
  for (const family of GATE_FAMILIES) {
    for (const leaf of [...family].sort()) {
      if (seen.has(leaf)) continue;
      seen.add(leaf);
      expected.push(`mcp__*__${leaf}`);
    }
  }
  assert.deepEqual(ask, expected);
});

test("fixtures are consistent: nothing is both MUST-GATE and MUST-ALLOW or BENIGN, and each family list has no duplicates", () => {
  for (const [name, list] of Object.entries({ RAILWAY_GATE, NEON_GATE, VERCEL_GATE, PRISMA_GATE, RAILWAY_ALLOW, NEON_ALLOW, VERCEL_ALLOW, PRISMA_ALLOW, BENIGN })) {
    assert.ok(list.length >= 10, `${name} looks empty`);
    assert.equal(new Set(list).size, list.length, `${name} has a duplicate`);
  }
  const clash = ALL_GATE.filter((leaf) => ALL_ALLOW.includes(leaf) || BENIGN.includes(leaf));
  assert.deepEqual(clash, [], "a leaf that is protected in one family and allowed in another cannot be expressed by a family-agnostic mcp__*__<leaf> rule");
  assert.deepEqual(GATE_FAMILIES.flat().filter((leaf, i, all) => all.indexOf(leaf) !== i), ["update_project"], "the one leaf Neon and Vercel share");
});

// --- 3 - coverage on every server form ---------------------------------------------------------------

test("every MUST-GATE leaf is asked on every server form, so a reconnect that changes a connector UUID changes nothing", () => {
  // the count is derived from the fixture (not hardcoded): settings.json must ask for exactly the protected leaves, and the README must quote that number
  assert.equal(ask.length, ALL_GATE.length, "settings.json permissions.ask and the protected fixture list differ in length: update both together");
  const readme = readFileSync(join(ROOT, "docs", "agent-os", "README.md"), "utf8");
  assert.ok(readme.includes(`${ALL_GATE.length} entries`) && readme.includes(`prints ${ALL_GATE.length}`), `the README must quote the protected-tool count (${ALL_GATE.length} entries, and the live check's "prints ${ALL_GATE.length}")`);
  assert.deepEqual(unaskedGate(ask), []);
});

test("no MUST-ALLOW read or additive create, and no other connector's tool, is asked on any server form", () => {
  assert.ok(ALL_ALLOW.length >= 150 && BENIGN.length >= 50, "the allow and benign lists are the false-positive proof surface");
  assert.deepEqual(wronglyAsked(ask), []);
});

test("KNOWN_UNCLASSIFIED: live writers and secret reads nobody classified are deliberately NOT asked, and sit in no other list", () => {
  assert.ok(KNOWN_UNCLASSIFIED.length > 0, "the known-unclassified list is the recorded 'not prompted' decision: an empty list means every name was classified, so delete this fixture and its README bullet");
  assert.equal(new Set(KNOWN_UNCLASSIFIED).size, KNOWN_UNCLASSIFIED.length, "KNOWN_UNCLASSIFIED has a duplicate");
  const clash = KNOWN_UNCLASSIFIED.filter((leaf) => ALL_GATE.includes(leaf) || ALL_ALLOW.includes(leaf) || BENIGN.includes(leaf));
  assert.deepEqual(clash, [], "a name is either classified (gate, allow, benign) or known-unclassified, never both: move it, do not copy it");
  assert.deepEqual(askedUnclassified(ask), [], "a known-unclassified tool is prompted: move its leaf to a gate list (and the README) as a conscious edit");
});

test("BREAKS: asking for one known-unclassified leaf, or for everything, is reported by the leaf", () => {
  assert.deepEqual(askedUnclassified(ask), [], "control: the real list asks for none of them");
  for (const leaf of ["create_drain", "get_shared_env_var", "presign_storage_object", "create_sandboxes_v4"]) {
    const reported = askedUnclassified([...ask, `mcp__*__${leaf}`]);
    assert.equal(reported.length, SERVER_FORMS.length, `${leaf}: expected one report per server form, got ${reported.length}`);
    assert.ok(reported.every((name) => name.endsWith(`__${leaf}`)), `${leaf}: the canary named something else: ${reported.join(", ")}`);
  }
  assert.ok(askedUnclassified([...ask, "mcp__*"]).length > 0, "mcp__* would prompt for every unclassified tool and must be reported");
});

test("no permissions.allow entry names an asked tool (rules run deny, then ask, then allow, so it would be dead)", () => {
  for (const rule of settings.permissions.allow ?? []) {
    if (!rule.startsWith("mcp__")) continue;
    assert.deepEqual(asking(ask, rule), [], `${rule} is both allowed and asked`);
  }
});

// --- 4 - the SQL text tools -------------------------------------------------------------------------

test("the SQL text tools are NOT asked per call (the hook judges their text); the two tools that also change schema ARE asked", () => {
  for (const leaf of SQL_TEXT_LEAVES) {
    assert.ok(!ask.includes(`mcp__*__${leaf}`), `${leaf} must not be prompted per call: it is judged by TEXT in pretool.mjs`);
    assert.ok(ALL_ALLOW.includes(leaf), `${leaf} must be a MUST-ALLOW fixture`);
  }
  for (const leaf of ["complete_database_migration", "execute_prisma_postgres_schema_update"]) {
    assert.ok(ask.includes(`mcp__*__${leaf}`), `${leaf} applies a migration: judged by text AND asked`);
  }
});

// --- 5 - BREAKS --------------------------------------------------------------------------------------

test("BREAKS: deleting one entry from a copy is reported by exactly that leaf on every server form; a mistyped entry is reported too", () => {
  assert.deepEqual(unaskedGate(ask), [], "control: the real list covers every leaf");
  for (const leaf of ["delete-service", "set-variables", "delete_project", "complete_database_migration", "run_session_command", "update_project", "delete_prisma_postgres_database"]) {
    const copy = ask.filter((entry) => entry !== `mcp__*__${leaf}`);
    assert.equal(copy.length, ask.length - 1, `${leaf}: the entry was not in the real list`);
    const missing = unaskedGate(copy);
    assert.equal(missing.length, SERVER_FORMS.length, `${leaf}: expected one report per server form, got ${missing.length}`);
    assert.ok(missing.every((name) => name.endsWith(`__${leaf}`)), `${leaf}: the canary named something else: ${missing.join(", ")}`);
  }
  const typo = ask.map((entry) => (entry === "mcp__*__delete_project" ? "mcp__*__delete_projects" : entry));
  assert.ok(unaskedGate(typo).every((name) => name.endsWith("__delete_project")) && unaskedGate(typo).length === SERVER_FORMS.length, "a mistyped entry must be reported by the leaf it should have covered");
  // and the other direction: a too-broad entry is reported as a wrongly asked read
  const broad = [...ask, "mcp__*__list_projects"];
  assert.ok(wronglyAsked(broad).some((name) => name.endsWith("__list_projects")), "an entry that prompts for a read must be reported");
  assert.deepEqual(wronglyAsked([...ask, "mcp__*"]).length > 0, true, "mcp__* would prompt for everything and must be reported");
});
