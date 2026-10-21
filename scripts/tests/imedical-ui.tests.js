"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "../..");
const plugin = path.join(repo, "plugins/imedical-ui");
const vendor = path.join(repo, "vendor/imedical-ui-standards");
const jsonFile = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sources = jsonFile(path.join(vendor, "source-manifest.json"));

function inside(root, relative) {
    assert.equal(path.isAbsolute(relative), false, relative);
    const file = path.resolve(root, relative);
    assert.ok(file.startsWith(path.resolve(root) + path.sep), relative);
    return file;
}

// Parse only JSON arguments; the exported design JavaScript is never executed.
function jsonValue(text, start) {
    let index = start;
    while (/\s/.test(text[index] || "") && index < text.length) index++;
    if (text.slice(index, index + 4) === "null") return { value: null, end: index + 4 };
    assert.equal(text[index], "{", "Expected a JSON object or null");
    const begin = index;
    let depth = 0, quoted = false, escaped = false;
    for (; index < text.length; index++) {
        const character = text[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === "{" || character === "[") depth++;
        else if (character === "}" || character === "]") {
            if (--depth === 0) return { value: JSON.parse(text.slice(begin, index + 1)), end: index + 1 };
        }
    }
    throw new Error("Unterminated JSON argument");
}

function parseBoard(text) {
    const prefix = /^\s*marklion_artboard\(/.exec(text);
    assert.ok(prefix, "Expected the MarkLion artboard wrapper");
    const aliases = jsonValue(text, prefix[0].length);
    assert.ok(aliases.value === null || (typeof aliases.value === "object" && !Array.isArray(aliases.value)));
    const second = /^\s*,\s*document\.currentScript\s*,/.exec(text.slice(aliases.end));
    assert.ok(second, "Expected the literal document.currentScript argument");
    const board = jsonValue(text, aliases.end + second[0].length);
    assert.ok(board.value && typeof board.value === "object");
    assert.match(text.slice(board.end), /^\s*\);?\s*$/, "Unexpected code after the JSON board");
    return { aliases: aliases.value, board: board.value };
}

function parsePackage(text) {
    const prefix = /^\s*var\s+__marklionData\s*=\s*/.exec(text);
    assert.ok(prefix, "Expected the MarkLion package assignment");
    const result = jsonValue(text, prefix[0].length);
    assert.match(text.slice(result.end), /^\s*;?\s*$/);
    return result.value;
}

function collectGuids(value, output = new Set()) {
    if (!value || typeof value !== "object") return output;
    if (typeof value.guid === "string") output.add(value.guid.toLowerCase());
    for (const child of Object.values(value)) collectGuids(child, output);
    return output;
}

function filesBelow(root) {
    const output = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        assert.equal(fs.lstatSync(file).isSymbolicLink(), false, file);
        if (entry.isDirectory()) output.push(...filesBelow(file));
        else if (entry.isFile()) output.push(file);
    }
    return output;
}

function markdownTargets(text) {
    const output = [];
    let index = 0;
    while ((index = text.indexOf("](", index)) !== -1) {
        index += 2;
        const start = index;
        if (text[index] === "<") {
            const end = text.indexOf(">", index + 1);
            assert.ok(end !== -1, "Unclosed Markdown destination");
            output.push(text.slice(index + 1, end));
            index = end + 1;
        } else {
            let depth = 1;
            for (; index < text.length; index++) {
                if (text[index] === "\\") { index++; continue; }
                if (text[index] === "(") depth++;
                if (text[index] === ")" && --depth === 0) break;
            }
            assert.ok(depth === 0, "Unclosed Markdown destination");
            output.push(text.slice(start, index).replace(/\\([()])/g, "$1"));
        }
    }
    return output;
}

function localTargets(file, text) {
    try {
        return markdownTargets(text).filter(target => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target))
            .map(target => path.resolve(path.dirname(file), decodeURIComponent(target.split("#")[0])));
    } catch (error) {
        throw new Error(`${path.relative(repo, file)}: ${error.message}`, { cause: error });
    }
}

let sourceGuids;
function guidsBySource() {
    if (!sourceGuids) {
        sourceGuids = new Map();
        for (const item of sources.packages) {
            const index = path.join(vendor, item.id, "res/data.js");
            sourceGuids.set(index, collectGuids(parsePackage(fs.readFileSync(index, "utf8"))));
            for (const board of item.boards) {
                const file = inside(vendor, board.data);
                sourceGuids.set(file, collectGuids(parseBoard(fs.readFileSync(file, "utf8")).board));
            }
        }
    }
    return sourceGuids;
}

test("the captured source inventory is complete and every source byte matches its SHA-256", () => {
    assert.equal(sources.schema, "imedical-ui-sources/v1");
    assert.deepEqual(sources.packages.map(item => [item.id, item.boards.length]),
        [["ihos-seablue", 13], ["pure-controls", 3], ["pure-layouts", 14]]);
    assert.equal(sources.files.length, 64);
    const declared = new Set();
    for (const item of sources.files) {
        assert.equal(declared.has(item.path), false, item.path);
        declared.add(item.path);
        const file = inside(vendor, item.path);
        assert.equal(fs.lstatSync(file).isFile(), true, item.path);
        const data = fs.readFileSync(file);
        assert.equal(data.length, item.bytes, item.path);
        assert.equal(crypto.createHash("sha256").update(data).digest("hex"), item.sha256, item.path);
    }
    const actual = [sources.document.path];
    for (const item of sources.packages) {
        actual.push(...filesBelow(path.join(vendor, item.id)).map(file => path.relative(vendor, file).split(path.sep).join("/")));
    }
    assert.deepEqual(actual.sort(), [...declared].sort(), "New snapshot files must join the manifest");
    assert.equal(sources.document.pages, 54);
    assert.equal(fs.readFileSync(inside(vendor, sources.document.path)).subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual(sources.reviewTargets.map(item => [item.family, item.palette]),
        [["ihos", "seablue"], ["pure", "skyblue"]]);
});

test("MarkLion metadata, board geometry and PNG dimensions agree without evaluating JavaScript", () => {
    const aliasKinds = new Set();
    const boardKeys = new Set();
    let scaledPreviews = 0;
    for (const item of sources.packages) {
        const index = parsePackage(fs.readFileSync(path.join(vendor, item.id, "res/data.js"), "utf8"));
        assert.equal(index.guid, item.projectGuid, item.id);
        assert.equal(index.name, item.internalTitle, item.id);
        assert.equal(index.config.artScale, item.artScale, item.id);
        assert.equal(index.artboards.length, item.boards.length, item.id);
        for (const expected of item.boards) {
            const key = `${item.id}:${expected.guid}`;
            assert.equal(boardKeys.has(key), false, key);
            boardKeys.add(key);
            const entry = index.artboards.find(board => board.guid === expected.guid);
            assert.ok(entry, key);
            assert.equal(entry.name, expected.name, key);
            assert.equal(entry.artboardPath, expected.path, key);
            assert.deepEqual(entry.globalBounds, expected.globalBounds, key);
            const { aliases, board } = parseBoard(fs.readFileSync(inside(vendor, expected.data), "utf8"));
            aliasKinds.add(aliases === null ? "null" : "object");
            assert.equal(board.guid, expected.guid, key);
            assert.equal(board.artboardPath, expected.path, key);
            assert.equal(board.width, expected.width, key);
            assert.equal(board.height, expected.height, key);
            assert.equal(board.mlOutputTime, expected.exportedAt, key);
            const png = fs.readFileSync(inside(vendor, expected.preview));
            assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), key);
            assert.equal(png.subarray(12, 16).toString(), "IHDR", key);
            assert.equal(png.readUInt32BE(16), expected.previewWidth, key);
            assert.equal(png.readUInt32BE(20), expected.previewHeight, key);
            if (expected.previewWidth !== board.width || expected.previewHeight !== board.height) scaledPreviews++;
        }
    }
    assert.deepEqual([...aliasKinds].sort(), ["null", "object"]);
    assert.equal(boardKeys.size, 30);
    assert.ok(scaledPreviews > 0, "Preview pixels and artboard design units are different evidence");
});

test("the JSON-only reader rejects executable arguments and trailing code", () => {
    for (const aliases of ["null", '{"a.svg":"b.svg"}']) {
        const result = parseBoard(`marklion_artboard(${aliases},document.currentScript,{"guid":"sample","text":"braces } [ and \\"quoted\\""});`);
        assert.equal(result.board.guid, "sample");
    }
    for (const input of [
        'marklion_artboard(globalThis.privateValue,document.currentScript,{"guid":"x"});',
        'marklion_artboard(null,document.currentScript,{"guid":"x"});globalThis.modified=true;',
        'marklion_artboard(null,callPrivateCode(),{"guid":"x"});',
        'marklion_artboard(null,document.currentScript,{"guid":"x",});'
    ]) assert.throws(() => parseBoard(input));
});

test("shared board GUIDs remain separate sources in different design families", () => {
    const guid = "2a94f2f9-0201-4d10-849c-c47bb6cb7351";
    const ihos = sources.packages.find(item => item.id === "ihos-seablue").boards.find(board => board.guid === guid);
    const pure = sources.packages.find(item => item.id === "pure-controls").boards.find(board => board.guid === guid);
    assert.ok(ihos && pure);
    assert.notEqual(ihos.data, pure.data);
    assert.notEqual(ihos.height, pure.height);
    assert.equal(guidsBySource().get(inside(vendor, ihos.data)).has(guid), true);
    assert.equal(guidsBySource().get(inside(vendor, pure.data)).has(guid), true);
});

test("plugin Markdown links resolve and GUID citations belong to their linked design sources", () => {
    const records = guidsBySource();
    let citations = 0;
    const guidPattern = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;
    for (const file of filesBelow(plugin).filter(file => file.endsWith(".md"))) {
        const text = fs.readFileSync(file, "utf8");
        const targets = localTargets(file, text);
        for (const target of targets) assert.ok(fs.existsSync(target), `${path.relative(repo, file)} -> ${target}`);
        const linkedSources = targets.filter(target => records.has(target));
        for (const line of text.split(/\r?\n/)) {
            const guids = [...line.matchAll(guidPattern)].map(match => match[0].toLowerCase());
            if (!guids.length) continue;
            const lineSources = localTargets(file, line).filter(target => records.has(target));
            const candidates = lineSources.length ? lineSources : linkedSources;
            for (const guid of guids) {
                assert.ok(candidates.some(target => records.get(target).has(guid)),
                    `${path.relative(repo, file)}: ${guid} must exist in a linked source, not a global GUID union`);
                citations++;
            }
        }
    }
    assert.ok(citations >= 40, "Check the actual standards references, not only plugin navigation links");
});

test("company standards stay stack independent and the IRIS adapter declares its strong dependency", () => {
    const company = jsonFile(path.join(plugin, ".agents-plugin/plugin.json"));
    assert.equal(company.name, "imedical-ui");
    assert.deepEqual(company.dependencies, []);
    assert.deepEqual(company.requiresProjectFiles, ["AGENTS.md"]);
    assert.deepEqual(company.thinIndex.excludeSkills, ["imedical-ui-init"]);
    for (const entry of [company.entry, "skills/imedical-ui/SKILL.md", "skills/imedical-ui-review/SKILL.md",
        "skills/imedical-ui-init/SKILL.md", "rules/imedical_ui.md"]) assert.ok(fs.existsSync(path.join(plugin, entry)), entry);
    const adapter = jsonFile(path.join(repo, "plugins/iris-ui/.agents-plugin/plugin.json"));
    assert.equal(adapter.version, "0.2.0");
    assert.ok(adapter.dependencies.includes("imedical-ui"));
    assert.ok(adapter.dependencies.includes("coding-iris-plugin"));
    assert.deepEqual(adapter.dependencyVersions["imedical-ui"], { minVersion: "0.1.0", maxVersionExclusive: "0.2.0" });
    const manifests = new Map(fs.readdirSync(path.join(repo, "plugins")).map(name => {
        const file = path.join(repo, "plugins", name, ".agents-plugin/plugin.json");
        return fs.existsSync(file) ? jsonFile(file) : null;
    }).filter(Boolean).map(item => [item.name, item]));
    const active = new Set(), complete = new Set();
    function visit(name) {
        assert.equal(active.has(name), false, `Strong dependency cycle through ${name}`);
        if (complete.has(name)) return;
        assert.ok(manifests.has(name), `Missing strong dependency ${name}`);
        active.add(name);
        for (const dependency of manifests.get(name).dependencies || []) visit(dependency);
        active.delete(name);
        complete.add(name);
    }
    for (const name of manifests.keys()) visit(name);
});

function tempFixture(t) {
    let parent = process.env.IMEDICAL_UI_TEST_TMP || (process.platform === "win32" ? "D:/tmp/Codex" : os.tmpdir());
    let root;
    try {
        fs.mkdirSync(parent, { recursive: true });
        root = fs.mkdtempSync(path.join(parent, "imedical-ui-tests-"));
    } catch (error) {
        if (process.env.IMEDICAL_UI_TEST_TMP) throw error;
        parent = path.join(os.tmpdir(), "Codex");
        fs.mkdirSync(parent, { recursive: true });
        root = fs.mkdtempSync(path.join(parent, "imedical-ui-tests-"));
        t.diagnostic(`Preferred temporary directory unavailable; using ${root}`);
    }
    t.after(() => {
        assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
        assert.equal(fs.realpathSync(path.dirname(root)).toLowerCase(), fs.realpathSync(parent).toLowerCase());
        fs.rmSync(root, { recursive: true, force: true });
        assert.equal(fs.existsSync(root), false, root);
    });
    return root;
}

function powershell(shell, script, args) {
    const env = { ...process.env };
    if (/powershell(?:\.exe)?$/i.test(shell)) {
        for (const key of Object.keys(env)) if (key.toLowerCase() === "psmodulepath") delete env[key];
    }
    const result = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
        { encoding: "utf8", windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024, env });
    assert.equal(result.error, undefined, result.error && result.error.message);
    return result;
}

function write(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

function seedUpdaterFixture(root, includeCompany) {
    const capability = path.join(root, ".agents");
    fs.mkdirSync(path.join(capability, "scripts"), { recursive: true });
    // Use the official runtime and small plugin inputs; the 61 MB design vendor is not copied.
    for (const name of fs.readdirSync(path.join(repo, "scripts"))) {
        if (/\.(?:ps1|js)$/.test(name)) fs.copyFileSync(path.join(repo, "scripts", name), path.join(capability, "scripts", name));
    }
    for (const relative of ["scripts/lib", "agents", "workflows", "hooks", "plugins/iris-ui"]) {
        fs.cpSync(path.join(repo, relative), path.join(capability, relative), { recursive: true });
    }
    if (includeCompany) fs.cpSync(plugin, path.join(capability, "plugins/imedical-ui"), { recursive: true });
    const coding = "plugins/coding-iris-plugin/.agents-plugin/plugin.json";
    write(path.join(capability, coding), fs.readFileSync(path.join(repo, coding)));
    write(path.join(capability, "docs/README.md"), "# Isolated updater documentation\n");
    write(path.join(capability, ".gitignore"), "/config/\n/skills/\n/rules/\n/memory/\n/work/\n");
    write(path.join(root, "AGENTS.md"), "# Isolated UI dependency test\n");
    write(path.join(capability, "config/iris_project_profile.md"), "# Isolated frontend profile\n");
    const git = args => {
        const result = spawnSync("git", ["-C", capability, ...args],
            { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
        assert.equal(result.status, 0, result.stderr || result.stdout);
    };
    git(["init", "-q"]);
    git(["config", "user.name", "UI Fixture"]);
    git(["config", "user.email", "ui-fixture@example.invalid"]);
    git(["config", "core.autocrlf", "false"]);
    git(["config", "core.hooksPath", path.join(root, "fixture-hooks")]);
    fs.mkdirSync(path.join(root, "fixture-hooks"));
    git(["add", "."]);
    git(["commit", "-qm", "test: isolated UI dependency baseline"]);
    return capability;
}

for (const shell of (process.platform === "win32" ? ["pwsh.exe", "powershell.exe"] : ["pwsh"])) {
    test(`company UI thin-index generates two daily skills and one rule, excluding init (${shell})`, t => {
        const probe = spawnSync(shell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
            { encoding: "utf8", windowsHide: true, timeout: 10000 });
        if (probe.error && probe.error.code === "ENOENT") { t.skip(`${shell} is unavailable`); return; }
        assert.equal(probe.status, 0, probe.stderr);
        t.diagnostic(`${shell}: ${probe.stdout.trim()}`);
        const root = tempFixture(t);
        const context = path.join(root, ".agents");
        const wrapper = path.join(plugin, "scripts/generate-plugin-thin-index.ps1");
        const run = mode => powershell(shell, wrapper, ["-PluginPath", plugin, "-ProjectRoot", root,
            "-ContextRoot", context, "-CapabilityRoot", repo, "-Mode", mode]);
        const preview = run("DryRun");
        assert.equal(preview.status, 0, preview.stderr || preview.stdout);
        assert.equal(fs.existsSync(context), false, "Preview must not create the project context");
        const generated = run("Write");
        assert.equal(generated.status, 0, generated.stderr || generated.stdout);
        const skillNames = fs.readdirSync(path.join(context, "skills")).sort();
        const ruleNames = fs.readdirSync(path.join(context, "rules")).sort();
        assert.deepEqual(skillNames, ["imedical-ui", "imedical-ui-review"]);
        assert.deepEqual(ruleNames, ["imedical_ui.md"]);
        const targets = [...skillNames.map(name => path.join(context, "skills", name, "SKILL.md")),
            path.join(context, "rules/imedical_ui.md")];
        const initial = targets.map(file => fs.readFileSync(file, "utf8"));
        for (const text of initial) {
            assert.match(text, /thin-index: true/);
            const source = /^source:\s*(.+)$/m.exec(text);
            assert.ok(source, "Generated source mapping is required");
            const target = source[1].trim().replace(/^\.agents\//, "");
            assert.ok(fs.existsSync(path.resolve(repo, target)), target);
        }
        assert.equal(fs.existsSync(path.join(context, "skills/imedical-ui-init")), false);
        const repeated = run("Write");
        assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
        assert.deepEqual(targets.map(file => fs.readFileSync(file, "utf8")), initial);
    });
}

test("official updater blocks missing, available and disabled UI dependencies before generating IRIS routes", t => {
    const shell = process.platform === "win32" ? "pwsh.exe" : "pwsh";
    const probe = spawnSync(shell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
        { encoding: "utf8", windowsHide: true, timeout: 10000 });
    if (probe.error && probe.error.code === "ENOENT") { t.skip(`${shell} is unavailable`); return; }
    assert.equal(probe.status, 0, probe.stderr);
    const outer = tempFixture(t);
    for (const state of ["missing", "available", "disabled", "enabled"]) {
        const root = path.join(outer, state);
        const capability = seedUpdaterFixture(root, state !== "missing");
        const rows = ["| plugin | status | initSkill | dependsOn | notes |", "|---|---|---|---|---|",
            "| coding-iris-plugin | enabled | coding-iris-init | - | fixture |",
            "| iris-ui | enabled | iris-ui-init | coding-iris-plugin, imedical-ui | fixture |"];
        if (state !== "missing") rows.push(`| imedical-ui | ${state} | imedical-ui-init | - | explicit fixture state |`);
        const profile = path.join(capability, "config/plugin_profile.md");
        write(profile, rows.join("\n") + "\n");
        const result = powershell(shell, path.join(capability, "scripts/update-agents.ps1"),
            ["-ProjectRoot", root, "-Mode", "Write", "-NoPull", "-Detailed", "-Plugin", "iris-ui"]);
        const skill = path.join(capability, "skills/iris-ui/SKILL.md");
        const rule = path.join(capability, "rules/iris_ui.md");
        const output = result.stdout + "\n" + result.stderr;
        if (state !== "enabled") {
            assert.match(output, /plugin-dependency-missing/, `${state}: ${output}`);
            assert.equal(fs.existsSync(skill), false, `${state}: IRIS skill must not be generated`);
            assert.equal(fs.existsSync(rule), false, `${state}: IRIS rule must not be generated`);
            if (state !== "missing") assert.match(fs.readFileSync(profile, "utf8"),
                new RegExp(`imedical-ui\\s*\\|\\s*${state}`), "Explicit dependency state must remain intact");
        } else {
            assert.equal(result.status, 0, output);
            for (const file of [skill, rule]) {
                assert.equal(fs.existsSync(file), true, `Enabled dependencies must generate ${file}\n${output}`);
                const text = fs.readFileSync(file, "utf8");
                assert.match(text, /thin-index: true/);
                assert.match(text, /source: \.agents\/plugins\/iris-ui\//);
                const mapped = /^source:\s*(.+)$/m.exec(text)[1].trim().replace(/^\.agents\//, "");
                assert.ok(fs.existsSync(path.resolve(capability, mapped)), mapped);
            }
        }
        t.diagnostic(`Official updater dependency state: ${state}; IRIS route generated: ${fs.existsSync(skill)}`);
    }
});
