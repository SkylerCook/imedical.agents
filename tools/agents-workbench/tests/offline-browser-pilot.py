"""Run the Windows Edge offline first-install pilot with a workbench ZIP and actual release materials."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import tempfile
from urllib.parse import urljoin
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright


ORIGIN = "https://gitee.com/skyler-cook/imedical.agents.git"
BUSINESS = {
    "AGENTS.md": b"# Existing project instructions\r\n\r\nPreserve this project rule.\r\n",
    "business.txt": b"Existing application bytes.\r\n",
    ".mcp.json": b'{"mcpServers":{"custom":{"command":"fixture-never-run"}}}\r\n',
}
PROBE = """
if (!require('node:worker_threads').isMainThread) return;
const path = require('node:path');
const service = require(path.join(process.cwd(), 'tools/agents-workbench/src/framework-service.js'));
const create = service.createFrameworkService;
// Inject selected file paths only. The worker, picker input validation and PowerShell owners are unchanged.
service.createFrameworkService = (root, options) => create(root, {
  ...options, pickOffline: async () => JSON.parse(process.env.WORKBENCH_PILOT_OFFLINE_FILES),
});
"""


def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def git(root, env, *args):
    return subprocess.check_output(["git", "-C", root, *args], text=True, env=env).strip()


def read_project_files(project):
    return {file.relative_to(project): digest(file) for file in project.rglob("*") if file.is_file()}


def observed(page):
    response = page.request.get(urljoin(page.url, "/framework.json"), headers={"X-Workbench-Request": "1"})
    assert response.ok
    return response.json()


def authenticated_headers(page, address):
    origin = address.split("/#", 1)[0]
    headers = {"X-Workbench-Request": "1", "Origin": origin}
    session = page.request.post(origin + "/framework/session", headers=headers, data={})
    assert session.ok, session.status
    return headers, {**headers, "X-Workbench-CSRF": session.json()["csrf"]}


def click(page, label, endpoint, expected_status=200):
    with page.expect_response(lambda response: response.url.endswith(endpoint), timeout=300000) as received:
        page.get_by_role("button", name=label, exact=True).click()
    response = received.value
    assert response.status == expected_status, response.json()
    return response.json()


def open_project(page, address):
    with page.expect_response(lambda response: response.url.endswith("/framework/session")) as session:
        page.goto(address)
    assert session.value.ok


def check_changed_bundle(page, project, original, fixture, before_hash, previous, auth, target, revision):
    assert fixture.resolve(strict=True).is_relative_to(project.parent.resolve(strict=True)) and fixture.is_file(), fixture
    size = fixture.stat().st_size
    byte = None
    try:
        with fixture.open("r+b") as file:
            file.seek(-1, os.SEEK_END)
            byte = file.read(1)
            file.seek(-1, os.SEEK_END)
            file.write(bytes([byte[0] ^ 1]))
        assert fixture.stat().st_size == size
        rejected = click(page, "确认离线首装", "/framework/offline", expected_status=409)
        assert rejected["error"] == "offline-bundle-invalid", rejected
        expect(page.get_by_text("能力包校验失败，请核对发行记录、包摘要和对象完整性", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="确认离线首装", exact=True)).to_have_count(0)
        assert read_project_files(project) == original and not (project / ".agents").exists()
    finally:
        if byte:
            with fixture.open("r+b") as file:
                file.seek(-1, os.SEEK_END)
                file.write(byte)
    assert digest(fixture) == before_hash
    replay = page.request.post(auth["Origin"] + "/framework/offline", headers=auth,
                               data={**target, "action": "apply", "selectionId": previous})
    assert replay.status == 409 and replay.json()["error"] == "offline-preview-required"
    assert read_project_files(project) == original and not (project / ".agents").exists()
    replacement = click(page, "选择并预演离线能力包", "/framework/offline")["offline"]
    assert replacement["selectionId"] != previous and replacement["revision"] == revision
    assert read_project_files(project) == original and not (project / ".agents").exists()
    print("PASS same-size tampering after preview rejected without writes; original bytes restored, old selection refused, fresh preview usable", flush=True)


def observe_install(page, address, project, revision, mutation=None):
    open_project(page, address)
    expect(page.get_by_text("工程待安装", exact=True)).to_be_visible()
    expect(page.get_by_role("region", name="交给 Agent", exact=True)).to_have_count(0)
    original = read_project_files(project)
    snapshot = observed(page)
    assert snapshot["status"] == "no-framework" and snapshot["revision"] is None
    headers, auth = authenticated_headers(page, address)
    target = {"projectId": snapshot["projectId"], "revision": None}
    body = {**target, "action": "apply", "selectionId": "unconfirmed"}
    denied = page.request.post(headers["Origin"] + "/framework/offline", headers=headers, data=body)
    assert denied.status == 403 and denied.json()["error"] == "session-required"
    missing = page.request.post(headers["Origin"] + "/framework/offline", headers=auth, data=body)
    assert missing.status == 409 and missing.json()["error"] == "offline-preview-required"
    assert read_project_files(project) == original and not (project / ".agents").exists()

    preview = click(page, "选择并预演离线能力包", "/framework/offline")
    assert preview["offline"]["install"] is True and preview["offline"]["revision"] == revision
    assert preview["offline"]["ref"] == "refs/heads/master"
    expect(page.get_by_text(re.compile(r"^离线预演通过，目标版本"))).to_be_visible()
    expect(page.get_by_role("button", name="确认离线首装", exact=True)).to_be_visible()
    assert read_project_files(project) == original and not (project / ".agents").exists()
    print("PASS unauthenticated and unconfirmed writes rejected; actual offline preview left the nonempty project byte-identical", flush=True)

    if mutation:
        fixture, before_hash = mutation
        check_changed_bundle(page, project, original, fixture, before_hash, preview["offline"]["selectionId"], auth, target, revision)
    receipt = click(page, "确认离线首装", "/framework/offline")
    assert [(step["step"], step["exitCode"]) for step in receipt["steps"]] == [("install", 0), ("initialize", 0), ("check", 0)]
    after = receipt["after"]
    assert after["status"] == "standard" and after["revision"] == revision
    assert after["installed"]["profile"] and after["installed"]["sparseRules"] and after["installed"]["skillEntries"] > 0
    expect(page.get_by_text("基础框架已安装并通过检查。", exact=True)).to_be_visible()
    reread = click(page, "重新读取", "/framework/action")
    assert reread["status"] == "standard" and reread["revision"] == revision
    expect(page.get_by_text(revision[:12], exact=True)).to_be_visible()


def verify_original_updater(project, revision, node, env):
    cap = project / ".agents"
    assert git(cap, env, "rev-parse", "HEAD") == revision
    assert git(cap, env, "config", "--get", "remote.origin.url") == ORIGIN
    assert git(cap, env, "rev-parse", "--abbrev-ref", "@{upstream}") == "origin/master"
    assert not (cap / ".git/objects/info/alternates").exists()
    assert not (cap / "tools").exists() and (cap / "docs/README.md").is_file()
    assert any((cap / "skills").glob("*/SKILL.md"))
    assert "(.agents/docs/README.md)" in (project / "AGENTS.md").read_text(encoding="utf-8-sig")
    assert (project / "AGENTS.md").read_text(encoding="utf-8-sig").startswith(BUSINESS["AGENTS.md"].decode().replace("\r\n", "\n"))
    for file in ("business.txt", ".mcp.json"):
        assert (project / file).read_bytes() == BUSINESS[file]
    powershell = Path(env["SYSTEMROOT"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    version = subprocess.check_output([powershell, "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
                                      env=env, text=True).strip()
    assert version.startswith("5.1."), version
    outcome = subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                              cap / "scripts/update-agents.ps1", "-ProjectRoot", project, "-Mode", "Check", "-NoPull"],
                             cwd=project, env={**env, "PATH": str(node.parent) + os.pathsep + env["PATH"]},
                             capture_output=True, timeout=240)
    assert outcome.returncode == 0, (outcome.stdout.decode("utf-8", "replace"), outcome.stderr.decode("utf-8", "replace"))
    assert git(cap, env, "rev-parse", "HEAD") == revision
    print(f"PASS full offline first install, initialized profile and skill entries, original updater Check -NoPull on PowerShell {version}, business bytes and custom MCP preserved", flush=True)


def verify_existing(page, address, project, revision, recovery_app=None):
    with page.expect_response(lambda response: response.url.endswith("/framework/update-note")) as note:
        open_project(page, address)
    assert note.value.ok and note.value.json().get("prompt"), note.value.json()
    expect(page.get_by_text("已绑定 standard 工程", exact=True)).to_be_visible()
    for label in ("安装基础框架", "选择并预演离线能力包", "确认离线首装", "获取新版并预演", "应用更新并复查", "应用离线更新"):
        expect(page.get_by_role("button", name=label, exact=True)).to_have_count(0)
    snapshot = observed(page)
    assert snapshot["revision"] == revision
    before = read_project_files(project)
    page.get_by_role("button", name="复制更新提示词", exact=True).click()
    expect(page.get_by_text("已复制。请粘贴到当前工程的 Agent 会话，完成后重新读取。", exact=True)).to_be_visible()
    prompt = page.evaluate("navigator.clipboard.readText()").replace("\\\\", "\\")
    assert str(project) in prompt and revision in prompt and "Check -NoPull" in prompt
    if recovery_app:
        assert str(recovery_app / "scripts/update-agents.ps1") in prompt
        assert str(recovery_app / "docs/update-agents.md") in prompt
        assert "runtime/node.exe" in prompt and "-ProjectRoot" in prompt and "sparse-refresh-failed" in prompt
        assert "SHA-256" in prompt and "授权" in prompt
    headers, auth = authenticated_headers(page, address)
    target = {"projectId": snapshot["projectId"], "revision": revision}
    rejected = page.request.post(headers["Origin"] + "/framework/offline", headers=auth, data={**target, "action": "select"})
    assert rejected.status == 409 and rejected.json()["error"] == "framework-update-use-agent"
    assert read_project_files(project) == before
    print("PASS reopened installed project only offers the fixed framework update prompt; offline write API stays retired", flush=True)


def exercise(archive, bundle, record, work, expected_hash, tamper_after_preview, check_bundled_updater):
    package, project = work / "离线 运行包", work / "已有文件的工程"
    project.mkdir()
    archive_hash = digest(archive)
    if expected_hash:
        assert archive_hash == expected_hash.lower(), "unexpected workbench ZIP digest"
    with ZipFile(archive) as source:
        metadata = json.loads(source.read("workbench-release.json").decode("utf-8-sig"))
        assert metadata["platform"] == "windows-x64"
        source.extractall(package)
    assert bundle.name == "capability.bundle" and not record.is_relative_to(bundle.parent)
    bundle_record = json.loads(record.read_text(encoding="utf-8-sig"))
    bundle_hash, record_hash = digest(bundle), digest(record)
    assert bundle_record["schema"] == "imedical-agents-offline-bundle/v1" and bundle_record["ref"] == "refs/heads/master"
    assert bundle_record["sha256"] == bundle_hash, "offline bundle does not match the independent release record"
    revision = bundle_record["revision"]
    picker_bundle, picker_record = bundle, record
    if tamper_after_preview:
        copy = work / "篡改测试副本"
        copy.mkdir()
        picker_bundle = Path(shutil.copyfile(bundle, copy / bundle.name))
        shutil.copyfile(bundle.parent / "manifest.json", copy / "manifest.json")
        picker_record = Path(shutil.copyfile(record, work / "独立发行记录.json"))
        assert digest(picker_bundle) == bundle_hash and digest(picker_record) == record_hash
    node = package / "runtime/node.exe"
    assert subprocess.check_output([node, "--version"], text=True).strip() == "v" + metadata["node"]
    probe = work / "offline-picker.cjs"
    probe.write_text(PROBE, encoding="utf-8")
    system = Path(os.environ["SYSTEMROOT"]) / "System32"
    path = os.pathsep.join(map(str, [Path(shutil.which("git")).parent, system, system / "WindowsPowerShell/v1.0"]))
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith(("GIT_", "IMEDICAL_", "WORKBENCH_"))
           and key.upper() not in {"PATH", "NODE_OPTIONS", "NODE_PATH", "PSMODULEPATH", "BOS_MCP_CONFIG", "KNOWLEDGE_RAG_CONFIG"}}
    env.update(PATH=path, PORT="0", GIT_ALLOW_PROTOCOL="", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0", GIT_CONFIG_GLOBAL="NUL",
               GIT_CONFIG_NOSYSTEM="1", PSMODULEPATH=str(system / "WindowsPowerShell/v1.0/Modules"), WORKBENCH_PILOT_PROBE=str(probe),
               WORKBENCH_PILOT_OFFLINE_FILES=json.dumps({"bundle": str(picker_bundle), "releaseRecord": str(picker_record)}))
    assert shutil.which("node", path=path) is None
    git(project, env, "init", "-q", "--template=")
    for file, content in BUSINESS.items():
        (project / file).write_bytes(content)
    git(project, env, "add", "--", "AGENTS.md", "business.txt")
    git(project, env, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Existing application")
    business_head = git(project, env, "rev-parse", "HEAD")
    launch = runpy.run_path(str(Path(__file__).with_name("standard-pilot.py")))["launch_project"]

    print(f"Workbench {metadata['version']} SHA-256 {archive_hash}; approved framework {revision}; Node {metadata['node']}", flush=True)
    errors, external = [], []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(permissions=["clipboard-read", "clipboard-write"])
        context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))

        def block_nonlocal(route):
            if route.request.url.startswith("http://127.0.0.1:"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        context.route("**/*", block_nonlocal)
        try:
            with launch(node, package, project, env) as address:
                first = context.new_page()
                observe_install(first, address, project, revision, (picker_bundle, bundle_hash) if tamper_after_preview else None)
                first.close()
            verify_original_updater(project, revision, node, env)
            with launch(node, package, project, env) as address:
                verify_existing(context.new_page(), address, project, revision, package if check_bundled_updater else None)
        finally:
            browser.close()
    assert not errors and not external, (errors, external)
    assert git(project, env, "rev-parse", "HEAD") == business_head
    assert digest(bundle) == bundle_hash and digest(record) == record_hash and digest(archive) == archive_hash


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbench_zip", type=Path)
    parser.add_argument("capability_bundle", type=Path)
    parser.add_argument("offline_release_record", type=Path)
    parser.add_argument("--workbench-sha256", help="Digest from the workbench distribution channel")
    parser.add_argument("--tamper-after-preview", action="store_true", help="Verify confirmation rejects a modified copy and requires a fresh preview")
    parser.add_argument("--check-bundled-updater", action="store_true", help="Verify the copied prompt points to the same unpacked recovery updater and manual")
    args = parser.parse_args()
    assert os.name == "nt", "Windows PowerShell 5.1 and Edge are required"
    parent = Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir()) / "Codex"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workbench-offline-browser-", dir=parent) as directory:
        exercise(args.workbench_zip.resolve(strict=True), args.capability_bundle.resolve(strict=True),
                 args.offline_release_record.resolve(strict=True), Path(directory), args.workbench_sha256,
                 args.tamper_after_preview, args.check_bundled_updater)
    assert not Path(directory).exists()
    print("PASS Edge and original offline owners; file-choice paths injected; no Git network or fixture files left", flush=True)
