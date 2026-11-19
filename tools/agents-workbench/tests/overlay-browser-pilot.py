"""Exercise both directions of Overlay navigation from a real staged app."""
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


def main():
    app = Path(sys.argv[1]).resolve(strict=True)
    launcher = app / "tools/agents-workbench/src/start-release.js"
    unavailable_launcher = launcher.with_suffix(".fixture-disabled")
    assert not (app / ".git").exists() and launcher.is_file() and not unavailable_launcher.exists()
    startup = json.load(sys.stdin)
    url = startup["address"].partition("#")[0] + "#bootstrap=" + startup["bootstrap"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context()
        failures = []
        context.on("page", lambda page: page.on("pageerror", lambda error: failures.append(str(error))))
        root = context.new_page()
        root.goto(url)
        launch_member = root.get_by_role("button", name="打开成员工作台 模块 一", exact=True)
        launch_member.wait_for(timeout=20000)
        assert root.get_by_text("缺席模块 · 缺席，保留所需能力", exact=True).is_visible()
        assert root.get_by_role("button", name="打开成员工作台 缺席模块").count() == 0
        original = snapshot(root)

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
        with member.expect_response(lambda response: response.url.endswith("/framework/overlay/refresh"), timeout=45000) as response:
            member.get_by_role("button", name="刷新本工程", exact=True).click()
        assert response.value.status == 200, response.value.json()
        member.get_by_text("已在标准根登记。", exact=True).wait_for()
        assert snapshot(root)["revision"] == original["revision"]
        assert not failures, failures
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
