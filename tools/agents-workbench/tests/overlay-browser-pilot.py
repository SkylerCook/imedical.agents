"""Verify staged Overlay navigation and copying the correctly scoped update prompt."""
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


def origin(page):
    return urlsplit(page.url).netloc


def snapshot(page):
    return page.evaluate("""async () => (await fetch("/framework.json", {
        headers: {"X-Workbench-Request": "1"}
    })).json()""")


def session(page):
    response = page.evaluate("""async () => {
      const response = await fetch("/framework/session", {
        method: "POST", headers: {"X-Workbench-Request": "1", "Content-Type": "application/json"}, body: "{}"
      });
      return {status: response.status, result: await response.json()};
    }""")
    assert response["status"] == 200, response
    return response["result"]["csrf"]


def copy_update_prompt(page):
    page.get_by_role("button", name="复制更新提示词", exact=True).click(timeout=30000)
    page.get_by_text("已复制。请粘贴到当前工程的 Agent 会话，完成后重新读取。", exact=True).wait_for()
    return page.evaluate("navigator.clipboard.readText()")


def main():
    app = Path(sys.argv[1]).resolve(strict=True)
    launcher = app / "tools/agents-workbench/src/start-release.js"
    unavailable_launcher = launcher.with_suffix(".fixture-disabled")
    assert not (app / ".git").exists() and launcher.is_file() and not unavailable_launcher.exists()
    startup = json.load(sys.stdin)
    url = startup["address"].partition("#")[0] + "#bootstrap=" + startup["bootstrap"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(permissions=["clipboard-read", "clipboard-write"])
        failures = []
        context.on("page", lambda page: page.on("pageerror", lambda error: failures.append(str(error))))
        root = context.new_page()
        root.goto(url)
        launch_member = root.get_by_role("button", name="打开成员工作台 模块 一", exact=True)
        launch_member.wait_for(timeout=20000)
        assert root.get_by_text("缺席模块 · 暂不可用", exact=True).is_visible()
        assert root.get_by_role("button", name="打开成员工作台 缺席模块").count() == 0
        original = snapshot(root)
        assert root.get_by_role("button", name="获取新版并预演", exact=True).count() == 0
        assert root.get_by_role("button", name="应用更新并复查", exact=True).count() == 0
        root_prompt = copy_update_prompt(root)
        assert original["revision"] in root_prompt and "框架更新手册" in root_prompt
        assert "已登记的 Overlay 成员如下" in root_prompt
        assert "模块 一" in root_prompt and "模块 二" in root_prompt
        assert "DryRun -NoPull" in root_prompt and "Check -NoPull" in root_prompt

        launcher.rename(unavailable_launcher)
        try:
            with root.expect_response(lambda response: response.url.endswith("/framework/overlay/open")) as response:
                launch_member.click()
            assert response.value.status == 409, response.value.json()
            root.get_by_text("目标工作台启动失败。当前窗口可继续使用。", exact=True).wait_for()
            assert snapshot(root)["projectId"] == original["projectId"]
        finally:
            unavailable_launcher.rename(launcher)

        with root.expect_popup() as popup:
            launch_member.click()
        member = popup.value
        member_to_root = member.get_by_role("button", name="打开标准根工作台", exact=True)
        member_to_root.wait_for(timeout=20000)
        assert member.evaluate("window.opener === null")
        own = snapshot(member)
        assert own["name"] == "模块 一" and own["status"] == "overlay-declared"
        assert own["projectId"] != original["projectId"]
        assert origin(member) != origin(root)
        assert member.get_by_role("button", name="刷新本工程", exact=True).count() == 0
        member_prompt = copy_update_prompt(member)
        owner = json.dumps(own["overlay"]["standardRoot"], ensure_ascii=False)
        assert f"所属标准根：{owner}" in member_prompt
        assert "当前成员 ContextRoot" in member_prompt and "模块 一" in member_prompt
        assert "模块 二" not in member_prompt and original["revision"] in member_prompt
        assert "Write -NoPull" in member_prompt and "Check -NoPull" in member_prompt

        root_csrf, member_csrf = session(root), session(member)
        assert root_csrf != member_csrf
        assert member.evaluate("""async ([csrf, projectId]) => (await fetch("/framework/action", {
          method: "POST", headers: {
            "X-Workbench-Request": "1", "X-Workbench-CSRF": csrf, "Content-Type": "application/json"
          },
          body: JSON.stringify({action: "refresh", projectId, revision: null})
        })).status""", [root_csrf, own["projectId"]]) == 403
        assert snapshot(root)["projectId"] == original["projectId"]
        names = {cookie["name"] for cookie in context.cookies()}
        assert {f"wb-{original['projectId']}", f"wb-{own['projectId']}"} <= names

        with member.expect_popup() as popup:
            member_to_root.click()
        returned = popup.value
        returned.get_by_role("button", name="打开成员工作台 模块 一", exact=True).wait_for(timeout=20000)
        returned_state = snapshot(returned)
        assert returned_state["binding"] == original["binding"]
        assert returned_state["projectId"] != original["projectId"]
        assert len({origin(root), origin(member), origin(returned)}) == 3
        returned.evaluate("""() => Object.defineProperty(navigator.clipboard, "writeText", {
          value: async () => { throw new Error("fixture denied clipboard"); }
        })""")
        returned.get_by_role("button", name="复制更新提示词", exact=True).click(timeout=30000)
        manual = returned.get_by_role("textbox", name="更新提示词", exact=True)
        manual_prompt = manual.input_value()
        # The Windows clipboard can normalize text to CRLF.
        assert manual_prompt.replace("\r\n", "\n") == root_prompt.replace("\r\n", "\n")
        assert snapshot(root)["revision"] == original["revision"]
        assert snapshot(member)["revision"] == own["revision"]
        assert not failures, failures
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
