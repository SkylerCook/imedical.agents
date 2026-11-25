"""Verify formal Windows Workbench import and standalone rollback in Edge."""

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import tempfile
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright


REPO = Path(__file__).resolve().parents[3]
ORIGIN = "https://gitee.com/skyler-cook/imedical.agents.git"
RELEASE_RECORD = re.compile(r"agents-workbench-react(?:-[0-9]+\.[0-9]+\.[0-9]+)?\.release\.json")
UPDATE = "导入工作台新版"
ROLLBACK = "恢复旧版工作台"

LAUNCHER = """
const { fork } = require('node:child_process');
const child = fork('tools/agents-workbench/src/start-release.js', ['--project', process.argv[1]], {
  execArgv: ['--require', process.env.WORKBENCH_PILOT_PRELOAD], silent: true,
});
const deadline = setTimeout(() => child.kill(), 25000);
child.once('message', hello => { clearTimeout(deadline); console.log(JSON.stringify(hello)); });
child.stderr.pipe(process.stderr);
process.stdin.resume().once('end', () => { if (child.connected) child.disconnect(); });
child.once('exit', code => process.exit(code || 0));
"""

PRELOAD = """
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const failedEntry = process.env.WORKBENCH_PILOT_CRASH_ENTRY;
const matchesFailedEntry = entry => failedEntry && entry &&
  path.resolve(entry).toLowerCase() === path.resolve(failedEntry).toLowerCase();
if (matchesFailedEntry(process.argv[1])) {
  fs.writeFileSync(path.join(__dirname, 'crashed-child.json'),
    JSON.stringify({ entry: process.argv[1], node: process.execPath, pid: process.pid }), { flag: 'wx' });
  process.exit(86);
}
const children = new Set();
const fork = childProcess.fork;
childProcess.fork = (entry, args, options) => {
  // Preserve the exact verified install tree and fail only the selected release's actual child.
  if (matchesFailedEntry(entry)) options = { ...options, execArgv: ['--require', __filename] };
  const child = fork(entry, args, options);
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
};
process.on('disconnect', async () => {
  const deadline = setTimeout(() => process.exit(1), 5000);
  await Promise.all([...children].map(child => new Promise(resolve => {
    child.once('close', resolve);
    child.kill();
  })));
  clearTimeout(deadline);
  process.exit(0);
});
// Follow the real rollback address in the isolated Edge context, without opening the desktop browser.
const spawn = childProcess.spawn;
childProcess.spawn = (file, args, ...options) => {
  if (path.basename(file).toLowerCase() === 'cmd.exe' && args?.[2] === 'start') {
    const shell = new EventEmitter();
    shell.unref = () => {};
    process.nextTick(() => shell.emit('exit', 0));
    return shell;
  }
  return spawn(file, args, ...options);
};
if (process.env.WORKBENCH_PILOT_PICKER) {
  const update = require(path.join(process.cwd(), 'tools/agents-workbench/src/release-update.js'));
  const create = update.createReleaseUpdateService;
  update.createReleaseUpdateService = (root, options) => create(root, {
    ...options,
    choose: async () => JSON.parse(fs.readFileSync(process.env.WORKBENCH_PILOT_PICKER, 'utf8')),
  });
}
"""


def verify_release(archive, record):
    verify = runpy.run_path(str(Path(__file__).with_name("standard-pilot.py")))["verify_outer_record"]
    with ZipFile(archive) as bundle:
        metadata = json.loads(bundle.read("workbench-release.json").decode("utf-8-sig"))
    verify(archive, metadata, record)
    assert metadata["formal"] and not metadata["localBuildChanges"] and metadata["platform"] == "windows-x64"
    return metadata


def git(directory, env, *args):
    return subprocess.check_output(["git", "-C", directory, *args], text=True, env=env).strip()


def project_fixture(root, marker, env):
    scripts = root / ".agents/scripts"
    scripts.mkdir(parents=True)
    cap = scripts.parent
    (scripts / "update-agents.ps1").write_bytes(b'throw "Fixture updater must never run"\r\n')
    (root / "AGENTS.md").write_bytes(b"# Fixture project rules\r\n")
    (root / "marker.txt").write_bytes(marker)
    git(cap, env, "init", "-q", "--initial-branch=master", "--template=")
    git(cap, env, "add", "scripts/update-agents.ps1")
    git(cap, env, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", marker.decode("ascii"))
    git(cap, env, "remote", "add", "origin", ORIGIN)
    git(cap, env, "config", "branch.master.remote", "origin")
    git(cap, env, "config", "branch.master.merge", "refs/heads/master")
    return git(cap, env, "rev-parse", "HEAD")


def files(root):
    return {str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()}


@contextmanager
def boot(context, application, project, env, picker=None):
    child_env = dict(env)
    if picker:
        child_env["WORKBENCH_PILOT_PICKER"] = str(picker)
    node = application / "runtime/node.exe"
    with subprocess.Popen([node, "-e", LAUNCHER, project], cwd=application, env=child_env,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8") as server:
        page = context.new_page()
        try:
            hello = json.loads(server.stdout.readline())
            page.goto(hello["address"].partition("#")[0] + "#bootstrap=" + hello["bootstrap"])
            yield page
        finally:
            page.close()
            server.stdin.close()
            try:
                assert server.wait(timeout=15) == 0, "isolated Workbench did not shut down cleanly"
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
                raise


def check(page, version, revision, rollback):
    expect(page.get_by_text(re.compile(rf"^工作台(?:版本)? {re.escape(version)}$"))).to_be_visible()
    expect(page.get_by_text(revision[:12], exact=True)).to_be_visible()
    expect(page.get_by_role("button", name=ROLLBACK, exact=True)).to_have_count(int(rollback))


def action(page, label):
    with page.expect_response(lambda response: response.url.endswith("/framework/release-update"), timeout=90000) as pending:
        page.get_by_role("button", name=label, exact=True).click()
    return pending.value


def exercise(old_archive, old_record, new_archive, new_record, work):
    old_info, new_info = verify_release(old_archive, old_record), verify_release(new_archive, new_record)
    old_version, new_version = old_info["version"], new_info["version"]
    assert all(re.fullmatch(r"\d+\.\d+\.\d+", version) for version in (old_version, new_version))
    assert tuple(map(int, new_version.split("."))) > tuple(map(int, old_version.split(".")))
    base, candidate = work / "原工作台", work / f"agents-workbench-react-{new_version}"
    with ZipFile(old_archive) as bundle:
        bundle.extractall(base)
    preload, picker, bad_record = (work / name for name in ("preload.cjs", "pick.json", "bad-release.json"))
    preload.write_text(PRELOAD, encoding="utf-8")
    bad_metadata = json.loads(new_record.read_text(encoding="utf-8-sig"))
    bad_record.write_text(json.dumps({**bad_metadata, "sha256": "0" * 64}), encoding="utf-8")

    system = Path(os.environ["SYSTEMROOT"]) / "System32"
    git_bin = Path(shutil.which("git")).parent
    allowed = os.pathsep.join(map(str, [git_bin, system, system / "WindowsPowerShell/v1.0"]))
    env = {key: val for key, val in os.environ.items()
           if key.upper() not in {"WORKBENCH_LAUNCH_ANCHOR", "WORKBENCH_STARTUP_PARENT", "WORKBENCH_PILOT_PICKER",
                                  "WORKBENCH_PILOT_CRASH_ENTRY", "NODE_OPTIONS", "NODE_PATH"}}
    env.update(PATH=allowed, PORT="0", GIT_ALLOW_PROTOCOL="", GIT_CONFIG_GLOBAL="NUL", GIT_CONFIG_NOSYSTEM="1",
               GIT_TERMINAL_PROMPT="0", WORKBENCH_PILOT_PRELOAD=str(preload))
    assert shutil.which("node", path=allowed) is None
    first, second = (work / parent / "同名工程" for parent in ("甲", "乙"))
    a, b = project_fixture(first, b"Project A", env), project_fixture(second, b"Project B", env)
    original_a, original_b = files(first), files(second)

    def offer(record):
        picker.write_text(json.dumps({"archive": str(new_archive), "releaseRecord": str(record)}), encoding="utf-8")

    def imported(page):
        response = action(page, UPDATE)
        receipt = response.json()
        assert response.ok and receipt["version"] == new_version and receipt["selectionSaved"], receipt
        return receipt

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        try:
            context = browser.new_context(viewport={"width": 1280, "height": 800})
            with boot(context, base, first, env, picker) as old:
                check(old, old_version, a, False)
                offer(bad_record)
                rejected = action(old, UPDATE)
                assert not rejected.ok and rejected.json()["error"] == "import-failed"
                expect(old.get_by_text("校验或导入失败。请核对可信渠道提供的 ZIP 和包外发行记录。", exact=True)).to_be_visible()
                assert not candidate.exists() and not (base / ".workbench-launch").exists()
                offer(new_record)
                opened = imported(old)
                with context.expect_page() as opened_page:
                    old.get_by_role("link", name="打开新版工作台", exact=True).click()
                launched = opened_page.value
                check(launched, new_version, a, True)
                assert launched.url.partition("#")[0] == opened["address"].partition("#")[0]
                launched.close()
                check(old, old_version, a, False)
                print(f"PASS {old_version} rejects bad digest and opens {new_version} through the actual importer", flush=True)

            with boot(context, base, first, env) as selected:
                check(selected, new_version, a, True)
            with boot(context, candidate, second, env) as sibling:
                check(sibling, new_version, b, False)
            with boot(context, base, second, env) as unselected:
                check(unselected, old_version, b, False)

            with boot(context, candidate, first, env) as standalone:
                check(standalone, new_version, a, True)
                restored = action(standalone, ROLLBACK)
                receipt = restored.json()
                assert restored.ok and receipt["version"] == old_version and receipt["selectionSaved"], receipt
                with context.expect_page() as old_page:
                    standalone.get_by_role("link", name="打开旧版工作台", exact=True).click()
                previous = old_page.value
                check(previous, old_version, a, False)
                previous.close()
                check(standalone, new_version, a, False)
            with boot(context, base, first, env, picker) as original:
                check(original, old_version, a, False)
                imported(original)
            with boot(context, base, second, env) as unselected:
                check(unselected, old_version, b, False)
            print("PASS standalone successor sees rollback; previous version is restored and same-name project is independent", flush=True)

            # Refusal of an unavailable installed directory is an automatic fallback, before child startup.
            held = candidate.with_name("候选暂不可用")
            candidate.rename(held)
            try:
                with boot(context, base, first, env) as fallback:
                    check(fallback, old_version, a, False)
            finally:
                held.rename(candidate)
            with boot(context, base, first, env, picker) as still_old:
                check(still_old, old_version, a, False)
                imported(still_old)
            print("PASS fallback when installed candidate directory is unavailable; old default remains after candidate returns", flush=True)

            candidate_entry = candidate / "tools/agents-workbench/prototype/serve.js"
            broken = dict(env, WORKBENCH_PILOT_CRASH_ENTRY=str(candidate_entry))
            with boot(context, base, first, broken) as fallback:
                crash = json.loads((work / "crashed-child.json").read_text(encoding="utf-8"))
                assert Path(crash["entry"]) == candidate_entry
                assert Path(crash["node"]) == candidate / "runtime/node.exe"
                assert crash["pid"] > 0
                check(fallback, old_version, a, False)
            with boot(context, base, first, env) as still_old:
                check(still_old, old_version, a, False)
            with boot(context, base, second, env) as unselected:
                check(unselected, old_version, b, False)
            print("PASS the packaged successor child starts and exits; the old default is restored for only that project", flush=True)
        finally:
            browser.close()
    assert files(first) == original_a and files(second) == original_b


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("new_archive", type=Path)
    parser.add_argument("new_record", type=Path)
    parser.add_argument("--old-archive", type=Path)
    parser.add_argument("--old-record", type=Path)
    args = parser.parse_args()
    if not args.old_record:
        dist = REPO / "tools/dist"
        records = [entry for entry in dist.glob("*.release.json") if entry.is_file() and RELEASE_RECORD.fullmatch(entry.name)]
        if len(records) != 1:
            parser.error("expected one current Workbench release record in tools/dist, or specify --old-record")
        args.old_record = records[0]
    if not args.old_archive:
        args.old_archive = args.old_record.with_name(args.old_record.name.removesuffix(".release.json") + ".zip")
    parent = Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir()) / "Codex"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workbench-release-browser-", dir=parent) as directory:
        exercise(args.old_archive.resolve(strict=True), args.old_record.resolve(strict=True),
                 args.new_archive.resolve(strict=True), args.new_record.resolve(strict=True), Path(directory))
    assert not Path(directory).exists()
    print("PASS formal ZIP Edge lifecycle and fixture cleanup", flush=True)
