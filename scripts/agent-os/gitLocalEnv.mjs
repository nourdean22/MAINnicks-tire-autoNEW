import { existsSync } from "node:fs";

// Git exports repository-local variables to hooks. Child git commands inherit
// them unless the hook clears them, which can make a temp fixture operate on the
// caller's real repository instead of its own cwd.
export const GIT_LOCAL_ENV_KEYS = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
]);

export function stripGitLocalEnv(source = process.env) {
  const clean = { ...source };
  for (const key of GIT_LOCAL_ENV_KEYS) delete clean[key];
  return clean;
}

export function prepareAgentChildEnv(
  source = process.env,
  {
    platform = process.platform,
    gitBashDir = "C:\\Program Files\\Git\\bin",
    exists = existsSync,
  } = {},
) {
  const clean = stripGitLocalEnv(source);
  if (platform !== "win32") return clean;

  const bashExe = `${gitBashDir}\\bash.exe`;
  if (!exists(bashExe)) return clean;

  const pathKey =
    Object.keys(clean).find((key) => key.toLowerCase() === "path") ?? "Path";
  const parts = String(clean[pathKey] ?? "")
    .split(";")
    .filter(Boolean)
    .filter((entry) => entry.toLowerCase() !== gitBashDir.toLowerCase());
  clean[pathKey] = [gitBashDir, ...parts].join(";");
  return clean;
}
