"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, "../..");
const plugin = path.join(repo, "plugins/iris-ui");
const source = fs.readFileSync(path.join(plugin, "scripts/collect-ui-metrics.js"), "utf8");

function fixture(overrides = {}) {
    const style = Object.freeze({ boxSizing: "border-box", paddingTop: "10px", paddingRight: "12px",
        paddingBottom: "10px", paddingLeft: "12px", borderTopWidth: "1px", borderRightWidth: "1px",
        borderBottomWidth: "1px", borderLeftWidth: "1px", marginTop: "0px", marginRight: "0px",
        marginBottom: "0px", marginLeft: "0px", display: "block", position: "static",
        overflowX: "auto", overflowY: "auto", visibility: "visible", opacity: "1" });
    const element = Object.freeze(Object.defineProperties({ clientWidth: 300, clientHeight: 100,
        scrollWidth: 300, scrollHeight: 100, offsetWidth: 302, offsetHeight: 102,
        getBoundingClientRect: () => ({ left: 10, top: 20, width: 302, height: 102 }),
        getClientRects: () => [{}], ...overrides }, Object.fromEntries(
        ["textContent", "innerHTML", "value", "href", "src", "id", "className"].map(key => [key,
            { get() { throw new Error("Sensitive property must not be read: " + key); } }]))));
    const win = Object.freeze({ innerWidth: 1366, innerHeight: 768, devicePixelRatio: 1.25,
        getComputedStyle: target => { assert.equal(target, element); return style; } });
    const doc = Object.freeze({ defaultView: win, querySelectorAll: selector => {
        if (selector === "#invalid[") throw new Error("selector contains private diagnostic data");
        if (selector === ".missing") return [];
        if (selector === ".many") return [element, element];
        if (selector === "#inaccessible") return [null];
        return [element];
    } });
    const context = vm.createContext({ document: doc, window: win, module: { exports: {} } });
    vm.runInContext(source, context);
    const collect = options => JSON.parse(JSON.stringify(context.module.exports(options)));
    collect.realm = context;
    return collect;
}

test("metrics collect only explicit geometry and never business values or selector strings", () => {
    const collect = fixture();
    const result = collect({ targets: [{ name: "content", selector: "#private-patient-selector" }] });
    assert.deepEqual(result.viewport, { width: 1366, height: 768, devicePixelRatio: 1.25 });
    assert.equal(result.targets[0].metrics.rect.x, 10);
    assert.deepEqual(result.targets[0].metrics.client, { width: 300, height: 100 });
    assert.deepEqual(result.targets[0].warnings, []);
    assert.equal(JSON.stringify(result).includes("private-patient-selector"), false);
});

test("missing, ambiguous and malformed selectors are reported without guessing", () => {
    const result = fixture()({ targets: [
        { name: "missing", selector: ".missing" }, { name: "many", selector: ".many" },
        { name: "invalid", selector: "#invalid[" }, { name: "inaccessible", selector: "#inaccessible" }
    ] });
    assert.deepEqual(result.targets.map(target => target.warnings[0]),
        ["target-not-found", "multiple-matches", "invalid-selector", "measurement-unavailable"]);
    assert.ok(result.targets.every(target => target.metrics === null));
    assert.equal(JSON.stringify(result).includes("private diagnostic data"), false);
});

test("overflow, hidden state and invalid numbers remain distinct diagnostic observations", () => {
    const result = fixture({ scrollWidth: 316, scrollHeight: 150, getClientRects: () => [],
        getBoundingClientRect: () => ({ x: NaN, y: 0, width: 0, height: 0 }) })({ targets: [{ name: "panel", selector: "#panel" }] });
    assert.deepEqual(result.targets[0].warnings, ["no-client-rect", "horizontal-overflow", "vertical-overflow"]);
    assert.equal(result.targets[0].metrics.rect.x, null);
});

test("invalid target lists stop before reading any target", () => {
    const collect = fixture();
    for (const options of [null, {}, { targets: [] }, { targets: [{}] },
        { targets: [{ name: "same", selector: "#a" }, { name: "same", selector: "#b" }] }]) {
        assert.throws(() => collect(options), /targets|target|Target/);
    }
    const context = vm.createContext({ module: { exports: {} } });
    vm.runInContext(source, context);
    assert.throws(() => context.module.exports({ targets: [{ name: "x", selector: "#x" }] }), /frame/);
});

test("browser global entry and function source are both callable in the selected frame", () => {
    const context = vm.createContext({ window: {} });
    vm.runInContext(source, context);
    assert.equal(typeof context.window.collectUiMetrics, "function");
    assert.throws(() => context.window.collectUiMetrics({}), /frame/);
    const exported = require(path.join(plugin, "scripts/collect-ui-metrics.js"));
    const selectedFrame = fixture().realm;
    const fromSource = vm.runInContext("(" + exported.toString() + ")", selectedFrame);
    const measured = fromSource({ targets: [{ name: "selected-frame", selector: "#panel" }] });
    assert.equal(measured.targets[0].metrics.client.width, 300);
    assert.equal(measured.targets[0].name, "selected-frame");
    assert.equal(/fetch\(|XMLHttpRequest|setInterval|addEventListener|MutationObserver|ResizeObserver|innerHTML\s*=/.test(source), false);
});

test("plugin discovery and optional UI routing preserve ownership and enabled boundary", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(plugin, ".agents-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.name, "iris-ui");
    assert.deepEqual(manifest.dependencies, ["coding-iris-plugin", "imedical-ui"]);
    assert.deepEqual(manifest.thinIndex.excludeSkills, ["iris-ui-init"]);
    for (const entry of [manifest.entry, "skills/iris-ui/SKILL.md", "skills/iris-ui-init/SKILL.md", "rules/iris_ui.md"]) {
        assert.ok(fs.existsSync(path.join(plugin, entry)), entry);
    }
    const frontend = fs.readFileSync(path.join(repo, "plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md"), "utf8");
    assert.match(frontend, /iris-ui/);
    assert.match(frontend, /enabled/);
    const coding = JSON.parse(fs.readFileSync(path.join(repo, "plugins/coding-iris-plugin/.agents-plugin/plugin.json"), "utf8"));
    assert.equal((coding.dependencies || []).includes("iris-ui"), false);
});

for (const shell of (process.platform === "win32" ? ["pwsh.exe", "powershell.exe"] : [])) {
    test(`thin-index preview, repeat and custom protection with source mapping (${shell})`, () => {
        let tempParent = process.env.IRIS_UI_TEST_TMP || (process.platform === "win32" ? "D:/tmp/Codex" : require("node:os").tmpdir());
        let root;
        try {
            fs.mkdirSync(tempParent, { recursive: true });
            root = fs.mkdtempSync(path.join(tempParent, "iris-ui-test-"));
        } catch (error) {
            if (process.env.IRIS_UI_TEST_TMP) throw error;
            tempParent = path.join(require("node:os").tmpdir(), "Codex");
            fs.mkdirSync(tempParent, { recursive: true });
            root = fs.mkdtempSync(path.join(tempParent, "iris-ui-test-"));
        }
        const context = path.join(root, ".agents");
        const wrapper = path.join(plugin, "scripts/generate-plugin-thin-index.ps1");
        const run = mode => spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper,
            "-PluginPath", plugin, "-ProjectRoot", root, "-ContextRoot", context, "-CapabilityRoot", repo,
            "-Mode", mode], { encoding: "utf8", timeout: 30000, windowsHide: true });
        try {
            assert.equal(run("DryRun").status, 0);
            assert.equal(fs.existsSync(context), false);
            const first = run("Write");
            assert.equal(first.status, 0, first.stderr || first.stdout);
            const skill = path.join(context, "skills/iris-ui/SKILL.md");
            const rule = path.join(context, "rules/iris_ui.md");
            assert.equal(fs.existsSync(path.join(context, "skills/iris-ui-init")), false);
            const before = [skill, rule].map(file => fs.readFileSync(file, "utf8"));
            for (const text of before) {
                assert.match(text, /thin-index: true/);
                const target = /^source: (.+)$/m.exec(text)[1].trim().replace(/^\.agents\//, "");
                assert.ok(fs.existsSync(path.resolve(repo, target)), target);
            }
            assert.equal(run("Write").status, 0);
            assert.deepEqual([skill, rule].map(file => fs.readFileSync(file, "utf8")), before);
            const custom = "# Project custom rule\nPreserve this text.\n";
            fs.writeFileSync(rule, custom);
            const conflict = run("Write");
            assert.equal(fs.readFileSync(rule, "utf8"), custom);
            assert.ok(conflict.status !== 0 || /preserv|conflict|skip|custom/i.test(conflict.stdout));
        } finally {
            assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(), fs.realpathSync(tempParent).toLowerCase());
            assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
            fs.rmSync(root, { recursive: true, force: true });
            assert.equal(fs.existsSync(root), false);
        }
    });
}
