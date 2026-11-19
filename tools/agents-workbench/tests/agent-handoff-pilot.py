"""Exercise project-bound Agent handoff in a staged Windows Workbench."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from playwright.sync_api import expect, sync_playwright

REPO = Path(__file__).resolve().parents[3]
ORIGIN = "https://gitee.com/skyler-cook/imedical.agents.git"
CONTEXT_SKILL = "plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md"
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
                     "scripts/lib/workspace-context.js", "docs/coding-agent-adaptation.md"]:
        target = cap / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO / relative, target)
    (cap / "skills").mkdir()
    (project / "AGENTS.md").write_text("Fixture rules\n", encoding="utf-8")
    return cap


def prepare(page, host):
    row = page.get_by_role("row").filter(has=page.get_by_text(host, exact=True))
    row.get_by_role("button", name="准备接入请求").click()
    expect(page.get_by_role("dialog")).to_be_visible()
    prompt = page.get_by_label("接续请求").input_value()
    page.keyboard.press("Escape")
    return prompt, row


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

                (project / ".claude").mkdir()
                page.get_by_role("button", name="重新检查", exact=True).click()
                expect(row.get_by_text(".claude", exact=True)).to_be_visible()
                expect(row.get_by_text("尚未验证宿主加载")).to_be_visible()
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
    parser.add_argument("--node-runtime", type=Path, help="Approved portable Node directory to include in the stage")
    args = parser.parse_args()
    assert os.name == "nt", "Windows PowerShell 5.1 and Edge are required for this pilot"
    temp = Path("D:/tmp/Codex")
    if not temp.is_dir():
        temp = Path(tempfile.gettempdir()) / "Codex"
    temp.mkdir(exist_ok=True)
    env = dict(os.environ, PORT="0", GIT_ALLOW_PROTOCOL="", GIT_NO_LAZY_FETCH="1")
    with tempfile.TemporaryDirectory(prefix="agent-handoff-", dir=temp) as directory:
        work = Path(directory).resolve()
        standard, overlay, empty, stage = (work / name for name in ["标准 O'Neil", "同名模块", "未安装", "workbench O'Neil"])
        config = work / "personal-fixture.json"
        config.write_text(json.dumps({"bos-demand-query": {"cuser": "fixture"}}), encoding="utf-8")
        cap = deployed_fixture(standard, env)
        local = overlay / ".agents"
        (local / "skills").mkdir(parents=True)
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
    print("PASS staged Agent handoff for standard, Overlay and first use without framework")


if __name__ == "__main__":
    main()
