#!/usr/bin/env node
/**
 * Fails CI if known malware-loader patterns appear in the repo root.
 * Defensive inventory only — does not execute or print suspicious payloads.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

const apiJs = join(root, "api.js");
if (existsSync(apiJs)) {
  failures.push("Forbidden root file present: api.js");
}

const packageJsonPath = join(root, "package.json");
if (existsSync(packageJsonPath)) {
  const pkg = readFileSync(packageJsonPath, "utf8");
  if (/node\s+api\.js/.test(pkg)) {
    failures.push('package.json scripts must not invoke "node api.js"');
  }
}

const postcssPath = join(root, "postcss.config.mjs");
if (existsSync(postcssPath)) {
  const size = statSync(postcssPath).size;
  const text = readFileSync(postcssPath, "utf8");
  const MAX_BYTES = 500;
  if (size > MAX_BYTES) {
    failures.push(
      `postcss.config.mjs is oversized (${size} bytes > ${MAX_BYTES})`,
    );
  }
  if (/createRequire/.test(text)) {
    failures.push("postcss.config.mjs must not use createRequire");
  }
  if (/atob|eval\s*\(|Function\s*\(/.test(text)) {
    failures.push("postcss.config.mjs contains opaque runtime eval patterns");
  }
  if (/Buffer\.from\s*\(\s*['"`][A-Za-z0-9+/=]{80,}/.test(text)) {
    failures.push("postcss.config.mjs contains opaque base64 trailer");
  }
}

const fakeFonts = ["fa-solid-700.otf", "fa-solid-600.eot"];
for (const name of fakeFonts) {
  if (
    existsSync(join(root, name)) ||
    existsSync(join(root, "public", name)) ||
    existsSync(join(root, "public", "fonts", name))
  ) {
    failures.push(`Forbidden fake-font artifact present: ${name}`);
  }
}

const tasksPath = join(root, ".vscode", "tasks.json");
if (existsSync(tasksPath)) {
  const tasks = readFileSync(tasksPath, "utf8");
  if (/node\s+api\.js|["'`]api\.js["'`]|fa-solid-700/.test(tasks)) {
    failures.push(".vscode/tasks.json must not autorun malware loaders");
  }
}

const settingsPath = join(root, ".vscode", "settings.json");
if (existsSync(settingsPath)) {
  const settings = readFileSync(settingsPath, "utf8");
  if (/"task\.allowAutomaticTasks"\s*:\s*"?true"?/.test(settings)) {
    failures.push('.vscode/settings.json must not enable automatic tasks');
  }
}

if (existsSync(join(root, "branch_structure.json"))) {
  failures.push("Forbidden file present: branch_structure.json");
}

if (failures.length > 0) {
  console.error("security-guard: blocked suspicious patterns:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("security-guard: ok");
