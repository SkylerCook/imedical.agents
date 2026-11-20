"""Windows pilot acceptance for a workbench ZIP using Playwright and Edge."""
import argparse
from contextlib import contextmanager
import json
import os
from hashlib import sha256
from pathlib import Path
import shutil
import subprocess
import tempfile
from zipfile import ZipFile

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[3]
A = "b65675b656519b2a2bda02fd2b26e1a19fdbdd62"
B = "5520bdf7854561bd80e04fcc9330b6bb921bfe80"
WORKBENCH_021 = "e943fc299efe658e1a2da90602a50d85cf2a3c7b"
ORIGIN = "https://gitee.com/skyler-cook/imedical.agents.git"


def git(directory, *args):
    return subprocess.check_output(["git", "-C", directory, *args], text=True).strip()


def verify_outer_record(archive, release, record_file):
    record = json.loads(record_file.read_text(encoding="utf-8-sig"))
    assert record["file"] == "agents-workbench-react.zip", "unexpected release filename"
    assert record["bytes"] == archive.stat().st_size, "release ZIP size differs from the external record"
    digest = sha256()
    with archive.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    assert digest.hexdigest() == record["sha256"].lower(), "release ZIP hash differs from the external record"
    for field in ("version", "platform", "formal", "sourceBaseRevision", "localBuildChanges", "node",
                  "installerSha256", "documentationSha256", "runtimePin"):
        assert release.get(field) == record.get(field), f"release record mismatch: {field}"


def pinned_revision(release, required):
    pin = release.get("runtimePin")
    if pin is None and not required:
        return None
    assert release.get("formal") is True and pin is not None, "acceptance requires a formal runtime pin"
    revision = release["sourceBaseRevision"]
    assert pin["revision"] == revision, "the pin must name the exact packaged source"
    entries = subprocess.check_output([
        "git", "--no-replace-objects", "-C", REPO, "ls-tree", "-r", "-z", revision, "--",
        "scripts", "plugins", "vendor", "hooks",
    ]).split(b"\0")
    tree = b"\0".join(entry for entry in entries if not entry.endswith(b"\tscripts/install-agents.ps1"))
    assert sha256(tree).hexdigest() == pin["treeDigest"], "runtime pin differs from the committed execution tree"
    return revision


@contextmanager
def launch_project(node, app, project, env):
    # Pass the one-time fragment to Edge without printing it in the logs.
    launcher = """
      const {fork}=require('node:child_process');
      const child=fork('tools/agents-workbench/prototype/serve.js',['--project',process.argv[1]],{
        silent:true,execArgv:['--require',process.env.WORKBENCH_PILOT_PROBE]
      });
      child.once('message',m=>console.log(JSON.stringify(m)));
      child.once('exit',code=>process.exit(code||0));
      process.stdin.resume(); process.stdin.once('end',()=>child.kill());
    """
    proc = subprocess.Popen([node, "-e", launcher, project], cwd=app, env=env,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf8")
    try:
        hello = json.loads(proc.stdout.readline())
        yield hello["address"].split("#")[0] + "#bootstrap=" + hello["bootstrap"]
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def exercise(archive, work, require_formal, require_runtime_pin=False, release_record=None, installed_revision=None,
             target_revision=None):
    package = work / "独立 解压"
    with ZipFile(archive) as zip_file:
        release = json.loads(zip_file.read("workbench-release.json"))
        if require_formal and release.get("formal") is not True:
            raise ValueError("acceptance requires a formal release build")
        if release_record:
            verify_outer_record(archive, release, release_record)
        if release.get("formal"):
            revision = release["sourceBaseRevision"]
            files = subprocess.check_output([
                "git", "-C", REPO, "ls-tree", "-r", "-z", "--name-only", revision, "--",
                "docs/guides", "docs/update-agents.md", "docs/workspace-overlay.md",
            ]).decode("utf8").split("\0")
            manuals = {file for file in files if file.endswith(".md") and file.count("/") <= 2}
            assert set(release["documentationSha256"]) == manuals, "release manual list differs from Git"
            assert not release["localBuildChanges"], "formal release contains local changes"
            assets = {"scripts/install-agents.ps1": release["installerSha256"], **release["documentationSha256"]}
            for file, digest in assets.items():
                packaged = zip_file.read(file)
                committed = subprocess.check_output(["git", "-C", REPO, "show", revision + ":" + file])
                assert packaged == committed and sha256(packaged).hexdigest() == digest.lower(), file
            print("verified", len(manuals), "manuals against", revision[:8], flush=True)
        approved = pinned_revision(release, require_runtime_pin)
        zip_file.extractall(package)
    node = package / "runtime/node.exe"
    assert subprocess.check_output([node, "--version"], text=True).strip() == "v24.22.3"
    mirror = work / "本地框架.git"
    previous = installed_revision or (WORKBENCH_021 if approved else A)
    git(work, "clone", "--bare", "--shared", REPO, mirror)
    git(mirror, "update-ref", "refs/heads/master", previous)
    git(mirror, "update-ref", "refs/heads/pilot-unrelated", previous)
    git(mirror, "config", "uploadpack.allowFilter", "true")
    git(mirror, "config", "uploadpack.allowAnySHA1InWant", "true")
    git(mirror, "symbolic-ref", "HEAD", "refs/heads/master")
    project = work / "非空 工程"
    project.mkdir()
    git(project, "init", "-q")
    original = {"AGENTS.md": b"# Existing project instructions\n",
                ".mcp.json": b'{"mcpServers":{"custom":{"command":"fixture-never-run"}}}\n',
                "business.txt": b"business fixture\n"}
    for name, content in original.items():
        (project / name).write_bytes(content)
    system = Path(os.environ["SYSTEMROOT"]) / "System32"
    trace = work / "git-trace.jsonl"
    probe = work / "fixture-upstream.cjs"
    probe.write_text("""
if (!require('node:worker_threads').isMainThread) return;
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const service = require(path.join(process.cwd(), 'tools/agents-workbench/src/framework-service.js'));
const create = service.createFrameworkService;
service.createFrameworkService = (root, options) => create(root, {
  ...options,
  readUpdateHead: () => execFileSync('git', [
    '-C', process.env.WORKBENCH_PILOT_MIRROR, 'rev-parse', 'refs/heads/master'
  ], {encoding:'utf8', windowsHide:true}).trim()
});
""", encoding="utf8")
    env = dict(os.environ, GIT_TRACE2_EVENT=str(trace), PORT="0", GIT_ALLOW_PROTOCOL="file", GIT_CONFIG_COUNT="1",
               GIT_CONFIG_KEY_0=f"url.{mirror.as_uri()}.insteadOf", GIT_CONFIG_VALUE_0=ORIGIN,
               WORKBENCH_PILOT_PROBE=str(probe), WORKBENCH_PILOT_MIRROR=str(mirror),
               PATH=os.pathsep.join(map(str, [Path(shutil.which("git")).parent, system, system/"WindowsPowerShell/v1.0"])))
    assert not shutil.which("node", path=env["PATH"])
    with launch_project(node, package, project, env) as address:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(address)
            page.get_by_role("link", name="使用手册", exact=True).click()
            page.get_by_role("heading", name="把任务接续到 Agent", exact=True).wait_for()
            page.get_by_role("link", name="更新中断与续接", exact=True).click()
            page.get_by_role("heading", name="更新中断与续接", exact=True).wait_for()
            page.get_by_role("link", name="团队使用手册", exact=True).last.click()
            page.get_by_role("link", name="共享能力根更新、各工程刷新", exact=True).click()
            page.get_by_role("heading", name="Workspace Overlay 部署与恢复 Runbook", exact=True).wait_for()
            page.get_by_role("link", name="总览", exact=True).click()

            def click(label):
                button = page.get_by_role("button", name=label, exact=True)
                if label == "安装基础框架":
                    try:
                        button.wait_for(timeout=12000)
                    except Exception:
                        print(page.evaluate("""async () => ({
                          framework: await fetch('/framework.json',{headers:{'X-Workbench-Request':'1'}}).then(r=>r.json()),
                          buttons: [...document.querySelectorAll('button')].map(button=>button.textContent)
                        })"""), flush=True)
                        raise
                with page.expect_response(lambda r: r.url.endswith("/framework/action"), timeout=180000) as response:
                    button.click()
                result = response.value.json()
                if result.get("error") and trace.exists():
                    for line in trace.read_text(encoding="utf8",errors="replace").splitlines():
                        event = json.loads(line)
                        if event.get("event") == "error":
                            print("fixture Git:", event["msg"], flush=True)
                assert response.value.ok and result.get("exitCode") == 0, (label, result)
                assert all(s["exitCode"] == 0 for s in result["steps"]), result
                print(label, [(s["step"], s["exitCode"], s["revision"][:8]) for s in result["steps"]], flush=True)
                return result

            cap = project / ".agents"
            direct = page.get_by_role("region", name="在工作台完成", exact=True)
            handoff = page.get_by_role("region", name="交给 Agent", exact=True)
            direct.get_by_role("button", name="安装基础框架", exact=True).wait_for()
            assert handoff.count() == 0
            installed = click("安装基础框架")
            assert installed["after"]["revision"] == previous and git(cap, "rev-parse", "HEAD") == previous
            assert installed["after"]["installed"]["profile"] and installed["after"]["installed"]["sparseRules"]
            assert installed["after"]["installed"]["skillEntries"] > 0
            direct.get_by_text("基础框架已安装并通过检查。", exact=True).wait_for()
            handoff.get_by_role("button", name="准备工程检查请求", exact=True).click()
            dialog = page.get_by_role("dialog", name="接续到 Agent", exact=True)
            inspection = dialog.get_by_role("textbox", name="接续请求", exact=True).input_value()
            assert str(project) in inspection and "只读审计流程" in inspection
            assert "用户明确要求补齐时" in inspection
            page.keyboard.press("Escape")
            assert original["AGENTS.md"].rstrip() in (project / "AGENTS.md").read_bytes()
            assert git(cap, "config", "--get", "remote.origin.url") == ORIGIN
            packs = list((cap / ".git/objects/pack").glob("*.pack"))
            assert git(cap, "config", "--get", "remote.origin.partialclonefilter") == "blob:none"
            print("first-install retained pack bytes:", sum(p.stat().st_size for p in packs), flush=True)
            for name in ("check-frontend-encoding.ps1", "convert-gb2312-upload.ps1"):
                (cap / "scripts" / name).write_text(f"# coding-iris-plugin managed wrapper\n$canonical = Join-Path $PSScriptRoot '../plugins/coding-iris-plugin/scripts/{name}'\n& $canonical @args\nexit $LASTEXITCODE", encoding="utf8")
            cache = cap / "vendor/sftp-server/src/__pycache__/operations.cpython-313.pyc"
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(b"local cache fixture")
            with (cap / ".git/info/exclude").open("a",encoding="utf8") as ignore:
                ignore.write("\n/vendor/sftp-server/src/__pycache__/\n")
            page.get_by_text("当前框架已是上游版本", exact=True).wait_for()
            click("检查工程")
            refs = git(cap, "show-ref")
            sparse = (cap / ".git/info/sparse-checkout").read_bytes()
            index = (cap / ".git/index").read_bytes()
            fetch_head = cap / ".git/FETCH_HEAD"
            saved_fetch_head = fetch_head.read_bytes() if fetch_head.exists() else None
            target = approved or target_revision or B
            git(mirror, "merge-base", "--is-ancestor", previous, target)
            git(mirror, "update-ref", "refs/heads/master", target, previous)
            page.get_by_role("button", name="重新读取", exact=True).click()
            page.get_by_text("发现框架新版", exact=False).wait_for()
            page.evaluate("Object.defineProperty(navigator.clipboard, 'writeText', {value: () => Promise.reject(new Error('fixture clipboard unavailable'))})")
            handoff.get_by_role("button", name="复制更新提示词", exact=True).click()
            prompt = page.get_by_role("textbox", name="更新提示词", exact=True).input_value()
            assert str(project) in prompt.replace("\\\\", "\\")
            assert previous in prompt and target in prompt and "update-agents.md" in prompt
            assert "在本会话报告实际框架提交、复查结果和未完成项" in prompt
            assert "重新读取" not in prompt
            for label in ("获取新版并预演", "应用更新并复查", "应用离线更新"):
                assert page.get_by_role("button", name=label, exact=True).count() == 0
            assert git(cap, "rev-parse", "HEAD") == previous and git(cap, "show-ref") == refs
            assert (cap / ".git/info/sparse-checkout").read_bytes() == sparse and (cap / ".git/index").read_bytes() == index
            assert (fetch_head.read_bytes() if fetch_head.exists() else None) == saved_fetch_head
            owner_env = dict(env, PATH=os.pathsep.join([str(node.parent), env["PATH"]]),
                             PSModulePath=str(system / "WindowsPowerShell/v1.0/Modules"))
            owner = [system / "WindowsPowerShell/v1.0/powershell.exe", "-NoProfile", "-NonInteractive",
                     "-ExecutionPolicy", "Bypass", "-File", cap / "scripts/update-agents.ps1", "-ProjectRoot", project]
            for mode, args in (("DryRun", []), ("Write", ["-NoPull"]), ("Check", ["-NoPull"])):
                result = subprocess.run([*owner, "-Mode", mode, *args], cwd=project, env=owner_env, capture_output=True)
                assert result.returncode == 0, (mode, result.stdout, result.stderr)
            assert git(cap, "rev-parse", "HEAD") == target
            refs_after_update = git(cap, "show-ref")
            with page.expect_response(lambda reply: reply.url.endswith("/framework/action") and
                                      reply.request.post_data_json.get("action") == "refresh") as response:
                page.evaluate("window.dispatchEvent(new Event('focus'))")
            assert response.value.ok and response.value.json()["revision"] == target
            page.get_by_text("当前框架已是上游版本", exact=True).wait_for()
            assert git(cap, "show-ref") == refs_after_update
            print("verified read-only discovery, short copied prompt, original updater and automatic readback", flush=True)
            for name, content in original.items():
                current = (project / name).read_bytes()
                if name == "AGENTS.md":
                    assert content.rstrip() in current
                else:
                    assert current == content
            # A same-tree descendant tests exact release selection. The historical ZIP recognizes runtime trees.
            test_env = dict(os.environ,GIT_INDEX_FILE=str(work / "fixture.index"),
                            GIT_AUTHOR_NAME="Fixture",GIT_AUTHOR_EMAIL="fixture@example.invalid",
                            GIT_COMMITTER_NAME="Fixture",GIT_COMMITTER_EMAIL="fixture@example.invalid")
            def change(path, parent):
                def command(args, text=None):
                    return subprocess.check_output(["git","-C",mirror,*args],env=test_env,input=text,text=True).strip()
                command(["read-tree",parent])
                oid = command(["hash-object","-w","--stdin"],'throw "fixture file must not be executed"\n')
                command(["update-index","--add","--cacheinfo",f"100644,{oid},{path}"])
                commit = command(["commit-tree",command(["write-tree"]),"-p",parent,"-m","fixture compatibility"])
                git(mirror,"update-ref","refs/heads/master",commit,parent)
                return commit
            if approved:
                published = change("scripts/install-agents.ps1", target)
                page.get_by_role("button", name="重新读取", exact=True).click()
                page.get_by_text("发现框架新版", exact=False).wait_for()
                page.get_by_text(published[:12], exact=True).wait_for()
                assert git(cap,"rev-parse","HEAD") == approved
            fresh_cases = ["新 工程"] if approved or target_revision else []
            if target_revision and not approved:
                published = target
                fresh_cases.append("上游前进 新工程")
            for name in fresh_cases:
                if name == "上游前进 新工程":
                    published = change("scripts/update-agents.ps1", target)
                fresh = work / name
                fresh.mkdir()
                git(fresh, "init", "-q")
                with launch_project(node, package, fresh, env) as fresh_address:
                    page = browser.new_page()
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    page.goto(fresh_address)
                    first = click("安装基础框架")
                    assert first["after"]["revision"] == git(fresh / ".agents", "rev-parse", "HEAD") == target
                    assert first["after"]["installed"]["profile"] and first["after"]["installed"]["skillEntries"] > 0
                    assert git(fresh / ".agents", "rev-parse", "refs/remotes/origin/master") == published
                    if published != target:
                        assert first["compatibility"]["publishedRevision"] == published
                        assert first["compatibility"]["selectedRevision"] == target
                        page.get_by_text("已安装核验版本", exact=False).wait_for()
                    assert git(fresh / ".agents", "config", "--get", "remote.origin.url") == ORIGIN
                    print("verified fresh install", target[:8], "published", published[:8], flush=True)
            assert not errors, errors
            browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--require-formal", action="store_true")
    parser.add_argument("--require-runtime-pin", action="store_true")
    parser.add_argument("--release-record", type=Path)
    parser.add_argument("--installed-revision", help="initial framework revision in the isolated Git mirror")
    parser.add_argument("--target-revision", help="published framework revision to verify with a trial ZIP")
    args = parser.parse_args()
    if args.require_runtime_pin and not args.release_record:
        parser.error("--require-runtime-pin requires the approved --release-record for this ZIP")
    if args.require_formal and args.target_revision:
        parser.error("--target-revision is only supported for trial ZIPs")
    parent = Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir()) / "Codex"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workbench-pilot-", dir=parent) as temp:
        exercise(args.archive.resolve(), Path(temp), args.require_formal, args.require_runtime_pin, args.release_record,
                 args.installed_revision, args.target_revision)
