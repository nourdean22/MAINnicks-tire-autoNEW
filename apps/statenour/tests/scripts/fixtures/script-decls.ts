/**
 * Runs named top-level declarations of a CLI script with injected dependencies, without importing the
 * script: importing it would run its top level (loadEnvConfig pulls the production DATABASE_URL into the
 * test process) and spawning it would open real DB and network clients. Edit the script and this runs
 * the edit; a renamed declaration throws and names itself.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";

export function loadDecls(file: string, names: string[], deps: Record<string, unknown>): Record<string, any> {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const declared = (s: ts.Statement): string[] =>
    ts.isFunctionDeclaration(s) && s.name
      ? [s.name.text]
      : ts.isVariableStatement(s)
        ? s.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []))
        : [];
  const picked = sf.statements.filter((s) => declared(s).some((n) => names.includes(n)));
  const missing = names.filter((n) => !picked.some((s) => declared(s).includes(n)));
  if (missing.length) throw new Error(`${file}: declarations not found: ${missing.join(", ")}`);
  const code = picked.map((s) => s.getText(sf).replace(/^export\s+/, "")).join("\n");
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(deps), `${js}\nreturn { ${names.join(", ")} };`)(...Object.values(deps));
}
