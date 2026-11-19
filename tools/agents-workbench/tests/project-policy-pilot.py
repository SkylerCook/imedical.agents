"""Isolated Windows acceptance for the project policy and the production React build."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from playwright.sync_api import sync_playwright
import connection_profiles_pilot as profiles

REPO = Path(__file__).resolve().parents[3]
ORIGIN = "https://gitee.com/skyler-cook/imedical.agents.git"


def run(*args, cwd=None, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env, text=True, encoding="utf-8", errors="replace")


def exercise(work, interactive=False, after_staging=None, extra_paths=(), before_upgrade=None):
    project, mirror, stage = (work / name for name in ["隔离 工程", "mirror", "stage"])
    project.mkdir()
    run("git", "clone", "-q", "--shared", "--no-checkout", REPO, mirror)
    run("git", "read-tree", "HEAD", cwd=mirror)
    paths = ["scripts/lib/iris-development-settings.js","scripts/lib/project-plugin-profile.js","scripts/refresh-agents-sparse.js","scripts/migrate-demand-ownership.js","scripts/resolve-plugin-skill-dependencies.ps1","scripts/check-plugin-availability.js","scripts/lib/project-directories.js","scripts/lib/project-deployment-policy.js", "scripts/lib/configuration-file-io.js",
             "scripts/lib/plugin-deployment.js", "scripts/plugin-deploy.js", "scripts/update-agents.ps1",
             "scripts/update-plugin-profile.ps1", "vendor/jsonc-parser"]
    owner = "plugins/coding-iris-plugin/scripts/iris-tools/"
    paths += ["scripts/lib/iris-selected-target.js","scripts/lib/iris-session-migration.js",owner+"sync-env-config.js","vendor/iarna-toml"]
    paths += ["scripts/lib/iris-remote-operations.js","scripts/lib/iris-session-client.js","scripts/lib/iris-session-backends.js",
              "scripts/lib/iris-profile-verification.js","scripts/lib/iris-session-manager.js","scripts/iris-session-host.js","scripts/iris-mcp.js",
              owner+"development-config.js", owner+"source-sync-core.js", owner+"source-publication.js"]
    paths=list(dict.fromkeys(paths+list(extra_paths)))
    for relative in paths:
        target = mirror / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if (REPO / relative).is_dir():
            shutil.copytree(REPO / relative, target,dirs_exist_ok=True)
        else:
            shutil.copyfile(REPO / relative, target)
    run("git", "add", "--", *paths, cwd=mirror)
    run("git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false",
        "-c", "core.hooksPath=disabled", "commit", "-qm", "Fixture runtime", cwd=mirror)
    env = dict(os.environ, PORT="0", GIT_ALLOW_PROTOCOL="file", GIT_CONFIG_COUNT="1",
               GIT_CONFIG_KEY_0=f"url.{mirror.as_uri()}.insteadOf", GIT_CONFIG_VALUE_0=ORIGIN)
    for name in ["BOS_MCP_CONFIG", "KNOWLEDGE_RAG_CONFIG", "IMEDICAL_DEPLOYMENT_LOCK"]:
        env.pop(name, None)
    env["PSModulePath"] = str(Path(os.environ["SYSTEMROOT"]) / "System32/WindowsPowerShell/v1.0/Modules")
    cap = project / ".agents"
    ps = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]
    # Fetch through the updater actually installed at the previous release.
    target = run("git", "rev-parse", "HEAD", cwd=mirror).strip()
    baseline = run("git", "rev-parse", "e943fc29^{commit}", cwd=mirror).strip()
    legacy_project = work / "旧版工程"
    legacy_project.mkdir()
    run("git", "init", "-q", cwd=legacy_project)
    run("git", "update-ref", "HEAD", baseline, target, cwd=mirror)
    bootstrap = work / "old-install.ps1"
    bootstrap.write_bytes(subprocess.check_output(["git", "-C", mirror, "show", baseline + ":scripts/install-agents.ps1"]))
    run(*ps, bootstrap, cwd=legacy_project, env=env)
    legacy_cap = legacy_project / ".agents"
    assert run("git", "rev-parse", "HEAD", cwd=legacy_cap).strip() == baseline
    assert (legacy_cap / "config/plugin-deployment.json").exists()
    run(*ps, legacy_cap / "scripts/update-agents.ps1", "-ProjectRoot", legacy_project, "-Mode", "Write", "-NoPull",
        cwd=legacy_project, env=env)
    legacy_profile = legacy_cap / "config/plugin_profile.md"
    run("node", legacy_cap/"scripts/plugin-deploy.js","ensure","--explicit","--project-root",legacy_project,"--plugin","coding-iris-plugin")
    legacy_dev = legacy_cap/"config/iris-development.json"
    legacy_dev.write_text(json.dumps({"developmentMode":"offline","environmentAlias":"fixture","environmentType":"test"}))
    (legacy_project/".gitignore").write_text(".agents/\n")
    run(*ps,legacy_cap/"scripts/update-plugin-profile.ps1","-ProjectRoot",legacy_project,"-Plugin","coding-iris-plugin","-Status","enabled",env=env)
    assert legacy_profile.is_file()
    connection_owner = REPO / "tools/ai-dev-offline/configure-project.js"
    initial_credentials = profiles.seed(connection_owner,legacy_project)
    if before_upgrade:
        before_upgrade(legacy_project,env)
    legacy_scripts = work / "previous-runtime/scripts"
    shutil.copytree(legacy_cap / "scripts",legacy_scripts)
    run("git", "update-ref", "HEAD", target, baseline, cwd=mirror)
    run(*ps, legacy_cap / "scripts/update-agents.ps1", "-ProjectRoot", legacy_project, "-Mode", "Write", "-Plugin", "coding-iris-plugin",
        cwd=legacy_project, env=env)
    assert run("git", "rev-parse", "HEAD", cwd=legacy_cap).strip() == target
    profiles.check_previous_client(legacy_scripts,legacy_cap / "scripts", work / "session-ipc")
    assert (legacy_cap / "config/project.jsonc").exists() and not (legacy_cap / "config/plugin-deployment.json").exists()
    assert not legacy_profile.exists() and not legacy_dev.exists()
    legacy_main = json.loads((legacy_cap / "config/project.jsonc").read_text("utf-8-sig"))
    assert legacy_main["irisDevelopment"]["developmentMode"] == "offline"
    assert legacy_main["plugins"]["agent-context-kit"]["status"] == "enabled"
    run("git", "init", "-q", cwd=project)
    run(*ps, REPO / "scripts/install-agents.ps1", cwd=project, env=env)
    main = cap / "config/project.jsonc"
    old = cap / "config/plugin-deployment.json"
    assert main.exists() and not old.exists()
    cli = ["node", cap / "scripts/plugin-deploy.js"]
    roots = ["--context-root", cap, "--capability-root", cap]
    run(*ps, cap / "scripts/update-agents.ps1", "-ProjectRoot", project, "-Mode", "Write", "-NoPull", cwd=project, env=env)
    run(*cli, "rollback-project", "--project-root", project)
    assert (cap / "config/plugin_profile.md").exists()
    assert json.loads(old.read_text())["autoInstall"] is False
    extra = '  // keep project fields\n  "extra": {"nested": 17}'
    main.write_text('{\n' + extra + '\n}\n', encoding="utf-8")
    update = [*ps, cap / "scripts/update-agents.ps1", "-ProjectRoot", project, "-Mode", "Write", "-NoPull"]
    run(*update, cwd=project, env=env)
    assert not old.exists() and extra in main.read_text("utf-8")
    previous = main.read_bytes()
    run(*update, cwd=project, env=env)
    assert main.read_bytes() == previous and not old.exists()
    (project/".gitignore").write_text(".agents/\n")
    run(*cli,"ensure","--explicit","--project-root",project,"--plugin","coding-iris-plugin")
    source_sync=cap/"plugins/coding-iris-plugin/scripts/iris-tools/source-sync.js"
    run("node",source_sync,"configure","--project-root",project,"--mode","Write","--development-mode","offline","--environment-alias","fixture","--environment-type","test")
    run("node", REPO / "tools/agents-workbench/react/package-runtime.mjs", stage)
    launcher = """const c=require('node:child_process').fork('tools/agents-workbench/prototype/serve.js',
      ['--project',process.argv[1]],{silent:true});c.on('message',m=>console.log(JSON.stringify(m)));
      process.stdin.resume().once('end',()=>c.kill());c.on('exit',()=>process.exit());"""
    if after_staging:
        return after_staging(work,stage,project,legacy_project,mirror,env,launcher)
    legacy_server = subprocess.Popen(["node","-e",launcher,legacy_project],cwd=stage,env=env,
                                    stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    try:
        hello=json.loads(legacy_server.stdout.readline())
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel="msedge",headless=not interactive)
            page=browser.new_page()
            errors=[]
            page.on("pageerror",lambda e:errors.append(str(e)))
            page.on("response",lambda r:errors.append(f"HTTP {r.status} {r.url.split('?')[0]}")
                    if r.status>=400 and not (r.status==409 and r.url.endswith("/settings/apply")) else None)
            page.goto(hello["address"].split("#")[0]+"#bootstrap="+hello["bootstrap"])
            profiles.exercise(page,connection_owner,legacy_project,initial_credentials)
            assert not errors, errors
            if interactive:
                page.reload()
                print(f"隔离工程 {legacy_project} 已有 current 和 devB 两份档案。按 Enter 结束试用并清理。",flush=True)
                input()
            browser.close()
    finally:
        legacy_server.stdin.close()
        legacy_server.wait(timeout=30)
    proc = subprocess.Popen(["node", "-e", launcher, project], cwd=stage, env=env,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        hello = json.loads(proc.stdout.readline())
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(hello["address"].split("#")[0] + "#bootstrap=" + hello["bootstrap"])
            page.get_by_role("link", name="工程配置", exact=True).click()
            page.get_by_role("button", name="编辑工程连接").click()
            field = page.get_by_label("允许自动补装插件")
            assert field.input_value() == "false"
            field.select_option("true")
            page.get_by_role("button", name="预览修改").click()
            page.get_by_role("button", name="保存到当前工程").click()
            page.get_by_text("工程部署策略已保存并读回", exact=False).wait_for()
            assert json.loads(run(*cli, "read-policy", *roots))["autoInstall"] is True
            run(*cli, "configure", "--project-root", project, "--auto-install", "false")
            original = json.loads(run(*cli, "read-policy", *roots))
            run(*ps, cap / "scripts/update-plugin-profile.ps1", "-ProjectRoot", project, "-Plugin", "agent-framework-evolution", "-Status", "disabled", cwd=project, env=env)
            assert json.loads(run(*cli, "read-policy", *roots)) == original
            assert not (cap / "config/plugin_profile.md").exists()
            listed = json.loads(run(*cli, "list", "--project-root", project))
            assert any(row["name"] == "agent-framework-evolution" and row["status"] == "disabled" for row in listed)
            page.reload()
            assert field.input_value() == "false"
            assert extra in main.read_text("utf-8") and not old.exists()
            alias=page.locator('[name="irisDevelopment.environmentAlias"]')
            assert alias.input_value()=="fixture"
            alias.fill("fixture-next")
            page.get_by_role("button", name="预览修改").click()
            page.get_by_role("button", name="保存到当前工程").click()
            page.get_by_text("工程开发声明已保存并读回",exact=False).wait_for()
            run("node",source_sync,"configure","--project-root",project,"--mode","Check","--development-mode","offline","--environment-alias","fixture-next")
            page.keyboard.press("Escape")
            page.get_by_role("link", name="插件", exact=True).click()
            page.get_by_role("table", name="插件目录").get_by_text("已停用", exact=True).wait_for()
            assert not errors, errors
            browser.close()
    finally:
        proc.stdin.close()
        proc.wait(timeout=30)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--try", dest="interactive", action="store_true", help="保留隔离项目的浏览器窗口供手动试用，按 Enter 清理")
    options = parser.parse_args()
    parent = Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir()) / "Codex"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workbench-policy-", dir=parent, ignore_cleanup_errors=False) as temp:
        exercise(Path(temp),options.interactive)
    print("Passed historical update, A/B/A profile switching, conflict recovery, IPC compatibility, packaged UI and CLI readback")
