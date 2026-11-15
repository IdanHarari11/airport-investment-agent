#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);

const suspiciousContentPatterns = [
  {
    label: "PolinRider marker",
    pattern: /PolinRider/i,
  },
  {
    label: "obfuscated splitLane loader helper",
    pattern: /\bsplitLane\s*\(/,
  },
  {
    label: "obfuscated peel loader helper",
    pattern: /\bpeel\s*\(/,
  },
  {
    label: "loader global require trampoline",
    pattern: /\}\(global,\s*require\);?/,
  },
  {
    label: "known loader constant",
    pattern: /cnotsnturtpicokfzrogmybjdcawvulxsreqh/,
  },
];

const violations = [];

function relative(filePath) {
  return path.relative(ROOT, filePath) || ".";
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        walk(fullPath);
      }
      continue;
    }
    if (entry.isFile()) {
      scanFile(fullPath);
    }
  }
}

function scanFile(filePath) {
  const rel = relative(filePath);
  if (rel === "scripts/check-no-loader.mjs") return;

  const bytes = fs.readFileSync(filePath);
  if (bytes.includes(0)) return;

  const content = bytes.toString("utf8");
  for (const { label, pattern } of suspiciousContentPatterns) {
    if (pattern.test(content)) {
      violations.push(`${rel}: ${label}`);
    }
  }
}

function checkPackageScripts() {
  const packagePath = path.join(ROOT, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const scripts = packageJson.scripts ?? {};
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command === "string" && /\bnode\s+init\b/.test(command)) {
      violations.push(`package.json scripts.${name}: invokes node init`);
    }
  }
}

if (fs.existsSync(path.join(ROOT, "init"))) {
  violations.push("init: legacy loader entrypoint must not exist");
}

checkPackageScripts();
walk(ROOT);

if (violations.length > 0) {
  console.error("Blocked suspicious loader remnants:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("No suspicious loader remnants found.");
