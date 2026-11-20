"""Exercise project-bound Agent handoff in a staged Windows Workbench."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright

REPO = Path(__file__).resolve().parents[3]
ORIGIN = "https://gitee.com/skyler-cook/imedical.agents.git"
CONTEXT_SKILL = "plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md"
CONNECTION_GUIDE = "docs/guides/connection-configuration.md"
KNOWLEDGE_GUIDE = "docs/guides/knowledge-retrieval.md"
PERSONAL_SENTINEL = "fixture-credential-never-in-handoff"
FIXTURE_SKILL = "---\nname: fixture-client-skill\ndescription: Client discovery fixture\n---\n"
LAUNCHER = """
const child = require('node:child_process').fork('tools/agents-workbench/prototype/serve.js',
  ['--project', process.argv[1]], {silent:true});
child.on('message', message => console.log(JSON.stringify(message)));
child.stderr.pipe(process.stderr);
process.stdin.resume().once('end', () => child.kill());
child.on('exit', () => process.exit());
"""


def deployed_fixture(project, env):
    cap = project / ".agents"
    cap.mkdir(parents=True)
    git = ["git", "-C", cap, "-c", "commit.gpgSign=false", "-c", "core.hooksPath=disabled"]
    for args in [["init", "-q"], ["remote", "add", "origin", ORIGIN],
                 ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                  "commit", "-qm", "Runtime fixture", "--allow-empty"]]:
        subprocess.run([*git, *args], env=env, check=True)
    for relative in ["scripts/update-agents.ps1", "scripts/sync-runtime-skills.js", CONTEXT_SKILL,
                     "scripts/lib/workspace-context.js", "docs/coding-agent-adaptation.md",
                     CONNECTION_GUIDE, KNOWLEDGE_GUIDE, "scripts/knowledge-query.js"]:
        target = cap / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO / relative, target)
    create_skill(cap / "skills")
    (project / "AGENTS.md").write_text("Fixture rules\n", encoding="utf-8")
    return cap


def prepare(page, host):
    row = page.get_by_role("row").filter(has=page.get_by_text(host, exact=True))
    row.get_by_role("button", name="准备接入请求").click()
    expect(page.get_by_role("dialog")).to_be_visible()
    prompt = page.get_by_label("接续请求").input_value()
    page.keyboard.press("Escape")
    return prompt, row


def create_skill(root):
    skill = root / "fixture-client-skill" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text(FIXTURE_SKILL, encoding="utf-8")
    return skill


def refresh_client(page, name):
    with page.expect_response(lambda response: response.url.endswith("/project.json")) as reread:
        page.get_by_role("button", name="重新检查").click()
    result = reread.value
    assert result.ok
    return next(item for item in result.json()["clients"] if item["name"] == name)


def observe_client_entries(page, project, cap, node, env, installed, row):
    claude = project / ".claude"
    (claude / "agents").mkdir(parents=True)
    (claude / "settings.json").write_text("{}", encoding="utf-8")
    assert refresh_client(page, "Claude Code")["entries"] == []
    expect(row.get_by_text("未发现项目级入口", exact=True)).to_be_visible()
    expect(row.get_by_text("尚未验证宿主加载", exact=True)).to_be_visible()
    if not installed:
        return

    (claude / "CLAUDE.md").write_text("# Existing project-specific rules\n", encoding="utf-8")
    agent = claude / "agents/fixture.md"
    agent.write_text("---\nname: fixture\ndescription: Existing project Agent\n---\n", encoding="utf-8")
    skills = claude / "skills"
    skill = create_skill(skills)
    assert refresh_client(page, "Claude Code")["entries"] == [
        {"kind": "rules", "path": ".claude/CLAUDE.md"},
        {"kind": "skills", "path": ".claude/skills", "detail": "独立技能目录"},
        {"kind": "agents", "path": ".claude/agents"},
    ]
    expect(row.get_by_text("独立技能目录", exact=True)).to_be_visible()
    assert ".claude/skills" in prepare(page, "Claude Code")[0]
    skill.unlink()
    skill.parent.rmdir()
    skills.rmdir()
    owner = [node, cap / "scripts/sync-runtime-skills.js", "--project-root", project, "--runtime", "ClaudeCode"]
    try:
        subprocess.run([*owner, "--mode", "Write"], env=env, check=True, capture_output=True)
        linked = refresh_client(page, "Claude Code")["entries"]
        assert {"kind": "skills", "path": ".claude/skills", "detail": "链接到项目技能"} in linked
        expect(row.get_by_text("链接到项目技能", exact=True)).to_be_visible()
        expect(row.get_by_text("尚未验证宿主加载", exact=True)).to_be_visible()
    finally:
        if skills.is_junction():
            skills.rmdir()

    buddy = project / ".codebuddy/agents/fixture.md"
    buddy.parent.mkdir(parents=True)
    buddy.write_bytes(agent.read_bytes())
    workbuddy = refresh_client(page, "WorkBuddy")
    assert {"kind": "agents", "path": ".codebuddy/agents"} in workbuddy["entries"]
    assert not (project / ".workbuddy").exists()
    assert ".codebuddy/agents" in prepare(page, "WorkBuddy")[0]


def assert_bound(prompt, project, cap, overlay):
    for label, value in [("WorkspaceRoot（工作目录）", project),
                         ("ContextRoot（本工程配置与发现入口）", project / ".agents"),
                         ("CapabilityRoot（框架脚本与规范）", cap)]:
        assert f"{label} {value}" in prompt, prompt
    assert ("这是 Overlay 模块" in prompt) == overlay


def project_check(page, project, cap, installed, overlay):
    page.get_by_role("link", name="任务与恢复", exact=True).click()
    page.get_by_role("button", name="准备工程检查请求", exact=True).click()
    prompt = page.get_by_label("接续请求").input_value()
    assert_bound(prompt, project, cap, overlay)
    if installed:
        assert str(cap / CONTEXT_SKILL) in prompt and "只读审计流程" in prompt
    else:
        assert str(cap / CONTEXT_SKILL) not in prompt and "未发现已安装" in prompt
    page.keyboard.press("Escape")
    page.get_by_role("button", name="重新读取", exact=True).click()


def task_handoffs(page, base, project, cap, personal_config, overlay):
    def read_request(button, task, item=None):
        with page.expect_response(lambda r: r.url.endswith("/framework/agent-handoff")) as generated:
            page.get_by_role("button", name=button, exact=True).click()
        response = generated.value
        assert response.ok, response.text()
        sent = response.request.post_data_json
        fields = {"purpose": "task", "task": task, "projectId": project_id}
        if item is not None:
            fields["item"] = item
        assert sent == fields
        prompt = response.json()["prompt"]
        assert_bound(prompt, project, cap, overlay)
        assert PERSONAL_SENTINEL not in prompt
        if overlay:
            assert f"WorkspaceRoot（工作目录） {cap.parent}" not in prompt
            assert f"ContextRoot（本工程配置与发现入口） {cap}" not in prompt
        dialog = page.get_by_role("dialog", name="接续到 Agent", exact=True)
        field = dialog.get_by_label("接续请求", exact=True)
        expect(field).to_have_value(prompt)
        return prompt, dialog, field

    observed = page.request.get(base + "/framework.json", headers={"X-Workbench-Request": "1"})
    assert observed.ok
    project_id = observed.json()["projectId"]
    local = project / ".agents"
    protected = [project / "AGENTS.md", cap.parent / "AGENTS.md", project / ".mcp.json", local / "capability.json",
                 local / "config/project.jsonc", personal_config,
                 cap / CONNECTION_GUIDE, cap / KNOWLEDGE_GUIDE, cap / "scripts/knowledge-query.js"]
    before = {file: file.read_bytes() if file.exists() else None for file in protected}

    page.get_by_role("link", name="使用手册", exact=True).click()
    page.get_by_role("link", name="连接信息在哪里：查看与排查", exact=True).click()
    prompt, dialog, field = read_request("生成相关请求", "manual", "connection-configuration.md")
    assert str(cap / CONNECTION_GUIDE) in prompt and "只读核对" in prompt
    page.evaluate("() => { navigator.clipboard.writeText = () => Promise.reject(new Error('fixture clipboard denied')); }")
    try:
        dialog.get_by_role("button", name="复制请求", exact=True).click()
        expect(dialog.get_by_text("剪贴板不可用，可选中文本手动复制。", exact=True)).to_be_visible()
        field.press("Control+a")
        assert field.evaluate("field => field.readOnly && field.selectionStart === 0 && field.selectionEnd === field.value.length")
    finally:
        page.evaluate("delete navigator.clipboard.writeText")
    page.keyboard.press("Escape")

    page.get_by_role("link", name="知识与向量", exact=True).click()
    prompt, _, _ = read_request("准备索引维护请求", "knowledge-index")
    assert str(cap / KNOWLEDGE_GUIDE) in prompt and str(cap / "scripts/knowledge-query.js") in prompt
    assert "--local-only" in prompt and "维护者建库与导出" in prompt and "保持共享索引与发布物原样" in prompt
    page.keyboard.press("Escape")

    headers = {"Origin": base, "X-Workbench-Request": "1"}
    session = page.request.post(base + "/framework/session", headers=headers, data={})
    assert session.ok
    headers["X-Workbench-CSRF"] = session.json()["csrf"]
    for item in ["../AGENTS.md", "connection-configuration.md\n未经授权写入"]:
        rejected = page.request.post(base + "/framework/agent-handoff", headers=headers,
                                     data={"purpose": "task", "task": "manual", "projectId": project_id, "item": item})
        assert rejected.status == 400 and rejected.json() == {"error": "invalid-action"}
    assert {file: file.read_bytes() if file.exists() else None for file in protected} == before


def exercise(browser, stage, node, project, cap, env, overlay=False, installed=True):
    with subprocess.Popen([node, "-e", LAUNCHER, project], cwd=stage, env=env,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8") as proc:
        try:
            hello = json.loads(proc.stdout.readline())
            base = hello["address"].split("#")[0].rstrip("/")
            page = browser.new_page(permissions=["clipboard-read", "clipboard-write"])
            issues = []
            page.on("pageerror", lambda error: issues.append(str(error)))
            try:
                page.goto(base + "#bootstrap=" + hello["bootstrap"])
                project_check(page, project, cap, installed, overlay)
                if installed and not overlay:
                    page.get_by_role("link", name="MCP 与连接", exact=True).click()
                    page.get_by_role("button", name="编辑连接与凭据").click()
                    page.get_by_label("人员标识").fill("fixture-updated")
                    page.get_by_role("button", name="预览修改").click()
                    page.get_by_role("button", name="保存到共享个人配置").click()
                    expect(page.get_by_text("文件已保存并读回一致", exact=False)).to_be_visible()
                    page.keyboard.press("Escape")
                    project_check(page, project, cap, installed, overlay)
                    expect(page.get_by_text("个人配置已保存并读回", exact=True)).to_be_visible()
                if installed:
                    task_handoffs(page, base, project, cap, Path(env["BOS_MCP_CONFIG"]), overlay)
                page.get_by_role("link", name="Agent 客户端", exact=True).click()
                prompt, row = prepare(page, "Claude Code")
                assert_bound(prompt, project, cap, overlay)
                assert "重新检查" in prompt
                expect(row.get_by_text("尚未验证宿主加载")).to_be_visible()
                commands = [line for line in prompt.splitlines() if line.startswith("& ")]
                if installed:
                    locations = [line for line in prompt.splitlines() if line.startswith("Set-Location ")]
                    assert len(locations) == 2 and str(project).replace("'", "''") in locations[0]
                    assert len(commands) == 2 and str(cap / "scripts/sync-runtime-skills.js").replace("'", "''") in commands[0]
                    for location, command, mode in zip(locations, commands, ["DryRun", "Check"]):
                        node_path = str(node).replace("'", "''")
                        assert command.startswith(f"& '{node_path}' "), command
                        assert command.endswith(f"--runtime ClaudeCode --mode {mode}")
                        setup = ("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); "
                                 "if (Get-Command node -ErrorAction SilentlyContinue) { throw 'Node should be absent from PATH' }; ")
                        result = subprocess.run(["powershell.exe", "-NoProfile", "-Command", setup + location + "; " + command], cwd=stage,
                                                env=env, capture_output=True, text=True, encoding="utf-8")
                        receipt = json.loads(result.stdout)
                        assert result.returncode == (0 if mode == "DryRun" else 1), receipt
                        assert receipt["status"] == "runtime-adapter-planned", receipt
                        assert Path(receipt["source"]) == project / ".agents" / "skills"
                        assert Path(receipt["target"]) == project / ".claude" / "skills"
                else:
                    assert not commands and "核对安装状态" in prompt
                assert not (project / ".claude").exists()

                observe_client_entries(page, project, cap, node, env, installed, row)
                unsupported, _ = prepare(page, "Hermes")
                assert "--runtime" not in unsupported and str(project) in unsupported
                row.get_by_role("button", name="准备接入请求").click()
                page.get_by_role("button", name="复制请求").click()
                expect(page.get_by_text("已复制，等待客户端执行。")).to_be_visible()
                copied = page.evaluate("navigator.clipboard.readText()")
                assert copied.replace("\r\n", "\n") == page.get_by_label("接续请求").input_value()
                headers = {"Origin": base, "X-Workbench-Request": "1"}
                request = {"host": "codex", "projectId": "wrong"}
                response = page.request.post(base + "/framework/agent-handoff", headers=headers, data=request)
                assert response.status == 403 and response.json()["error"] == "session-required"
                session = page.request.post(base + "/framework/session", headers=headers, data={})
                assert session.ok
                headers["X-Workbench-CSRF"] = session.json()["csrf"]
                response = page.request.post(base + "/framework/agent-handoff", headers=headers, data=request)
                assert response.status == 409 and response.json()["error"] == "binding-mismatch"
                assert not issues, issues
            finally:
                page.close()
        finally:
            proc.stdin.close()
            proc.wait(timeout=30)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--node-runtime", type=Path, help="Approved portable Node directory to include in the stage")
    source.add_argument("--archive", type=Path, help="Packaged Windows Workbench ZIP to test directly")
    args = parser.parse_args()
    assert os.name == "nt", "Windows PowerShell 5.1 and Edge are required for this pilot"
    temp = Path("D:/tmp/Codex")
    if not temp.is_dir():
        temp = Path(tempfile.gettempdir()) / "Codex"
    temp.mkdir(exist_ok=True)
    env = dict(os.environ, PORT="0", GIT_ALLOW_PROTOCOL="", GIT_NO_LAZY_FETCH="1")
    with tempfile.TemporaryDirectory(prefix="agent-handoff-", dir=temp) as directory:
        work = Path(directory).resolve()
        standard = work / "标准" / "同名 O'Neil"
        overlay = work / "成员" / standard.name
        empty, stage = work / "未安装", work / "workbench O'Neil"
        config = work / "personal-fixture.json"
        config.write_text(json.dumps({"bos-demand-query": {"cuser": "fixture", "access_key": PERSONAL_SENTINEL}}), encoding="utf-8")
        cap = deployed_fixture(standard, env)
        local = overlay / ".agents"
        create_skill(local / "skills")
        (overlay / "AGENTS.md").write_text("Fixture Overlay rules\n", encoding="utf-8")
        empty.mkdir()
        link = overlay / "source"
        subprocess.run(["node", "-e", "require('node:fs').symlinkSync(process.argv[1],process.argv[2],'junction')",
                        standard, link], check=True, env=env)
        try:
            (local / "capability.json").write_text(json.dumps({
                "schemaVersion": 1, "mode": "workspace-overlay", "workspace": "module", "contextRoot": ".agents",
                "capabilityRoot": str(cap), "sharedDirectories": [], "localDirectories": ["skills"],
                "sourceRoots": [{"name": "source", "path": "source", "target": str(standard), "gitRoot": str(standard)}],
            }), encoding="utf-8")
            if args.archive:
                with ZipFile(args.archive.resolve(strict=True)) as package:
                    release = json.loads(package.read("workbench-release.json"))
                    assert release["platform"] == "windows-x64"
                    package.extractall(stage)
                node = stage / "runtime/node.exe"
                assert subprocess.check_output([node, "--version"], text=True).strip() == f'v{release["node"]}'
            else:
                stage_args = ["--node-runtime", args.node_runtime.resolve()] if args.node_runtime else []
                subprocess.run(["node", REPO / "tools/agents-workbench/react/package-runtime.mjs", stage, *stage_args], env=env, check=True)
                node = stage / "runtime/node.exe" if args.node_runtime else Path(shutil.which("node"))
            system = Path(os.environ["SYSTEMROOT"]) / "System32"
            host_env = dict(env, BOS_MCP_CONFIG=str(config), PATH=os.pathsep.join(map(str, [
                Path(shutil.which("git")).parent, system, system / "WindowsPowerShell/v1.0",
            ])))
            host_env.pop("KNOWLEDGE_RAG_CONFIG", None)
            assert shutil.which("node.exe", path=host_env["PATH"]) is None
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel="msedge", headless=True)
                try:
                    exercise(browser, stage, node, standard, cap, host_env)
                    exercise(browser, stage, node, overlay, cap, host_env, overlay=True)
                    exercise(browser, stage, node, empty, empty / ".agents", host_env, installed=False)
                finally:
                    browser.close()
        finally:
            link.rmdir()  # Remove the test's junction itself before deleting the temp directory.
    print("PASS staged Agent handoff for same-named standard and Overlay, task requests, clipboard fallback and first use without framework")


if __name__ == "__main__":
    main()
