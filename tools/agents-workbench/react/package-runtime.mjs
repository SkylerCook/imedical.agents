import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const prototype = "tools/agents-workbench/prototype";
const react = "tools/agents-workbench/react";
const dist = `${react}/dist`;
const args = process.argv.slice(2);
const [output, option, runtimePath] = args;

if (!output || (args.length !== 1 && !(args.length === 3 && option === "--node-runtime" && runtimePath))) {
  throw new Error("用法：npm run stage -- <发布目录> [--node-runtime <已解压的 Windows x64 Node 目录>]");
}
const destination = resolve(output);
if (!existsSync(join(repo, dist, "index.html"))) throw new Error("请先运行 npm run build");

const runtime = runtimePath && resolve(runtimePath);
let nodeVersion;
if (runtime) {
  const manifest = JSON.parse(readFileSync(join(repo, "tools/ai-dev-offline/manifest.json"), "utf8"));
  nodeVersion = manifest.components.find(component => component.id === "node").version;
  const installed = execFileSync(join(runtime, "node.exe"), ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
  if (installed !== `v${nodeVersion}`) throw new Error(`便携运行时需要离线环境的 Node ${nodeVersion}，实际为 ${installed}`);
}
mkdirSync(destination);

function copy(relative, target = relative) {
  const source = resolve(repo, relative);
  const file = join(destination, target);
  const stat = lstatSync(source);
  if (stat.isDirectory()) {
    mkdirSync(file, { recursive: true });
    for (const entry of readdirSync(source)) copy(join(source, entry), join(target, entry));
    return;
  }
  if (!stat.isFile()) throw new Error(`运行包来源不是普通文件或目录：${relative}`);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(source, file);
}

if (runtime) {
  copy(join(runtime, "node.exe"), "runtime/node.exe");
  copy(join(runtime, "LICENSE"), "runtime/LICENSE");
  copy(`${react}/start-workbench.cmd`, "start-workbench.cmd");
}

for (const asset of ["serve.js", "inspect-project.js", "personal-settings.js", "project-settings.js"]) {
  copy(`${prototype}/${asset}`);
}
for (const file of [
  "LICENSE",
  "tools/ai-dev-offline/configure-project.js",
  "tools/ai-dev-offline/configure-vscode.js",
  "tools/ai-dev-offline/operation-runtime.js",
  "tools/ai-dev-offline/vendor/jsonc-parser",
  "tools/ai-dev-offline/vendor/iarna-toml",
  "scripts/install-agents.ps1",
  "scripts/generate-plugin-catalog.js",
  "scripts/lib/workspace-context.js",
  "scripts/lib/plugin-deployment.js",
  "tools/agents-workbench/src/project-context.js",
  "tools/agents-workbench/src/framework-service.js",
  "tools/agents-workbench/src/framework-worker.js",
  "scripts/lib/plugin-groups.json",
  `${dist}/index.html`,
  `${dist}/workbench-mark.svg`,
  `${dist}/workbench-overview.webp`,
  `${dist}/assets`,
]) copy(file);

copy(`${react}/LICENSE-shadcn.md`, "licenses/shadcn.md");
copy(`${dist}/.vite/license.md`, "licenses/frontend-bundle.md");
copy(`${react}/node_modules/tailwindcss/LICENSE`, "licenses/tailwindcss.txt");
copy(`${react}/node_modules/tw-animate-css/LICENSE`, "licenses/tw-animate-css.txt");
copy(`${react}/src/fonts/OFL.txt`, "licenses/maple-mono-OFL.txt");
copy(`${react}/src/fonts/UPSTREAM.md`, "licenses/maple-mono-source.md");

for (const guide of readdirSync(join(repo, "docs/guides"), { withFileTypes: true })) {
  if (guide.isFile() && guide.name.endsWith(".md")) copy(`docs/guides/${guide.name}`);
}
for (const entry of readdirSync(join(repo, "plugins"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = `plugins/${entry.name}/.agents-plugin/plugin.json`;
  if (existsSync(join(repo, manifest))) copy(manifest);
  else mkdirSync(join(destination, "plugins", entry.name), { recursive: true });
}

const { version } = JSON.parse(readFileSync(join(repo, react, "package.json"), "utf8"));
const sourceBaseRevision = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const changes = execFileSync("git", ["-C", repo, "status", "--porcelain", "--", "scripts/install-agents.ps1", "tools/agents-workbench"], { encoding:"utf8" });
const installerSha256 = createHash("sha256").update(readFileSync(join(destination,"scripts/install-agents.ps1"))).digest("hex");
writeFileSync(join(destination,"workbench-release.json"), JSON.stringify({
  version, platform:runtime ? "windows-x64" : "external-node", sourceBaseRevision,
  localBuildChanges:Boolean(changes.trim()), node:nodeVersion, installerSha256,
}, null, 2) + "\n");
const startup = runtime ? `将 ZIP 完整解压，在 Windows x64 上双击 \`start-workbench.cmd\`，选择工程后，浏览器会打开实际工作台。包内提供便携 Node.js ${nodeVersion}。

\`\`\`powershell
& ./start-workbench.cmd --project "<工程根目录>"
\`\`\`

也可以用以上命令明确绑定已有工程。` : `将 ZIP 完整解压，在解压目录使用现有 Node.js 24 启动。可复用 AI 开发离线环境中的便携 node.exe。

\`\`\`powershell
node tools/agents-workbench/prototype/serve.js --project "<工程根目录>"
\`\`\``;

writeFileSync(join(destination, "README.md"), `# .agents 工作台离线运行包

${startup}

页面、手册、Maple Mono NF CN 7.9 中文字体和本地依赖已随包交付。启动无需联网、安装系统字体、npm 安装或构建。字体来源和许可在 licenses/。

首次安装和取版需 Git 及框架源访问权限。工程首页提供安装、检查、本地预演、取版预演及写入复查；运行回执会显示各阶段退出码和实际 HEAD。Windows standard 试点版本 ${version}。

打开 [实际工作台](http://127.0.0.1:4179/#home)，配置从启动时绑定的工程和已有个人配置来源读取。对 Git 工程保存私有配置时，现有配置工具会调用 Git 检查跟踪状态。插件目录和手册使用本包的快照。

使用 --demo 可查看虚构工程。[演示首页](http://127.0.0.1:4179/#/clinic/home)

服务仅监听 127.0.0.1。按 Ctrl+C 停止，端口冲突时可在启动前设置 PORT。
`, "utf8");
console.log(`运行包已就绪：${destination}`);
