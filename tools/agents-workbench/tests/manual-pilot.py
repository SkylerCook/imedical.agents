"""Verify staged Workbench handbooks in Windows Edge using local fixtures."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import parse_qs, quote, urlencode, urlsplit

from playwright.sync_api import expect, sync_playwright


REPO = Path(__file__).resolve().parents[3]
FILE = "本地 验收手册.md"
SECOND_FILE = "另一本 手册.md"
EXTERNAL = "https://manual-fixture.invalid/reference"
PRIVATE = "project-private-manual-search-fixture-75113d"
BODY_TERM = "离线正文信号"
FIRST_BODY = f"{BODY_TERM}只在第一份手册的正文出现。"
SECOND_BODY = f"{BODY_TERM}只在第二份手册的正文出现。" + "用于验证长段落换行和跳转。" * 65
CODE_TERM = "WorkbenchManual[FixtureMode]"
CODE_LINE = f"Write-Output '{CODE_TERM}'"
CODE = "Write-Output '本地手册夹具'\n## 代码内的标题\n# " + "long-line-" * 30 + "\n" + CODE_LINE
SOURCE = f"""# 本地验收手册

<script id="fixture-script"></script>
<iframe src="https://manual-fixture.invalid/frame"></iframe>
<form action="/settings/plan/project" method="post"><button>提交夹具</button></form>
<img src="https://manual-fixture.invalid/html-image" onload="void(0)">
<link rel="prefetch" href="https://manual-fixture.invalid/prefetch">

![外部附图](https://manual-fixture.invalid/markdown-image)
![本机附图](/settings/project)
[脚本地址](javascript:void%280%29)
[工程私有配置](../../.mcp.json)
[任务私有文件](../../work/private.md)
[越界手册](../../%2emcp.json)
[工作台接口](/settings/project)
[公开资料]({EXTERNAL})
[中文章节](#中文小节)

| 字段 | 说明 |
| --- | --- |
| 参数 | `本机` |

```powershell
{CODE}
```

## 中文小节

[同目录中文路径](另一本%20手册.md#下一节)

## 中文小节

{FIRST_BODY}
""" + "\n\n".join(f"滚动占位段落 {number}。" for number in range(36))
SECOND_SOURCE = "# 第二份验收手册\n\n## 下一节\n\n第二份本地资料。\n\n" + "\n\n".join(
    f"定位测试前置段落 {number}。" for number in range(30)
) + f"\n\n{SECOND_BODY}\n"
LAUNCHER = """
const child = require('node:child_process').fork('tools/agents-workbench/prototype/serve.js',
  ['--project', process.argv[1]], {silent:true});
child.once('message', message => console.log(JSON.stringify(message)));
child.stderr.pipe(process.stderr);
process.stdin.resume().once('end', () => child.kill());
child.once('exit', code => process.exit(code || 0));
"""


def exercise_search(page, base, article):
    search = page.get_by_label("搜索手册", exact=True)
    results = page.get_by_role("list", name="手册搜索结果", exact=True)
    links = results.get_by_role("link")
    endpoint = base + "/manuals/search?"
    headers = {"X-Workbench-Request": "1"}
    body_lines = {FILE: SOURCE.splitlines().index(FIRST_BODY) + 1,
                  SECOND_FILE: SECOND_SOURCE.splitlines().index(SECOND_BODY) + 1}
    body_url = endpoint + urlencode({"q": BODY_TERM})
    assert not page.request.get(body_url).ok
    body = page.request.get(body_url, headers=headers).json()
    assert not body["truncated"]
    assert {match["file"]: match["line"] for match in body["matches"]} == body_lines
    assert {match["file"]: match["section"] for match in body["matches"]} == {FILE: "中文小节", SECOND_FILE: "下一节"}
    assert all(BODY_TERM in match["excerpt"] and BODY_TERM not in match["title"] for match in body["matches"])

    def focused_result(doc, line, anchor_line):
        anchor = article.locator(f'[data-guide-line="{anchor_line}"]')
        expect(anchor).to_be_focused()
        expect(anchor).to_be_in_viewport()
        query = parse_qs(urlsplit(page.url).fragment.split("?", 1)[1])
        assert query["doc"] == [doc] and query["line"] == [str(line)], query
        return anchor

    search.fill(BODY_TERM)
    expect(links).to_have_count(2)
    results.get_by_role("link", name="第二份验收手册", exact=False).press("Enter")
    paragraph = focused_result(SECOND_FILE, body_lines[SECOND_FILE], body_lines[SECOND_FILE])
    expect(paragraph).to_have_text(SECOND_BODY)
    assert paragraph.evaluate("element => element.getBoundingClientRect().height > parseFloat(getComputedStyle(element).lineHeight)")

    code_query = CODE_TERM.lower()
    code_line = SOURCE.splitlines().index(CODE_LINE) + 1
    block_line = SOURCE.splitlines().index("```powershell") + 1
    search.fill(code_query)
    expect(links).to_have_count(1)
    expect(links.first).to_contain_text(CODE_TERM)
    links.first.press("Enter")
    expect(focused_result(FILE, code_line, block_line)).to_contain_text(CODE_LINE)

    private = page.request.get(endpoint + urlencode({"q": PRIVATE}), headers=headers).json()
    assert private == {"matches": [], "truncated": False}
    search.fill(PRIVATE)
    expect(page.get_by_text("没有匹配内容", exact=True)).to_be_visible()
    expect(links).to_have_count(0)

    # Hold the actual old response across the new query, even if the client aborts its fetch.
    page.evaluate("""query => {
      const original = window.fetch;
      window.fetch = async (resource, options) => {
        const url = new URL(typeof resource === 'string' ? resource : resource.url, location.href);
        if (url.pathname !== '/manuals/search' || url.searchParams.get('q') !== query) return original(resource, options);
        const response = await original(resource, { ...options, signal: undefined });
        await response.clone().text();
        await new Promise(resolve => {
          window.manualPilotRelease = () => { window.fetch = original; resolve(); };
          document.documentElement.dataset.manualPilotHeld = 'true';
        });
        return response;
      };
    }""", code_query)
    search.fill(code_query)
    expect(page.locator("html")).to_have_attribute("data-manual-pilot-held", "true")
    search.fill(BODY_TERM)
    expect(links).to_have_count(2)
    page.evaluate("""async () => {
      window.manualPilotRelease();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }""")
    expect(links).to_have_count(2)
    assert CODE_TERM not in results.inner_text()

    page.goto(base + "/#manual?" + urlencode({"doc": FILE, "section": "中文小节-1"}))
    first = article.locator('[id="中文小节"]')
    duplicate = article.locator('[id="中文小节-1"]')
    expect(first).to_have_text("中文小节")
    expect(duplicate).to_have_text("中文小节")
    expect(duplicate).to_be_focused()


def exercise(hello, linked):
    base = hello["address"].split("#")[0].rstrip("/")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800},
                                      permissions=["clipboard-read", "clipboard-write"])
        outside = []

        def intercept(route):
            if route.request.url.startswith(base + "/"):
                route.continue_()
            else:
                outside.append((route.request.url, route.request.headers.get("referer")))
                route.fulfill(status=200, content_type="text/plain", body="Explicit link test")

        context.route("**/*", intercept)
        page = context.new_page()
        errors, console, requests = [], [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: console.append(message.text) if message.type == "error" else None)
        page.on("request", lambda request: requests.append((request.method, urlsplit(request.url).path)))
        entry = page.goto(base + "/#bootstrap=" + hello["bootstrap"])
        csp = entry.headers["content-security-policy"]
        assert "form-action 'none'" in csp and "frame-src 'none'" in csp
        page.get_by_role("link", name="使用手册", exact=True).press("Enter")
        page.get_by_role("link", name="本地验收手册", exact=True).press("Enter")
        article = page.get_by_role("article")
        expect(article.get_by_role("heading", name="本地验收手册")).to_be_visible()
        expect(article.get_by_text("外部附图（图片未加载）", exact=True)).to_be_visible()
        expect(article.get_by_role("table")).to_be_visible()
        assert article.locator("script, form, iframe, img, link, [onload]").count() == 0
        assert article.get_by_role("link").count() == 3
        assert not outside, outside
        assert not any(path.startswith("/settings/") for _, path in requests), requests

        for width in (1280, 1920):
            page.set_viewport_size({"width": width, "height": 800})
            assert page.evaluate("document.documentElement.scrollWidth === window.innerWidth"), width
            expect(article.get_by_role("button", name="复制代码")).to_be_visible()

        catalog = page.get_by_role("complementary", name="手册目录")
        outline = page.get_by_role("navigation", name="本文大纲")
        sections = outline.get_by_role("link", name="中文小节", exact=True)
        expect(sections).to_have_count(2)
        assert outline.get_by_text("代码内的标题", exact=True).count() == 0
        assert outline.bounding_box()["x"] > article.bounding_box()["x"]
        sections.nth(1).press("Enter")
        expect(article.locator('[id="中文小节-1"]')).to_be_focused()
        expect(sections.nth(1)).to_have_attribute("aria-current", "location")
        page.wait_for_function("window.scrollY > 200")
        assert 0 <= catalog.bounding_box()["y"] <= 20
        assert 0 <= outline.bounding_box()["y"] <= 20
        expect(catalog.get_by_label("搜索手册")).to_be_in_viewport()

        page.set_viewport_size({"width": 390, "height": 800})
        toggle = outline.get_by_role("button", name="本文大纲", exact=True)
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(sections.first).to_be_hidden()
        toggle.press("Enter")
        expect(sections.first).to_be_visible()
        sections.first.press("Enter")
        expect(article.locator('[id="中文小节"]')).to_be_focused()
        expect(toggle).to_have_attribute("aria-expanded", "false")
        assert page.evaluate("document.documentElement.scrollWidth === window.innerWidth")
        page.set_viewport_size({"width": 1920, "height": 800})

        article.get_by_role("button", name="复制代码").press("Enter")
        expect(article.get_by_text("已复制代码。", exact=True)).to_be_visible()
        assert page.evaluate("navigator.clipboard.readText()").replace("\r\n", "\n") == CODE
        page.evaluate("""() => {
          navigator.clipboard.writeText = () => Promise.reject(new Error('fixture clipboard unavailable'));
        }""")
        article.get_by_role("button", name="复制代码").press("Enter")
        expect(article.get_by_text("剪贴板不可用，可手动复制选中的代码。", exact=True)).to_be_visible()
        assert page.evaluate("window.getSelection().toString()") == CODE

        article.get_by_role("link", name="中文章节", exact=True).press("Enter")
        expect(article.locator('[id="中文小节"]')).to_be_focused()
        page.keyboard.press("Tab")
        next_guide = article.get_by_role("link", name="同目录中文路径", exact=True)
        expect(next_guide).to_be_focused()
        page.keyboard.press("Enter")
        expect(article.get_by_role("heading", name="下一节", exact=True)).to_be_focused()
        page.reload()
        expect(article.get_by_role("heading", name="下一节", exact=True)).to_be_focused()

        page.go_back()
        exercise_search(page, base, article)
        public = article.get_by_role("link", name="公开资料", exact=False)
        expect(public).to_have_attribute("target", "_blank")
        expect(public).to_have_attribute("rel", "noopener noreferrer")
        assert not outside, outside
        with context.expect_page() as opened:
            public.press("Enter")
        opened.value.wait_for_load_state()
        assert opened.value.url == EXTERNAL
        assert outside == [(EXTERNAL, None)], outside
        assert opened.value.evaluate("window.opener === null")

        for path in ("/.mcp.json", "/manual/%2e%2e%2f.mcp.json", "/manual/../../work/private.md"):
            assert page.request.get(base + path).status == 404
        handbook = page.request.get(base + "/manual/" + quote(FILE))
        assert handbook.text() == SOURCE
        assert handbook.headers["content-type"] == "text/plain; charset=utf-8"
        assert handbook.headers["x-content-type-options"] == "nosniff"
        if linked:
            assert page.request.get(base + "/manual/workspace-overlay.md").status == 404
            index = page.request.get(base + "/manuals.json").json()
            assert all(row["file"] != "workspace-overlay.md" for row in index)
        assert not errors and not console, (errors, console)
        context.close()
        browser.close()


if __name__ == "__main__":
    parent = Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir()) / "Codex"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workbench-manual-", dir=parent) as directory:
        root = Path(directory)
        stage, project = root / "运行包", root / "测试工程"
        project.mkdir()
        private = project / ".mcp.json"
        private.write_text(json.dumps({"fixture": PRIVATE}), encoding="utf-8")
        (project / "work").mkdir()
        (project / "work/private.md").write_text(PRIVATE, encoding="utf-8")
        subprocess.run(["node", REPO / "tools/agents-workbench/react/package-runtime.mjs", stage], check=True)
        guide = stage / "docs/guides" / FILE
        guide.write_bytes(SOURCE.encode("utf-8"))
        (guide.parent / SECOND_FILE).write_bytes(SECOND_SOURCE.encode("utf-8"))
        linked_handbook = stage / "docs/workspace-overlay.md"
        linked_handbook.unlink()
        try:
            linked_handbook.symlink_to(private)
            linked = True
        except OSError as error:
            if getattr(error, "winerror", None) != 1314:
                raise
            linked = False
        env = dict(os.environ, PORT="0", GIT_ALLOW_PROTOCOL="file", GIT_TERMINAL_PROMPT="0")
        with subprocess.Popen(["node", "-e", LAUNCHER, project], cwd=stage, env=env,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8") as server:
            try:
                hello = json.loads(server.stdout.readline())
                guide.write_text("# Handbooks remain fixed for an open workbench\n", encoding="utf-8")
                exercise(hello, linked)
            finally:
                server.stdin.close()
                try:
                    server.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
    print(f"PASS staged handbook search and anchors, responsive layout at 390/1280/1920, sticky catalog and outline, keyboard, clipboard and no automatic external requests; linked file rejected: {linked}")
