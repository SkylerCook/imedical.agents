"""Verify form preview, confirmation and framework read-back in the staged app."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from playwright.sync_api import expect, sync_playwright


REPO = Path(__file__).resolve().parents[3]
STAGER = REPO / "tools/agents-workbench/react/package-runtime.mjs"
SERVER = "tools/agents-workbench/prototype/serve.js"
CLI = REPO / "scripts/configure-agents.js"


def main():
    parent = Path(os.environ.get("AGENTS_TEST_TEMP", tempfile.gettempdir())) / "Codex"
    parent.mkdir(exist_ok=True)
    launcher = """
      const {fork}=require('node:child_process');
      const child=fork(process.argv[1],['--project',process.argv[2]],{silent:true});
      child.once('message',m=>console.log(JSON.stringify(m)));
      child.once('exit',code=>process.exit(code||0));
      process.stdin.resume();
      process.stdin.once('end',()=>child.kill());
    """
    with tempfile.TemporaryDirectory(prefix="managed-settings-", dir=parent) as temporary:
        directory = Path(temporary)
        stage, project = directory / "stage", directory / "project"
        config = project / ".agents/config/project.jsonc"
        config.parent.mkdir(parents=True)
        entry = project / ".agents/scripts/configure-agents.js"
        entry.parent.mkdir()
        entry.write_bytes(CLI.read_bytes())
        before = b'// preserve fixture note\n{"projectContext":{"contextMode":"codebase-complete"}, "custom":true}\n'
        config.write_bytes(before)
        subprocess.run(["node", STAGER, stage], cwd=REPO, check=True, capture_output=True)
        server = subprocess.Popen(["node", "-e", launcher, SERVER, project], cwd=stage,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                                  encoding="utf-8", env={**os.environ, "PORT": "0"})
        try:
            hello = json.loads(server.stdout.readline())
            address = hello["address"].split("#")[0] + "#bootstrap=" + hello["bootstrap"]
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel="msedge", headless=True)
                page = browser.new_page(viewport={"width": 1060, "height": 750})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(address)
                page.get_by_role("link", name="工程配置", exact=True).click()
                summary = page.locator("summary").filter(has_text=re.compile("^工程上下文$"))
                summary.click()
                mode = page.get_by_role("combobox", name=re.compile("上下文模式"))
                expect(mode).to_have_value("codebase-complete")
                mode.select_option("intent-first-on-demand-export")
                page.get_by_role("button", name="预览修改", exact=True).click()
                expect(page.get_by_text("将保存到 project.jsonc", exact=True)).to_be_visible()
                assert config.read_bytes() == before
                page.get_by_role("button", name="确认保存", exact=True).click()
                expect(page.get_by_text("已保存并读回配置。", exact=True)).to_be_visible()
                result = subprocess.check_output(["node", CLI, "read", project], encoding="utf-8")
                row = next(row for row in json.loads(result)["sections"] if row["id"] == "projectContext")
                assert row["value"]["contextMode"] == "intent-first-on-demand-export"
                assert b"// preserve fixture note" in config.read_bytes()
                assert not errors, errors
                browser.close()
        finally:
            server.stdin.close()
            try:
                server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
    print("Staged Workbench form preview, apply, and framework read-back passed.")


if __name__ == "__main__":
    main()
