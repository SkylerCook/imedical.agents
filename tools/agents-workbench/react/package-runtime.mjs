import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const prototype = "tools/agents-workbench/prototype";
const react = "tools/agents-workbench/react";
const dist = `${react}/dist`;
const args = process.argv.slice(2);
const formal = args[0] === "--release";
if (formal) args.shift();
const [output, option, runtimePath] = args;

const hasRuntime = args.length === 3 && option === "--node-runtime" && runtimePath;
if (!output || (formal ? !hasRuntime : args.length !== 1 && !hasRuntime)) {
  throw new Error(formal
    ? "用法：npm run stage:release -- <新暂存目录> --node-runtime <已校验的 Windows x64 Node 目录>"
    : "用法：npm run stage -- <新暂存目录> [--node-runtime <已解压的 Windows x64 Node 目录>]");
}
const destination = resolve(output);
if (existsSync(destination)) throw new Error("暂存目录已存在，请指定新目录");

function git(...command) {
  return execFileSync("git", ["--no-replace-objects", "--no-optional-locks", "-C", repo, ...command], {
    windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
}

const currentRevision = () => git("rev-parse", "HEAD").toString("utf8").trim();
const sourceChanges = () => git("status", "--porcelain=v1", "--untracked-files=all").length > 0;
const sourceBaseRevision = currentRevision();

function assertReleaseSource() {
  if (currentRevision() !== sourceBaseRevision || sourceChanges()) {
    throw new Error("正式暂存要求 HEAD 保持不变且 Git 工作区干净");
  }
}

if (formal) {
  assertReleaseSource();
  const ignoredInputs = git("ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--",
    react, `:(exclude)${dist}`, `:(exclude)${react}/node_modules`);
  if (ignoredInputs.length > 0) throw new Error("正式构建目录含未提交的忽略文件，请在干净的源码目录构建");
}

const runtime = runtimePath && resolve(runtimePath);
let nodeVersion;
if (runtime) {
  const manifest = JSON.parse(readFileSync(join(repo, "tools/ai-dev-offline/manifest.json"), "utf8"));
  nodeVersion = manifest.components.find(component => component.id === "node").version;
  const installed = execFileSync(join(runtime, "node.exe"), ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
  if (installed !== `v${nodeVersion}`) throw new Error(`便携运行时需要离线环境的 Node ${nodeVersion}，实际为 ${installed}`);
}

if (formal) {
  if (!process.env.npm_execpath) throw new Error("请通过 npm run stage:release 启动正式构建");
  execFileSync(process.execPath, [process.env.npm_execpath, "run", "build"], {
    cwd: join(repo, react), stdio: "inherit", windowsHide: true,
  });
  assertReleaseSource();
}
if (!existsSync(join(repo, dist, "index.html"))) throw new Error("请先运行 npm run build");

const pluginDirectories = formal
  ? git("ls-tree", "--name-only", "-z", `${sourceBaseRevision}:plugins`).toString("utf8").split("\0")
  : readdirSync(join(repo, "plugins"));
mkdirSync(destination);

function copy(relative, target = relative) {
  const source = resolve(repo, relative);
  const file = join(destination, target);
  const stat = lstatSync(source);
  if (stat.isDirectory()) {
    mkdirSync(file, { recursive: true });
    for (const entry of readdirSync(source)) copy(`${relative}/${entry}`, join(target, entry));
    return;
  }
  if (!stat.isFile()) throw new Error(`运行包来源不是普通文件或目录：${relative}`);
  mkdirSync(dirname(file), { recursive: true });
  if (formal && !isAbsolute(relative) && !relative.startsWith(`${dist}/`) && !relative.startsWith(`${react}/node_modules/`)) {
    writeFileSync(file, git("cat-file", "blob", `${sourceBaseRevision}:${relative}`));
  } else {
    copyFileSync(source, file);
  }
}

if (runtime) {
  copy(join(runtime, "node.exe"), "runtime/node.exe");
  copy(join(runtime, "LICENSE"), "runtime/LICENSE");
  copy(`${react}/start-workbench.cmd`, "start-workbench.cmd");
}
copy(`${react}/import-workbench-release.ps1`, "import-workbench-release.ps1");

for (const asset of ["serve.js", "inspect-project.js", "personal-settings.js", "project-settings.js"]) {
  copy(`${prototype}/${asset}`);
}
for (const file of [
  "LICENSE",
  "tools/ai-dev-offline/configure-project.js", "tools/ai-dev-offline/iris-connection-profiles.js",
  "tools/ai-dev-offline/configure-vscode.js",
  "tools/ai-dev-offline/operation-runtime.js",
  "tools/ai-dev-offline/vendor/jsonc-parser",
  "vendor/jsonc-parser",
  "vendor/iarna-toml",
  "scripts/lib/configuration-file-io.js",
  "scripts/lib/iris-development-settings.js",
  "scripts/lib/iris-profile-verification.js",
  "scripts/lib/project-deployment-policy.js",
  "scripts/lib/project-directories.js",
  "scripts/lib/project-plugin-profile.js",
  "scripts/lib/project-plugin-settings.js",
  "tools/ai-dev-offline/vendor/iarna-toml",
  "scripts/install-agents.ps1",
  "scripts/update-agents.ps1",
  "scripts/plugin-deploy.js",
  "scripts/refresh-agents-sparse.js",
  "scripts/lib/WorkspaceContext.psm1",
  "scripts/lib/offline-capability-update.js",
  "scripts/generate-plugin-catalog.js",
  "scripts/lib/workspace-context.js",
  "scripts/lib/plugin-deployment.js",
  "scripts/lib/knowledge-embedding.js",
  "scripts/lib/knowledge-retrieval.js",
  "scripts/lib/knowledge-sources.js",
  "tools/agents-workbench/src/project-context.js",
  "tools/agents-workbench/src/knowledge-search.js",
  "tools/agents-workbench/src/knowledge-build.js",
  "tools/agents-workbench/src/release-launcher.js",
  "tools/agents-workbench/src/release-selection.js",
  "tools/agents-workbench/src/start-release.js",
  "tools/agents-workbench/src/release-update.js",
  "tools/agents-workbench/src/framework-service.js",
  "tools/agents-workbench/src/framework-worker.js",
  "tools/agents-workbench/src/owner-powershell.js",
  "tools/agents-workbench/src/overlay-members.js",
  "tools/agents-workbench/src/overlay-open.js",
  "tools/agents-workbench/src/overlay-update.js",
  "tools/agents-workbench/src/offline-framework-actions.js",
  "tools/agents-workbench/src/agent-handoff.js",
  "tools/agents-workbench/build/build-offline-package.js",
  "tools/agents-workbench/src/project-owner-actions.js",
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

const documents = ["docs/update-agents.md", "docs/workspace-overlay.md"];
for (const guide of readdirSync(join(repo, "docs/guides"), { withFileTypes: true })) {
  if (guide.isFile() && guide.name.endsWith(".md")) documents.push(`docs/guides/${guide.name}`);
}
for (const document of documents) copy(document);
for (const directory of pluginDirectories.filter(Boolean)) {
  if (!lstatSync(join(repo, "plugins", directory), { throwIfNoEntry: false })?.isDirectory()) continue;
  const manifest = `plugins/${directory}/.agents-plugin/plugin.json`;
  if (existsSync(join(repo, manifest))) copy(manifest);
  else mkdirSync(join(destination, "plugins", directory), { recursive: true });
}

const { version } = JSON.parse(readFileSync(join(repo, react, "package.json"), "utf8"));
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

通过浏览器或启动终端显示的地址打开工作台。配置从启动时绑定的工程和已有个人配置来源读取。对 Git 工程保存私有配置时，现有配置工具会调用 Git 检查跟踪状态。插件目录和手册使用本包的快照。

使用 --demo 可查看虚构工程。

打包启动器为每次启动自动分配端口，可并行打开多个工程。服务仅监听 127.0.0.1，在对应终端按 Ctrl+C 停止。直接运行 serve.js 默认使用 4179，可用 PORT 指定端口。
${formal ? "\n在工程首页导入团队发放的新版 ZIP 和包外发行记录后，原启动器会为该工程优先打开已核验的版本。新版启动失败时自动使用旧版，也可在新版首页点击「恢复旧版工作台」。\n" : ""}
`, "utf8");

const sha256 = relative => createHash("sha256").update(readFileSync(join(destination, relative))).digest("hex");
const metadata = {
  version, platform: runtime ? "windows-x64" : "external-node", formal, sourceBaseRevision,
  localBuildChanges: !formal && sourceChanges(), node: nodeVersion,
  installerSha256: sha256("scripts/install-agents.ps1"),
  documentationSha256: Object.fromEntries(documents.map(document => [document, sha256(document)])),
};
if (formal) {
  assertReleaseSource();
  const tree = git("ls-tree", "-r", "-z", sourceBaseRevision, "--", "scripts", "plugins", "vendor", "hooks");
  // Match the runtime worker and shipping installer's verified Git tree bytes.
  const deployed = tree.toString("latin1").split("\0")
    .filter(row => row.slice(row.indexOf("\t") + 1) !== "scripts/install-agents.ps1");
  metadata.runtimePin = {
    revision: sourceBaseRevision,
    treeDigest: createHash("sha256").update(deployed.join("\0"), "latin1").digest("hex"),
  };
}
writeFileSync(join(destination, "workbench-release.json"), JSON.stringify(metadata, null, 2) + "\n");
console.log(`运行包已就绪：${destination}`);
