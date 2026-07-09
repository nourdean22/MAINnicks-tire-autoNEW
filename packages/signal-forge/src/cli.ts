import { createEcommerceTrendDiscoveryExample, generateSignalControlArchitecture } from "./control-forge/index.js";
import { createEnterpriseRagSupportAuditExample, generateNexusAudit } from "./nexus/index.js";
import { renderControlForgeMarkdown, renderNexusMarkdown, validatePromptProductTemplate } from "./shared/index.js";
import * as fs from "node:fs";
import * as path from "node:path";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Usage: signal-forge <command> [options]");
  console.log("Commands: control, nexus, lock");
  process.exit(1);
}

const command = args[0];

function parseArgs(argsList: string[]) {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argsList.length; i++) {
    if (argsList[i].startsWith("--")) {
      const key = argsList[i].slice(2);
      const val = argsList[i + 1] && !argsList[i + 1].startsWith("--") ? argsList[i + 1] : "true";
      parsed[key] = val;
      if (val !== "true") i++;
    }
  }
  return parsed;
}

const options = parseArgs(args.slice(1));

try {
  if (command === "control") {
    if (options.example === "ecommerce-trends") {
      const input = createEcommerceTrendDiscoveryExample();
      const result = generateSignalControlArchitecture(input);
      if (options.out) {
        fs.mkdirSync(path.dirname(options.out), { recursive: true });
        fs.writeFileSync(options.out, renderControlForgeMarkdown(result));
        console.log(`Wrote markdown to ${options.out}`);
      }
      if (options.json) {
        fs.mkdirSync(path.dirname(options.json), { recursive: true });
        fs.writeFileSync(options.json, JSON.stringify(result, null, 2));
        console.log(`Wrote JSON to ${options.json}`);
      }
    } else {
      console.log("Only --example ecommerce-trends is supported in this deterministic mock v1");
    }
  } else if (command === "nexus") {
    if (options.example === "enterprise-rag-support") {
      const input = createEnterpriseRagSupportAuditExample();
      const result = generateNexusAudit(input);
      if (options.out) {
        fs.mkdirSync(path.dirname(options.out), { recursive: true });
        fs.writeFileSync(options.out, renderNexusMarkdown(result));
        console.log(`Wrote markdown to ${options.out}`);
      }
      if (options.json) {
        fs.mkdirSync(path.dirname(options.json), { recursive: true });
        fs.writeFileSync(options.json, JSON.stringify(result, null, 2));
        console.log(`Wrote JSON to ${options.json}`);
      }
    } else {
      console.log("Only --example enterprise-rag-support is supported in this deterministic mock v1");
    }
  } else if (command === "lock") {
    if (options.validate) {
       const template = fs.readFileSync(options.validate, "utf-8");
       const isValid = validatePromptProductTemplate(template);
       console.log(`Template is ${isValid ? "valid" : "invalid"}`);
       process.exit(isValid ? 0 : 1);
    } else {
       console.log("Use --validate <file>");
    }
  } else {
    console.log("Unknown command. Use control, nexus, or lock.");
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
