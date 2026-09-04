#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

function fail(message, code = 2) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = { scopes: [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    const value = tokens[index + 1];
    if (key === "scope") {
      if (!value || value.startsWith("--")) fail("--scope requires a path");
      options.scopes.push(value);
      index += 1;
    } else if (!value || value.startsWith("--")) options[key] = true;
    else { options[key] = value; index += 1; }
  }
  return { command, options };
}

function git(repoRoot, args, encoding = "utf8") {
  const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding, windowsHide: true });
  if (result.status !== 0) fail(`git ${args[0]} failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function sha256(parts) {
  const digest = crypto.createHash("sha256");
  for (const part of parts) digest.update(part);
  return digest.digest("hex");
}

function normalizeScopes(repoRoot, scopes) {
  const values = scopes.length ? scopes : ["."];
  return [...new Set(values.map((value) => {
    const absolute = path.resolve(repoRoot, value);
    const relative = path.relative(repoRoot, absolute).replace(/\\/g, "/") || ".";
    if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) fail(`Scope escapes repository: ${value}`);
    return relative;
  }))].sort();
}

function worktreeFingerprint(repoRoot, scopes) {
  const normalized = normalizeScopes(repoRoot, scopes);
  const pathspec = ["--", ...normalized];
  const head = String(git(repoRoot, ["rev-parse", "HEAD"])).trim();
  const diff = git(repoRoot, ["diff", "--binary", "HEAD", ...pathspec], null);
  const untrackedOutput = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", ...pathspec], null);
  const untracked = untrackedOutput.toString("utf8").split("\0").filter(Boolean).sort();
  const parts = [Buffer.from(`${head}\0${normalized.join("\0")}\0`), diff];
  for (const relative of untracked) {
    const absolute = path.join(repoRoot, relative);
    parts.push(Buffer.from(`${relative}\0`));
    parts.push(fs.readFileSync(absolute));
  }
  return { head, scopes: normalized, fingerprint: sha256(parts) };
}

function defaultEvidenceFile(repoRoot) {
  const key = sha256([Buffer.from(path.resolve(repoRoot).toLowerCase())]).slice(0, 20);
  return path.join(os.tmpdir(), "imedical-agent-validation", `${key}.json`);
}

function readEvidence(file) {
  if (!fs.existsSync(file)) return { schema: "imedical-validation-evidence/v1", repository: null, suites: {} };
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.schema !== "imedical-validation-evidence/v1" || !value.suites) fail(`Invalid evidence file: ${file}`);
  return value;
}

function writeEvidence(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function evidenceLocation(repoRoot, options) {
  return path.resolve(options.evidenceFile || defaultEvidenceFile(repoRoot));
}

function record(repoRoot, options) {
  if (!options.suite) fail("record requires --suite");
  if (!options.command) fail("record requires --command");
  const status = options.status || "passed";
  if (!["passed", "failed"].includes(status)) fail("--status must be passed or failed");
  const current = worktreeFingerprint(repoRoot, options.scopes);
  const file = evidenceLocation(repoRoot, options);
  const evidence = readEvidence(file);
  evidence.repository = path.resolve(repoRoot);
  evidence.suites[options.suite] = {
    suite: options.suite,
    command: options.command,
    status,
    completedAt: new Date().toISOString(),
    ...current
  };
  writeEvidence(file, evidence);
  return { reusable: status === "passed", evidenceFile: file, evidence: evidence.suites[options.suite] };
}

function check(repoRoot, options) {
  if (!options.suite) fail("check requires --suite");
  const file = evidenceLocation(repoRoot, options);
  const saved = readEvidence(file).suites[options.suite];
  if (!saved) return { reusable: false, reason: "missing-evidence", evidenceFile: file, suite: options.suite };
  const current = worktreeFingerprint(repoRoot, saved.scopes || []);
  const reusable = saved.status === "passed" && saved.head === current.head && saved.fingerprint === current.fingerprint;
  return { reusable, reason: reusable ? "fingerprint-match" : "fingerprint-changed", evidenceFile: file, suite: options.suite, saved, current };
}

function usage() {
  return "validation-evidence.js record|check --repo-root <path> --suite <id> [--scope <path> ...] [--command <text>] [--status passed|failed] [--evidence-file <path>] [--json]\n";
}

function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (!command || command === "help" || options.help) { process.stdout.write(usage()); return 0; }
  const repoRoot = path.resolve(options.repoRoot || ".");
  const result = command === "record" ? record(repoRoot, options) : command === "check" ? check(repoRoot, options) : fail(`Unknown command: ${command}`);
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.reusable ? "validation-reusable" : "validation-stale"}: ${result.suite || result.evidence.suite} (${result.reason || "recorded"})\n`);
  return command === "check" && !result.reusable ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = error.exitCode || 1; }
}

module.exports = { check, normalizeScopes, record, worktreeFingerprint };
