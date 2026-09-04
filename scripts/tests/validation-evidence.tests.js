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

  fs.writeFileSync(path.join(temporary, "docs", "note.md"), "out-of-scope\n");
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, true);

  fs.writeFileSync(path.join(temporary, "src", "app.js"), "module.exports = 2;\n");
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, false);

  record(temporary, { suite: "unit", command: "node --test", status: "passed", scopes: ["src"], evidenceFile });
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, true);
  fs.writeFileSync(path.join(temporary, "src", "new.js"), "new file\n");
  assert.equal(check(temporary, { suite: "unit", evidenceFile }).reusable, false);
  assert.throws(() => record(temporary, { suite: "bad", command: "x", scopes: [".."], evidenceFile }), /escapes repository/);
  console.log("validation evidence tests passed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
