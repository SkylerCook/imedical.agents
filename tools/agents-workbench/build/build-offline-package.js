'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bundleName = 'capability.bundle';
const manifestName = 'manifest.json';
const schema = 'imedical-agents-offline-bundle/v1';
const releaseRef = 'refs/heads/master';

function git(cwd, args, diagnostic) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
    Object.assign(env, {
        GIT_ALLOW_PROTOCOL: '',
        GIT_NO_LAZY_FETCH: '1',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_TERMINAL_PROMPT: '0'
    });
    const result = spawnSync('git', [
        '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.longpaths=true', '-c', 'core.hooksPath=/dev/null',
        '-c', 'maintenance.auto=false',
        '-C', cwd, ...args
    ], { env, encoding: 'utf8', windowsHide: true });
    if (result.error?.code === 'ENOENT') throw new Error('未找到 Git。请安装 Git 后重试。');
    if (result.error || result.status !== 0) throw new Error(diagnostic);
    return result.stdout.trim();
}

function directory(input, label) {
    if (!input) throw new Error(`请指定${label}。`);
    const full = path.resolve(input);
    if (!fs.statSync(full, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${label}不存在。`);
    return fs.realpathSync.native(full);
}

function regularFile(directory, name) {
    const file = path.join(directory, name);
    if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`离线包缺少普通文件 ${name}。`);
    return file;
}

function revisionFormat(revision) {
    if (/^[a-f0-9]{40}$/.test(revision)) return 'sha1';
    if (/^[a-f0-9]{64}$/.test(revision)) return 'sha256';
    throw new Error('请提供完整的小写 Git 提交 SHA。');
}

function checkRef(cwd, ref) {
    if (!ref?.startsWith('refs/heads/')) throw new Error('请提供完整的分支引用，例如 refs/heads/master。');
    git(cwd, ['check-ref-format', ref], '离线包分支引用格式无效。');
}

async function hashFile(file) {
    const hash = crypto.createHash('sha256');
    for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
    return hash.digest('hex');
}

async function withScratch(parent, operation) {
    const scratch = fs.mkdtempSync(path.join(parent, 'agents-offline-'));
    try {
        return await operation(scratch);
    } finally {
        if (path.dirname(scratch) !== parent || !fs.lstatSync(scratch, { throwIfNoEntry: false })?.isDirectory()) {
            throw new Error('离线包暂存目录已变化，请核对后清理。');
        }
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

function unpackBundle(file, manifest, scratch) {
    const repository = path.join(scratch, 'repository.git');
    const format = manifest.objectFormat === 'sha256' ? ['--object-format=sha256'] : [];
    git(scratch, ['-c', 'init.defaultObjectFormat=sha1', 'init', '--quiet', '--bare', '--template=', ...format, repository],
        '无法创建离线验证用 Git 仓库。请检查 Git 版本和暂存目录权限。');
    const heads = git(repository, ['bundle', 'list-heads', file], '无法读取 Git bundle 的引用。');
    if (heads !== `${manifest.revision} ${manifest.ref}`) throw new Error('Git bundle 的分支或提交与清单不一致。');
    git(repository, ['bundle', 'verify', file], 'Git bundle 不完整或依赖外部前置对象。请获取完整离线包。');
    git(repository, ['bundle', 'unbundle', file], 'Git bundle 解包失败。请重新获取并核验离线包。');
    if (fs.readdirSync(path.join(repository, 'objects', 'pack')).some(name => name.endsWith('.promisor'))) {
        throw new Error('Git bundle 声明有未随包提供的对象。请获取完整离线包。');
    }
    git(repository, ['fsck', '--full', '--strict', '--no-reflogs', '--no-dangling', manifest.revision],
        'Git bundle 对象缺失或损坏。请重新获取完整离线包。');
    const type = git(repository, ['cat-file', '-t', manifest.revision], 'Git bundle 不包含声明的提交。');
    if (type !== 'commit') throw new Error('Git bundle 声明的修订必须是提交。');
    git(repository, ['update-ref', manifest.ref, manifest.revision], '无法建立离线验证用分支引用。');
    git(repository, ['symbolic-ref', 'HEAD', manifest.ref], '无法建立离线验证用 HEAD。');
    return repository;
}

function readManifest(packageDir, expected) {
    checkRef(packageDir, expected.ref);
    const objectFormat = revisionFormat(expected.revision);
    if (!/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error('请提供已批准的离线包 SHA-256。');
    const file = regularFile(packageDir, manifestName);
    let manifest;
    try {
        if (fs.statSync(file).size > 16 * 1024) throw new Error();
        manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        throw new Error('离线包清单损坏或格式无效。');
    }
    if (manifest?.schema !== schema || manifest.bundle !== bundleName || manifest.objectFormat !== objectFormat ||
        !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0) throw new Error('离线包清单格式无效。');
    if (manifest.ref !== expected.ref || manifest.revision !== expected.revision || manifest.sha256 !== expected.sha256) {
        throw new Error('离线包清单与批准的分支、提交或摘要不一致。');
    }
    return manifest;
}

// The caller supplies approved metadata and consumes the isolated repository before it is removed.
async function withVerifiedPackage(packageDirectory, expected, operation) {
    const packageDir = directory(packageDirectory, '离线包目录');
    const manifest = readManifest(packageDir, expected);
    const original = regularFile(packageDir, bundleName);
    const temporary = path.join(os.tmpdir(), 'Codex');
    fs.mkdirSync(temporary, { recursive: true });
    return withScratch(directory(temporary, '暂存目录'), async scratch => {
        const copy = path.join(scratch, bundleName);
        fs.copyFileSync(original, copy, fs.constants.COPYFILE_EXCL);
        if (fs.statSync(copy).size !== manifest.bytes || await hashFile(copy) !== manifest.sha256) {
            throw new Error('离线包内容与批准的 SHA-256 或清单大小不一致。');
        }
        const repository = unpackBundle(copy, manifest, scratch);
        return operation({ manifest, repository });
    });
}

function inside(root, candidate) {
    const relative = path.relative(root, candidate);
    return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function publish(output, scratch) {
    fs.mkdirSync(output, { mode: 0o700 });
    const published = [];
    try {
        for (const name of [bundleName, manifestName]) {
            const file = path.join(output, name);
            fs.copyFileSync(path.join(scratch, name), file, fs.constants.COPYFILE_EXCL);
            published.push(file);
        }
    } catch (error) {
        for (const file of published.reverse()) fs.unlinkSync(file);
        if (!fs.readdirSync(output).length) fs.rmdirSync(output);
        throw error;
    }
}

async function buildPackage({ source, ref, revision, output }) {
    const sourceDir = directory(source, 'Git 源仓目录');
    const root = git(sourceDir, ['rev-parse', '--absolute-git-dir'], '所选来源不是可读取的 Git 仓库。');
    const common = path.resolve(sourceDir, git(sourceDir, ['rev-parse', '--git-common-dir'], '无法解析源仓对象目录。'));
    const bare = git(sourceDir, ['rev-parse', '--is-bare-repository'], '无法识别源仓类型。') === 'true';
    const worktree = bare ? null : git(sourceDir, ['rev-parse', '--show-toplevel'], '无法解析源工作树。');
    if (!output) throw new Error('请指定一个尚未存在的输出目录。');
    const parent = directory(path.dirname(path.resolve(output)), '输出父目录');
    const target = path.join(parent, path.basename(path.resolve(output)));
    if ([root, common, worktree].filter(Boolean).some(item => inside(fs.realpathSync.native(item), parent))) {
        throw new Error('请选择 Git 源仓及其工作树之外的输出目录。');
    }
    if (fs.lstatSync(target, { throwIfNoEntry: false })) throw new Error('输出目录已存在。请选择新目录。');
    if (git(sourceDir, ['rev-parse', '--is-shallow-repository'], '无法检查源仓历史。') !== 'false') {
        throw new Error('源仓是浅克隆。请从保有完整历史的 Git 仓库构建。');
    }
    const checkClean = () => {
        if (!bare && git(sourceDir, ['status', '--porcelain=v1', '--untracked-files=normal'], '无法检查源工作树。')) {
            throw new Error('源工作树有未提交或未跟踪的文件。请从干净工作树或完整裸仓构建。');
        }
    };
    checkClean();
    const selectedRef = ref ?? releaseRef;
    checkRef(sourceDir, selectedRef);
    const readCommit = () => git(sourceDir, ['rev-parse', '--verify', `${selectedRef}^{commit}`], '源仓缺少指定分支或提交。');
    const selectedRevision = readCommit();
    if (revision !== undefined && selectedRevision !== revision) throw new Error('指定提交与源分支当前提交不一致。');
    const objectFormat = revisionFormat(selectedRevision);
    return withScratch(parent, async scratch => {
        const file = path.join(scratch, bundleName);
        git(sourceDir, ['bundle', 'create', '--quiet', file, selectedRef],
            '无法从本地对象构建完整 Git bundle。若源仓为部分克隆，请先在授权环境补齐对象或使用完整镜像。');
        const manifest = { schema, bundle: bundleName, ref: selectedRef, revision: selectedRevision, objectFormat,
            bytes: fs.statSync(file).size, sha256: await hashFile(file) };
        unpackBundle(file, manifest, scratch);
        if (readCommit() !== selectedRevision) throw new Error('构建期间源分支发生变化。请重新构建。');
        checkClean();
        fs.writeFileSync(path.join(scratch, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        publish(target, scratch);
        return manifest;
    });
}

const usage = `用法
  node build-offline-package.js build --source <Git 源仓> --output <新目录> [--ref <分支引用>] [--revision <提交 SHA>]
  node build-offline-package.js verify --package <离线包目录> --ref <已批准分支引用> --revision <已批准提交 SHA> --sha256 <已批准包摘要>`;

async function main(args) {
    const [action, ...flags] = args;
    if (action === '--help' && !flags.length) return console.log(usage);
    const names = action === 'build' ? ['source', 'output', 'ref', 'revision'] :
        action === 'verify' ? ['package', 'ref', 'revision', 'sha256'] : [];
    if (!names.length || flags.length % 2) throw new Error(usage);
    const options = {};
    for (let i = 0; i < flags.length; i += 2) {
        const name = flags[i].slice(2);
        if (!flags[i].startsWith('--') || !names.includes(name) || Object.hasOwn(options, name) || !flags[i + 1]) throw new Error(usage);
        options[name] = flags[i + 1];
    }
    const manifest = action === 'build' ? await buildPackage(options) :
        await withVerifiedPackage(options.package, options, result => result.manifest);
    console.log(JSON.stringify(manifest));
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(error => {
        console.error(error.code ? `无法处理离线包文件（${error.code}）。请检查输入、输出路径和可用磁盘空间。` : error.message);
        process.exitCode = 1;
    });
}

module.exports = { buildPackage, withVerifiedPackage, releaseRef };
