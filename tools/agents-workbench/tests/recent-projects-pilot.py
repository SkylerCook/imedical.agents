"""Exercise the packaged Windows launcher and project menu with isolated recent-project history."""

import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


PRELOAD = r"""
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const source = path.join(process.env.PROJECT_PILOT_APP, 'tools/agents-workbench/src');
const openBrowser = async address => {
  fs.appendFileSync(process.env.PROJECT_PILOT_BROWSER, JSON.stringify(address) + '\n');
  return true;
};
const originalFork = cp.fork;
cp.fork = function (file, ...args) {
  const workbench = path.resolve(file) === path.join(source, 'start-release.js');
  if (workbench && Array.isArray(args[1]?.stdio)) {
    const log = fs.openSync(process.env.PROJECT_PILOT_DIAGNOSTICS, 'a');
    try {
      const child = originalFork.call(this, file, args[0], {...args[1], stdio:['ignore',log,log,'ipc']});
      if (child.pid) fs.appendFileSync(process.env.PROJECT_PILOT_CHILDREN, String(child.pid) + '\n');
      return child;
    } finally { fs.closeSync(log); }
  }
  const child = originalFork.call(this, file, ...args);
  if (workbench && child.pid) {
    fs.appendFileSync(process.env.PROJECT_PILOT_CHILDREN, String(child.pid) + '\n');
  }
  return child;
};
require(path.join(source, 'release-launcher')).openBrowser = openBrowser;
const opener = require(path.join(source, 'project-open'));
const create = opener.createProjectOpener;
opener.createProjectOpener = (root, options) => create(root, {
  ...options,
  pickFolder: async () => JSON.parse(fs.readFileSync(process.env.PROJECT_PILOT_CHOICE, 'utf8')),
  openBrowser,
});
"""


def exercise(app, work):
    first = work / "甲" / "同名工程"
    second = work / "乙" / "同名工程"
    fresh = work / "新工程"
    for project in (first, second, fresh):
        project.mkdir(parents=True)
    node = app / "runtime/node.exe"
    source = app / "tools/agents-workbench/src"
    preload, picker, opened, children = (work / name for name in ("preload.cjs", "choice.json", "opened.jsonl", "children.txt"))
    diagnostics = work / "workbench.log"
    preload.write_text(PRELOAD, encoding="utf8")
    home = work / "LocalAppData"
    home.mkdir()
    env = {key: value for key, value in os.environ.items()
           if key.upper() not in {"NODE_OPTIONS", "WORKBENCH_STARTUP_PARENT", "WORKBENCH_BACKGROUND", "WORKBENCH_TRACK_PROJECTS"}}
    env.update(LOCALAPPDATA=str(home), PORT="0", GIT_ALLOW_PROTOCOL="", PROJECT_PILOT_APP=str(app),
               PROJECT_PILOT_BROWSER=str(opened), PROJECT_PILOT_CHILDREN=str(children), PROJECT_PILOT_CHOICE=str(picker),
               PROJECT_PILOT_DIAGNOSTICS=str(diagnostics), NODE_OPTIONS=f'--require="{preload.as_posix()}"')
    system_ps = Path(os.environ["SYSTEMROOT"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    lookup = [node, source / "start-release.js", "--recent-project"]
    read_latest = lambda: subprocess.check_output(lookup, env=env, text=True, encoding="utf8").strip()
    assert read_latest() == ""
    subprocess.run([node, "-e", "Promise.resolve(require(process.argv[1]).rememberProject(process.argv[2])).catch(e=>{throw e})",
                    source / "recent-projects.js", first], env=env, check=True, timeout=10)
    assert read_latest()

    def urls():
        return [json.loads(line) for line in opened.read_text(encoding="utf8").splitlines()]

    def stop_projects(pids):
        if not pids:
            return
        subprocess.run([system_ps, "-NoProfile", "-NonInteractive", "-Command", r"""
$ErrorActionPreference = 'Stop'
foreach ($value in ($env:PROJECT_PILOT_STOP_PIDS -split ',')) {
    $child = Get-Process -Id ([int]$value) -ErrorAction SilentlyContinue
    if ($child -and $child.Path -eq $env:PROJECT_PILOT_NODE -and -not $child.HasExited) {
        try { $child.Kill() }
        catch { if (-not $child.HasExited) { throw } }
        if (-not $child.WaitForExit(5000)) { throw 'Test workbench did not exit' }
    }
}
exit 0
"""], env={**env, "PROJECT_PILOT_STOP_PIDS": ",".join(pids), "PROJECT_PILOT_NODE": str(node)},
                       check=True, timeout=15)

    def same_project_menu(page):
        return page.get_by_role("button", name="工程菜单，同名工程", exact=True)

    def menu_action(page, name, path=None):
        same_project_menu(page).press("Enter")
        if path is None:
            action = page.get_by_role("menuitem", name=name, exact=True)
        else:
            action = page.get_by_role("menuitem", name=name).filter(has_text=str(path))
        expect(action).to_be_visible()
        with page.expect_response(lambda response: urlsplit(response.url).path == "/framework/projects"
                                  and response.request.post_data_json.get("action") != "list") as pending:
            action.click()
        return pending.value

    powershell = None
    try:
        with diagnostics.open("ab") as output:
            powershell = subprocess.Popen([system_ps, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File",
                                          app / "start-workbench.ps1"], cwd=app, env=env, stdout=output, stderr=output)
            try:
                powershell.wait(timeout=35)
            except subprocess.TimeoutExpired as error:
                raise AssertionError(f"Launcher did not exit. Browser opened: {opened.exists()}. "
                                     f"Child started: {children.exists()}. {diagnostics.read_text(encoding='utf8', errors='replace')}") from error
        assert powershell.returncode == 0, diagnostics.read_text(encoding="utf8", errors="replace")
        assert len(urls()) == 1
        original_child = children.read_text().splitlines()[0]

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            try:
                context = browser.new_context(viewport={"width": 1280, "height": 800})
                page = context.new_page()
                page_errors = []
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                origin = urlsplit(urls()[0])
                base = f"{origin.scheme}://{origin.netloc}"
                request_headers = {"Origin": base, "Content-Type": "application/json", "X-Workbench-Request": "1"}
                private = context.request.post(base + "/framework/projects", data={"action": "list"}, headers=request_headers)
                assert private.status == 403
                with page.expect_response(lambda response: urlsplit(response.url).path == "/framework/session" and response.ok) as session:
                    page.goto(urls()[0])
                expect(same_project_menu(page)).to_be_visible()
                authorized = {**request_headers, "X-Workbench-CSRF": session.value.json()["csrf"]}
                arbitrary = context.request.post(base + "/framework/projects", data={"action": "open", "path": str(second)}, headers=authorized)
                assert arbitrary.status == 400

                def choose(project):
                    picker.write_text(json.dumps(str(project) if project else None), encoding="utf8")
                    response = menu_action(page, "打开工程…")
                    assert response.ok, response.text()
                    return response.json()["state"]

                assert choose(first) == "current"
                assert choose(None) == "cancelled"
                assert len(urls()) == 1
                assert choose(second) == "opened"
                expect(page.get_by_text("已在新页签打开工程。", exact=True)).to_be_visible()
                second_page = context.new_page()
                second_page.goto(urls()[-1])
                assert urlsplit(second_page.url).netloc != origin.netloc
                expect(same_project_menu(second_page)).to_be_visible()

                response = menu_action(page, "同名工程", second)
                assert response.ok and response.json()["state"] == "opened"
                historical = context.new_page()
                historical.goto(urls()[-1])
                expect(same_project_menu(historical)).to_be_visible()

                assert choose(fresh) == "opened"
                fresh_page = context.new_page()
                fresh_page.goto(urls()[-1])
                expect(fresh_page.get_by_role("button", name="工程菜单，新工程", exact=True)).to_be_visible()
                expect(fresh_page.get_by_role("button", name="安装基础框架", exact=True)).to_be_visible()
                page.close()
                stop_projects([original_child])
                fresh_page.reload()
                expect(fresh_page.get_by_role("button", name="工程菜单，新工程", exact=True)).to_be_visible()
                assert not page_errors, page_errors
                assert len(urls()) == 4
            finally:
                browser.close()

        assert Path(base64.b64decode(read_latest()).decode("utf8")) == fresh
        fresh.rename(work / "项目已移动")
        assert read_latest() == ""
    finally:
        if powershell is not None and powershell.poll() is None:
            powershell.kill()
            powershell.wait(timeout=5)
        if children.exists():
            stop_projects(list(reversed(list(dict.fromkeys(children.read_text().splitlines())))))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    args = parser.parse_args()
    root = Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir()) / "Codex"
    root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workbench-recent-projects-", dir=root) as workspace:
        exercise(args.app.resolve(strict=True), Path(workspace))
    print("PASS startup reopens last project, authenticated history, current/cancelled selection, independent new project and moved-folder fallback")
