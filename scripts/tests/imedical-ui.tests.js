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

const semanticBoards = new Map();
function sourceNodes(packageId, boardPrefix = "控件-01") {
    const key = packageId + ":" + boardPrefix;
    if (!semanticBoards.has(key)) {
        const item = sources.packages.find(item => item.id === packageId);
        assert.ok(item, packageId);
        const matches = item.boards.filter(board => board.name.startsWith(boardPrefix));
        assert.equal(matches.length, 1, key);
        const board = parseBoard(fs.readFileSync(inside(vendor, matches[0].data), "utf8")).board;
        const records = [];
        function visit(node, ancestors) {
            records.push({ node, ancestors });
            for (const child of node.children || []) visit(child, [...ancestors, node]);
        }
        visit(board, []);
        semanticBoards.set(key, records);
    }
    return semanticBoards.get(key);
}

function sourceNode(records, guid) {
    const matches = records.filter(record => record.node.guid === guid);
    assert.equal(matches.length, 1, guid);
    return matches[0];
}

// These helpers describe only explicit solid-paint evidence, not a renderer.
// Unknown schema defaults, gradients, masks and compositing need source/runtime review.
function sourceVisibility(record) {
    const chain = [...record.ancestors, record.node];
    if (chain.some(node => node.visible === false || node.opacity === 0)) return "hidden";
    if (chain.some(node => node.visible !== true || !Number.isFinite(node.opacity))) return "unknown";
    return "visible";
}

function sourcePaint(record, kind) {
    const node = record.node;
    if (node[kind + "Enabled"] === false || node[kind] === null ||
        (kind === "stroke" && node.strokeWidth === 0) || sourceVisibility(record) === "hidden") return "off";
    if (sourceVisibility(record) !== "visible" || node[kind + "Enabled"] !== true) return "unknown";
    if (kind === "stroke" && !(node.strokeWidth > 0)) return "unknown";
    if (!node[kind] || !Number.isInteger(node[kind].value)) return "unknown";
    return (node[kind].value >>> 24) === 0 ? "off" : "on";
}

function sourceSolidColor(paint) {
    assert.ok(paint && Number.isInteger(paint.value), "Expected an explicit solid color");
    return "#" + paint.value.toString(16).padStart(8, "0").toUpperCase();
}

function referenceRow(relative, guid, ...facts) {
    const text = fs.readFileSync(path.join(plugin, "references", relative), "utf8");
    const rows = text.split(/\r?\n/).filter(line => line.startsWith("|") && line.includes(guid));
    assert.ok(rows.length, relative + ": missing semantic row for " + guid);
    assert.ok(rows.some(row => facts.every(fact => row.includes(fact))),
        relative + ": " + guid + " must retain one row with " + facts.join(", "));
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

test("source semantics keep ordinary label gaps separate from radio text gaps in both families", () => {
    const cases = [
        { family: "ihos-seablue", form: "e575fdc7-1112-4f57-b524-0e2abbffcceb",
            label: "fc69af54-82da-44dc-814d-db13fe1bc8bf", input: "6db38c4b-9827-45ff-a9f7-da7ce0dd0434",
            radio: "6e6a49d4-43d8-4371-8e57-a43b224c4fff", text: "7073591a-8583-40f2-8f1d-fc36444e42aa",
            glyph: "1487819e-ba53-44cd-ba2e-2f6d3872635b", inputWidth: 200 },
        { family: "pure-controls", form: "9c838ed6-a154-4847-b4ea-3e8fb9add19e",
            label: "d21939e3-617b-4341-85c5-0ee88c64ba0e", input: "473a110b-64ef-423d-8253-32869b8230e0",
            radio: "6c05aa79-16fb-424a-825b-876340e384d7", text: "8fa8eca5-87fa-49e1-8243-cd975b5512f8",
            glyph: "ebbae068-2527-41a5-8901-ff9364a81ca6", inputWidth: 244 }
    ];
    for (const item of cases) {
        const records = sourceNodes(item.family);
        const label = sourceNode(records, item.label), input = sourceNode(records, item.input);
        const text = sourceNode(records, item.text), glyph = sourceNode(records, item.glyph);
        for (const record of [label, input, text, glyph]) assert.equal(sourceVisibility(record), "visible");
        const labelGap = input.node.globalBounds.x - label.node.globalBounds.x - label.node.globalBounds.width;
        const radioGap = text.node.globalBounds.x - glyph.node.globalBounds.x - glyph.node.globalBounds.width;
        assert.equal(labelGap, 10, item.family);
        assert.equal(radioGap, 5, item.family);
        assert.notEqual(labelGap, radioGap, "A radio label is not an ordinary form label");
        assert.equal(input.node.globalBounds.width, item.inputWidth);
        referenceRow("forms-and-actions.md", item.form, labelGap + "px", item.inputWidth + "px");
        referenceRow("forms-and-actions.md", item.radio, radioGap + "px");
    }
});

test("source semantics preserve filled title icons and folder roles across both families", () => {
    const cases = [
        { family: "ihos-seablue", title: "e1307a22-225c-4ff3-8c85-7cfbf82dbdc7",
            folder: "f1d292c5-f534-42ca-b164-9a0c4d768231", leaf: "5989cda0-cea7-4d2e-bd92-d710b3e1ba3a" },
        { family: "pure-controls", title: "7ffe0770-6b5d-4e1b-8305-f6d6e699a8cf",
            folder: "e0326516-5045-4cb4-89b7-f5a86b022085", leaf: "17afd3bb-4efd-47bb-a57c-e18d7f3a4e79" }
    ];
    for (const item of cases) {
        const title = sourceNode(sourceNodes(item.family, "控件-02"), item.title);
        assert.equal(title.node.types.Path, 1);
        assert.ok(title.ancestors.some(node => /标题/.test(node.name)), "The paint belongs to a title component");
        assert.equal(sourcePaint(title, "fill"), "on");
        assert.equal(title.node.stroke, null);
        assert.equal(sourcePaint(title, "stroke"), "off", "Enabled with null paint does not draw a stroke");
        referenceRow("layout-and-navigation.md", item.title, "fillEnabled=true", "stroke=null");
        const records = sourceNodes(item.family, "控件-03");
        const folder = sourceNode(records, item.folder);
        assert.equal(folder.node.name, "文件夹");
        assert.equal(sourceVisibility(folder), "visible");
        assert.deepEqual([folder.node.globalBounds.width, folder.node.globalBounds.height], [16, 16]);
        assert.ok(records.some(record => record.ancestors.includes(folder.node) && sourcePaint(record, "fill") === "on"));
        referenceRow("layout-and-navigation.md", item.folder, "16×16", "文件夹");
        const ordinary = sourceNodes(item.family);
        const leaf = sourceNode(ordinary, item.leaf);
        assert.equal(leaf.node.name, "文档");
        assert.equal(sourceVisibility(leaf), "visible");
        assert.deepEqual([leaf.node.globalBounds.width, leaf.node.globalBounds.height], [16, 16]);
        assert.ok(leaf.ancestors.at(-1).children.some(node => node.text === "四级"));
        const parts = ordinary.filter(record => record.ancestors.includes(leaf.node));
        assert.ok(parts.some(record => record.node.types.Path && sourcePaint(record, "fill") === "on"));
        assert.ok(parts.some(record => record.node.types.Rectangle && record.node.fillEnabled === true &&
            sourcePaint(record, "fill") === "off"), "A transparent placeholder is not the visible document icon");
        referenceRow("layout-and-navigation.md", item.leaf, "文档", "16×16", "有效填充");

    }
});

test("source semantics distinguish disabled panel paints from primary and secondary button variants", () => {
    const cases = [
        { family: "ihos-seablue", panel: "a068f8f8-a516-4a41-988f-28ac5c098b5a",
            primary: "56187cac-ae4c-4c03-9ac8-a7543be0c6ac", secondary: "c1e19006-8736-4498-81a8-8860e7ebb5fd" },
        { family: "pure-controls", panel: "1a5579f9-b35d-44a8-9463-df80bee6f6df",
            primary: "68696a32-54d7-44b9-a76d-4b9c8a1f4553", secondary: "a6b915d0-f48d-4e54-9eb7-3121ef3a03d0" }
    ];
    for (const item of cases) {
        const panel = sourceNode(sourceNodes(item.family, "控件-02"), item.panel);
        assert.equal(panel.node.fill.value, 0xffffffff);
        assert.equal(panel.node.stroke.value, 0xffffffff);
        assert.equal(sourcePaint(panel, "fill"), "off");
        assert.equal(sourcePaint(panel, "stroke"), "off");
        referenceRow("source-catalog.md", item.panel, "fillEnabled=false", "strokeEnabled=false");
        const records = sourceNodes(item.family);
        const primary = sourceNode(records, item.primary), secondary = sourceNode(records, item.secondary);
        assert.equal(sourcePaint(primary, "fill"), "on");
        assert.equal(sourcePaint(primary, "stroke"), "off");
        assert.equal(sourcePaint(secondary, "fill"), "on");
        assert.equal(sourcePaint(secondary, "stroke"), "on");
        referenceRow("forms-and-actions.md", item.primary, "fillEnabled=true", "strokeEnabled=false");
        referenceRow("forms-and-actions.md", item.secondary, "fillEnabled=true", "strokeEnabled=true");
    }
});

test("source semantics distinguish complete table headers from filled separator rectangles", () => {
    const cases = [
        { family: "ihos-seablue", header: "79134d65-8d9e-4f43-8bab-7b0b34a79ba1", height: 34,
            background: "fbc9df8d-e7d7-4206-a04d-0f05f6c850aa", separator: "ab1f7b62-aa1c-4151-a0d5-2b576fe29d43" },
        { family: "pure-controls", header: "1558e4e1-4b16-4c25-8c49-8f6459cfe36d", height: 33,
            background: "b798bace-196d-4beb-a012-82c03dbb7e0f", separator: "08a5d9b8-c994-4478-be8a-5952d6d4dba7" }
    ];
    for (const item of cases) {
        const records = sourceNodes(item.family);
        const header = sourceNode(records, item.header), background = sourceNode(records, item.background);
        const separator = sourceNode(records, item.separator);
        assert.equal(header.node.globalBounds.height, item.height);
        assert.equal(background.node.globalBounds.height, item.height - 1);
        assert.equal(separator.node.globalBounds.height, 1);
        assert.equal(separator.node.globalBounds.y, background.node.globalBounds.y + background.node.globalBounds.height);
        assert.equal(sourcePaint(separator, "fill"), "on");
        assert.equal(sourcePaint(separator, "stroke"), "off");
        referenceRow("tables-and-feedback.md", item.header, item.height + "px", "1px填充矩形", "strokeEnabled=false");
    }
});

test("source semantics reject invisible descendants and transparent paints without inventing schema defaults", () => {
    const placeholder = sourceNode(sourceNodes("ihos-seablue"), "9c75ac00-0568-4f74-89e8-2eb487913a0e");
    assert.equal(placeholder.node.visible, true);
    assert.equal(sourceVisibility(placeholder), "hidden");
    referenceRow("source-catalog.md", placeholder.node.guid, "opacity=0");
    const hidden = sourceNode(sourceNodes("ihos-seablue", "控件-03"), "c428b63a-d5e3-431d-9176-a05dd00605bd");
    assert.equal(hidden.node.visible, true);
    assert.equal(hidden.node.opacity, 1);
    assert.ok(hidden.ancestors.some(node => node.opacity === 0));
    assert.equal(sourceVisibility(hidden), "hidden");
    referenceRow("source-catalog.md", hidden.node.guid, "祖先opacity=0");
    const transparentMask = sourceNode(sourceNodes("ihos-seablue", "控件-03"), "3a016be4-bf06-4fd1-aa2c-4f666908685f");
    assert.equal(transparentMask.node.fillEnabled, true);
    assert.equal(sourcePaint(transparentMask, "fill"), "off", "Alpha zero is not a visible solid fill");
    const solid = { visible: true, opacity: 1, fillEnabled: true, fill: { value: 0xff000000 } };
    assert.equal(sourcePaint({ node: solid, ancestors: [] }, "fill"), "on");
    assert.equal(sourcePaint({ node: solid, ancestors: [{ visible: false, opacity: 1 }] }, "fill"), "off");
    assert.equal(sourcePaint({ node: { ...solid, fillEnabled: undefined }, ancestors: [] }, "fill"), "unknown");
    assert.equal(sourcePaint({ node: { ...solid, visible: undefined }, ancestors: [] }, "fill"), "unknown");
    assert.equal(sourcePaint({ node: { ...solid, opacity: undefined }, ancestors: [] }, "fill"), "unknown");
});

test("source semantics preserve table outer-frame family differences and the PURE white-background variant", () => {
    const cases = [
        { family: "pure-controls", board: "控件-01", guid: "e68477cf-f752-4593-9709-048bd8682ac3",
            enabled: true, color: "#FFFFFFFF", category: "主题差异", evidence: "构件几何" },
        { family: "pure-layouts", board: "布局-02", guid: "b8319d34-f1df-4d4b-92aa-628f22de6809",
            enabled: true, color: "#FFFFFFFF", category: "主题差异", evidence: "组合示例" },
        { family: "ihos-seablue", board: "控件-01", guid: "06410dae-3ff9-4d08-8fdc-0bc4d8b44310",
            enabled: false, color: "#FFFFFFFF", category: "主题差异", evidence: "构件几何" },
        { family: "ihos-seablue", board: "布局-03", guid: "a361aeef-978d-4d7c-9f8c-6be1a249328a",
            enabled: false, color: "#FFFFFFFF", category: "主题差异", evidence: "组合示例" },
        { family: "pure-controls", board: "控件-01", guid: "c53febf8-4a66-481e-8fc4-923679b631ea",
            enabled: true, color: "#FFE4E4E4", category: "构件变体", evidence: "构件几何" }
    ];
    for (const item of cases) {
        const record = sourceNode(sourceNodes(item.family, item.board), item.guid);
        assert.equal(sourceVisibility(record), "visible");
        assert.equal(record.node.fillEnabled, false);
        assert.equal(record.node.strokeEnabled, item.enabled);
        assert.equal(record.node.strokeWidth, 1);
        assert.equal(sourceSolidColor(record.node.stroke), item.color);
        assert.equal(sourcePaint(record, "stroke"), item.enabled ? "on" : "off");
        referenceRow("tables-and-feedback.md", item.guid, "strokeEnabled=" + item.enabled,
            "strokeWidth=1", item.color, item.category, item.evidence);
    }
});

test("source semantics keep ordinary and colored panel paints and radii in their family variants", () => {
    const cases = [
        { family: "pure-controls", guid: "24d63808-e18c-4b42-b218-cf163ece12bf",
            enabled: true, color: "#FFFFFFFF", radius: 6, category: "主题差异" },
        { family: "ihos-seablue", guid: "0772b586-7649-46df-a7f4-9f2fa16cd4b7",
            enabled: false, color: "#FFFFFFFF", radius: 6, category: "主题差异" },
        { family: "pure-controls", guid: "4f243bb7-6cac-4eb6-8889-b01d0436d133",
            enabled: true, color: "#FFF1F7FE", radius: 6, category: "构件变体" },
        { family: "ihos-seablue", guid: "30cdc1d7-eb96-4ed2-8ee6-aec61b840bd9",
            enabled: true, color: "#FFE6EAF9", radius: 0, category: "构件变体" }
    ];
    for (const item of cases) {
        const record = sourceNode(sourceNodes(item.family, "控件-02"), item.guid);
        assert.equal(sourceVisibility(record), "visible");
        assert.equal(record.node.fillEnabled, item.enabled);
        assert.equal(sourceSolidColor(record.node.fill), item.color);
        assert.deepEqual(Object.values(record.node.cornerRadii), Array(4).fill(item.radius));
        assert.equal(sourcePaint(record, "fill"), item.enabled ? "on" : "off");
        assert.equal(sourcePaint(record, "stroke"), "off");
        referenceRow("layout-and-navigation.md", item.guid, "fillEnabled=" + item.enabled,
            item.color, "四角" + item.radius + "px", item.category, "构件几何");
    }
});

test("source semantics keep modal-close buttons distinct from the generic secondary-button scene", () => {
    const cases = [
        { family: "pure-controls", board: "控件-01", guid: "0bd2bf48-579c-4c56-aa27-28520e9a2bdc",
            text: "次要按钮", fill: "#FFEDF6FF", ink: "#FF008FFF", stroke: "#FFA5D5FF", evidence: "构件几何" },
        { family: "pure-layouts", board: "布局-07", guid: "4c6ab7eb-b19c-42e4-bdee-802afe9ae910",
            text: "关闭", fill: "#FFFFFFFF", ink: "#FF000000", stroke: "#FFCCCCCC", evidence: "组合示例" },
        { family: "ihos-seablue", board: "布局-06", guid: "18acb0c6-0be3-48ea-9006-0a682bc6630e",
            text: "关闭", fill: "#FFFFFFFF", ink: "#FF000000", stroke: "#FFCCCCCC", evidence: "组合示例" }
    ];
    for (const item of cases) {
        const records = sourceNodes(item.family, item.board);
        const button = sourceNode(records, item.guid);
        assert.equal(sourceVisibility(button), "visible");
        const descendants = records.filter(record => record.ancestors.includes(button.node));
        const backgrounds = descendants.filter(record => record.node.types.Rectangle && sourcePaint(record, "fill") === "on");
        const labels = descendants.filter(record => record.node.text === item.text && sourceVisibility(record) === "visible");
        assert.equal(backgrounds.length, 1);
        assert.equal(labels.length, 1);
        const background = backgrounds[0], label = labels[0];
        assert.equal(sourceSolidColor(background.node.fill), item.fill);
        assert.equal(sourceSolidColor(background.node.stroke), item.stroke);
        assert.equal(sourcePaint(background, "stroke"), "on");
        assert.equal(background.node.strokeWidth, 1);
        assert.equal(sourceSolidColor(label.node.fill), item.ink);
        for (const range of label.node.styleRanges || []) {
            if (range.fill) assert.equal(sourceSolidColor(range.fill), item.ink);
        }
        referenceRow("forms-and-actions.md", item.guid, "背景" + item.fill,
            "文字" + item.ink, "描边" + item.stroke, "构件变体", item.evidence);
    }
});

test("source semantics record applicability and evidence type independently without promoting demand supplements", () => {
    const text = fs.readFileSync(path.join(plugin, "references/style-differences.md"), "utf8");
    const header = text.split(/\r?\n/).find(line => line.startsWith("| 适用范围＼证据类型 |"));
    assert.ok(header);
    assert.deepEqual(header.split("|").slice(2, -1).map(cell => cell.trim()),
        ["明文要求", "构件几何", "组合示例", "需求补充"]);
    const matrix = text.slice(text.indexOf(header)).split(/\r?\n\s*\r?\n/, 1)[0];
    const rows = matrix.split(/\r?\n/).filter(line => /^\| (共性|主题差异|构件变体|业务特例) \|/.test(line));
    assert.deepEqual(rows.map(row => row.split("|")[1].trim()), ["共性", "主题差异", "构件变体", "业务特例"]);
    for (const row of rows) assert.equal(row.split("|").slice(1, -1).filter(cell => cell.trim()).length, 5);
    const common = rows[0].split("|").slice(1, -1).map(cell => cell.trim());
    assert.match(common[1], /跨风格条款/);
    assert.match(common[2], /两族有效节点/);
    assert.match(common[3], /不固定示例/);
    assert.match(common[4], /不伪造.*升级为公司规则/);
    assert.match(rows[2], /通用次按钮／弹窗关闭按钮/);
    assert.match(rows[3], /不推广成全局默认/);
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
    assert.match(adapter.version, /^0\.3\.\d+$/);
    assert.ok(adapter.dependencies.includes("imedical-ui"));
    assert.ok(adapter.dependencies.includes("coding-iris-plugin"));
    assert.deepEqual(adapter.dependencyVersions["imedical-ui"], { minVersion: "0.1.3", maxVersionExclusive: "0.2.0" });
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

test("development and review routes share one semantic classification reference", () => {
    const anchor = "style-differences.md#按对象语义判断共性";
    for (const relative of ["rules/imedical_ui.md", "skills/imedical-ui/SKILL.md",
        "skills/imedical-ui-review/SKILL.md", "references/review-method.md"]) {
        assert.ok(fs.readFileSync(path.join(plugin, relative), "utf8").includes(anchor), relative);
    }
    const rule = fs.readFileSync(path.join(plugin, "rules/imedical_ui.md"), "utf8");
    assert.match(rule, /公司通用规范，需要两风格证据/);
    assert.match(rule, /不缩小当前业务实现范围/);
    const reference = fs.readFileSync(path.join(plugin, "references/style-differences.md"), "utf8");
    assert.match(reference, /## 按对象语义判断共性/);
    assert.match(reference, /CSS 优先级、组件初始化与动态阶段/);
    assert.match(reference, /统计表分隔线\/隔行底色/);
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
