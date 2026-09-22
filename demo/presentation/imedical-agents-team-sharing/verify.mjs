import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const visibleText = html
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&gt;/g, ">")
  .replace(/&lt;/g, "<")
  .replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ");
const searchableText = html.replace(/&amp;/g, "&");
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function count(pattern) {
  return [...html.matchAll(pattern)].length;
}

const slideIds = [...html.matchAll(/<section\s+class="[^"]*\bslide\b[^"]*"\s+id="(slide-\d{2})"/g)].map((match) => match[1]);
const speakerNotes = count(/<aside class="speaker-note">/g);
const copyTargets = [...html.matchAll(/data-copy="([^"]+)"/g)].map((match) => match[1]);
const elementIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

assert(slideIds.length === 21, `expected 21 slides, found ${slideIds.length}`);
assert(new Set(slideIds).size === slideIds.length, "slide ids must be unique");
assert(slideIds.every((id, index) => id === `slide-${String(index + 1).padStart(2, "0")}`), "slide ids must be sequential from slide-01 to slide-21");
assert(speakerNotes === slideIds.length, `expected one speaker note per slide, found ${speakerNotes}`);

for (const text of [
  "AI Coding 外骨骼架构",
  "Plugin 与 Thin-Index",
  "Agent、Workflow、Skill 与 Rule",
  "Workspace Overlay",
  "13 个插件",
  "47 个插件 Skill",
  "15 个受治理组件",
  "i18n Agent + Workflow",
  "完整联网安装",
  "Codex 只读执行 i18n retrospective",
  "完整演示命令",
  "故障切换",
  "术语与来源",
  "Plugin · 插件包",
  "唯一维护的真实能力源",
  "指向真实能力的浅层索引",
  "多模块共享能力",
  "retrospective（只读复盘）",
  "Independent Verifier（独立验证者）",
  "代码关系图谱",
  "Manifest",
]) {
  assert(searchableText.includes(text) || visibleText.includes(text), `missing required content: ${text}`);
}

for (const [stalePattern, label] of [
  [/(^|[^0-9])3 个插件/, "3 个插件"],
  [/8\+ Skill/, "8+ Skill"],
  [/multi-agent 尚未实现/, "multi-agent 尚未实现"],
  [/当前只有单 Agent/, "当前只有单 Agent"],
  [/(^|[^-])manifest\.json/, "manifest.json"],
  [/stable \/ beta \/ draft/, "stable / beta / draft"],
]) {
  assert(!stalePattern.test(visibleText), `stale wording must not appear: ${label}`);
}

for (const hook of [
  "ArrowRight",
  "PageDown",
  "Home",
  "End",
  "hashchange",
  "touchstart",
  "touchend",
  "requestFullscreen",
  "navigator.clipboard",
  "overviewBtn",
  "notesBtn",
]) {
  assert(html.includes(hook), `missing interaction hook: ${hook}`);
}

for (const target of copyTargets) {
  assert(elementIds.has(target), `copy target does not exist: ${target}`);
}

assert(copyTargets.length >= 4, `expected at least 4 copy actions, found ${copyTargets.length}`);
assert(count(/class="term-note"/g) >= 15, "expected concise Chinese annotations for abstract terms");
assert(count(/class="glossary-item"/g) === 8, "expected 8 glossary entries");
assert(!html.includes("cover-dark"), "full-slide dark color variant must not diverge from the light deck theme");
assert(/@media \(max-width: 980px\)/.test(html), "missing 1366/1280 responsive breakpoint");
assert(/@media \(max-width: 760px\)/.test(html), "missing narrow-screen responsive breakpoint");
assert(/@media \(prefers-reduced-motion: reduce\)/.test(html), "missing reduced-motion handling");
assert(/@media print/.test(html), "missing print fallback");

const remoteAssets = [
  ...html.matchAll(/<(?:script|img)\b[^>]*\bsrc="(https?:\/\/[^\"]+)"/gi),
  ...html.matchAll(/<link\b[^>]*\bhref="(https?:\/\/[^\"]+)"/gi),
];
assert(remoteAssets.length === 0, `remote runtime assets are forbidden: ${remoteAssets.map((match) => match[1]).join(", ")}`);

assert(html.includes("git --version"), "missing Git preflight");
assert(html.includes("node --version"), "missing Node preflight");
assert(html.includes("install-agents.ps1 | iex"), "missing online install command");
assert(html.includes("-Mode DryRun -NoPull -Detailed"), "missing safe detailed DryRun command");
assert(html.includes("-Mode Check -NoPull"), "missing read-only Check command");
assert(html.includes("不修改业务代码、不访问远端"), "missing i18n retrospective safety boundary");

if (errors.length > 0) {
  console.error("team-sharing presentation verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`team-sharing presentation verification passed: ${slideIds.length} slides, ${speakerNotes} speaker notes, keyboard/touch/hash navigation, local-only assets, current inventory, and demo fallback.`);
