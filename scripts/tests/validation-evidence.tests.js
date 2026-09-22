"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { check, record } = require("../validation-evidence.js");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "validation-evidence-test-"));
const evidenceFile = path.join(temporary, "evidence.json");

function git(args) { return execFileSync("git", ["-C", temporary, ...args], { encoding: "utf8", windowsHide: true }); }

try {
  git(["init"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["config", "user.name", "Fixture"]);
  fs.mkdirSync(path.join(temporary, "src"));
  fs.mkdirSync(path.join(temporary, "docs"));
  fs.writeFileSync(path.join(temporary, "src", "app.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(temporary, "docs", "note.md"), "initial\n");
  git(["add", "."]); git(["commit", "-m", "fixture"]);

  record(temporary, { suite: "unit", command: "node --test", status: "passed", scopes: ["src"], evidenceFile });
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, true);
  assert.equal(check(path.join(temporary, "src"), { suite: "unit", evidenceFile }).reason, "repository-mismatch");

  fs.writeFileSync(path.join(temporary, "docs", "note.md"), "out-of-scope\n");
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, true);
  git(["add", "docs"]); git(["commit", "-m", "unrelated HEAD"]);
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, true, "unrelated HEAD must preserve evidence");

  fs.writeFileSync(path.join(temporary, "src", "app.js"), "module.exports = 2;\n");
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, false);

  record(temporary, { suite: "unit", command: "node --test", status: "passed", scopes: ["src"], evidenceFile });
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, true);
  git(["add", "src"]); git(["commit", "-m", "tested content committed"]);
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, true, "committing identical tested bytes preserves evidence");
  fs.writeFileSync(path.join(temporary, "src", "new.js"), "new file\n");
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, false);
  assert.throws(() => record(temporary, { suite: "bad", command: "x", scopes: [".."], evidenceFile }), /escapes repository/);
  fs.writeFileSync(path.join(temporary, ".gitignore"), "private/\n");
  fs.mkdirSync(path.join(temporary, "private"));
  fs.writeFileSync(path.join(temporary, "private", "readback.json"), "before");
  record(temporary, { suite: "readback", command: "readback fixture assertion", scopes: ["private/readback.json"], evidenceFile });
  fs.writeFileSync(path.join(temporary, "private", "readback.json"), "after");
  assert.equal(check(temporary, { suite: "readback", evidenceFile }).reusable, false);
  record(temporary, { suite: "failed", command: "false", status: "failed", scopes: ["src"], evidenceFile });
  assert.equal(check(temporary, { suite: "failed", evidenceFile }).reusable, false);
  console.log("validation evidence tests passed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
