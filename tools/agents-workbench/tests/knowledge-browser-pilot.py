"""Verify packaged cache readback and HTTPS build recovery in Windows Edge."""
import argparse
from contextlib import closing, contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import ssl
import subprocess
import tempfile
from threading import Condition, Event, Thread
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright


LAUNCH = """
const app = require('node:child_process').fork(process.argv[2],
  ['--project',process.argv[1]],{silent:true});
let hardStop = false;
app.once('message',message=>console.log(JSON.stringify({...message,pid:app.pid})));
app.stderr.pipe(process.stderr);
app.once('exit',code=>process.exit(code ?? (hardStop ? 0 : 1)));
const commands = require('node:readline').createInterface({input:process.stdin});
commands.on('line',line=>{
  if(line==='hard-stop'){ hardStop = true; app.kill(); }
  else if(line==='disconnect' && app.connected){
    app.once('disconnect',()=>console.log(JSON.stringify({disconnected:true})));
    app.disconnect();
  }
});
commands.once('close',()=>app.kill());
"""


@contextmanager
def open_project(browser, node, stage, project, env, *, managed=False):
    child_env = {**env}
    entry = "tools/agents-workbench/src/start-release.js"
    if managed:
        child_env["WORKBENCH_STARTUP_PARENT"] = "1"
        entry = "tools/agents-workbench/prototype/serve.js"
    with subprocess.Popen([node, "-e", LAUNCH, project, entry], cwd=stage, env=child_env, text=True, encoding="utf8",
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        page = browser.new_page()
        try:
            startup = json.loads(process.stdout.readline())
            base = startup["address"].partition("#")[0]
            errors, outside = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: outside.append(request.url) if not request.url.startswith(base) else None)
            page.goto(base + "#bootstrap=" + startup["bootstrap"])
            page.get_by_role("link", name="知识与向量", exact=True).click()
            yield page, process, startup["pid"]
            assert not errors and not outside, (errors, outside)
        finally:
            page.close()
            process.stdin.close()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def init_standard(project, env):
    capability = project / ".agents"
    updater = capability / "scripts/update-agents.ps1"
    updater.parent.mkdir(parents=True)
    updater.write_text("throw 'Updater must not run'\n", encoding="utf8")

    def git(*args, input=None):
        return subprocess.check_output(["git", "-C", capability, *args], env=env, input=input, text=True).strip()

    git("init", "-q")
    git("config", "--local", "remote.origin.url", "https://gitee.com/skyler-cook/imedical.agents.git")
    revision = git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit-tree",
                   git("mktree", input=""), "-m", "Local knowledge browser fixture")
    git("update-ref", "HEAD", revision)
    return capability


def make_tls_material(work):
    openssl = shutil.which("openssl") or Path(shutil.which("git")).parent.parent / "usr/bin/openssl.exe"
    assert Path(openssl).is_file(), "OpenSSL from Git for Windows is required for the loopback test certificate"
    certificate, key = work / "loopback.pem", work / "loopback-key.pem"
    subprocess.run([openssl, "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
                    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
                    "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", key, "-out", certificate],
                   cwd=work, capture_output=True, check=True)
    return certificate, key


@contextmanager
def gateway_fixture(material, responses):
    batches, errors = [], []
    received, release = Condition(), Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode("utf8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != "/dhccam/token/generate?grant_type=api_credentials":
                errors.append("unexpected credential endpoint")
                self.reply(404, {})
                return
            self.reply(200, {"access_token": "fixture-only-token", "remain_time": 0})

        def do_POST(self):
            try:
                assert self.path == "/dhccam/gateway/index"
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                request = body["biz_content"]["body"]
                assert request["model"] == "fixture-model"
                ids = []
                for text in request["input"]:
                    match = re.findall(r"APPROVED-\d{2}", text)
                    assert len(match) == 1 and "EXCLUDED" not in text
                    ids.append(match[0])
                with received:
                    response = responses[len(batches)]
                    batches.append(ids)
                    received.notify_all()
                if response == "hang":
                    release.wait(25)
                    return
                if response == "hold":
                    assert release.wait(25), "controlled batch did not resume"
                if response == 503:
                    self.reply(503, {"status": "synthetic outage"})
                    return
                self.reply(200, {"code": "10000", "data": {
                    "data": [{"index": i, "embedding": [1, 0, 0]} for i in range(len(ids))],
                    "usage": {"total_tokens": len(ids)},
                }})
            except Exception as error:
                errors.append(type(error).__name__)
                with received:
                    received.notify_all()

    certificate, key = material
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def wait_for_batch(count):
            with received:
                ready = received.wait_for(lambda: len(batches) >= count or errors, timeout=18)
            assert ready and not errors, ("gateway did not receive the expected batch", count, batches, errors)

        try:
            yield f"https://127.0.0.1:{server.server_port}", batches, release, wait_for_batch
            assert not errors, errors
        finally:
            release.set()
            server.shutdown()
            thread.join(5)


def configured_project(work, env, gateway, certificate):
    project = work / "网络续建 工程"
    capability = init_standard(project, env)
    directory = "plugins/imedical-ui/references"
    approved = capability / directory
    approved.mkdir(parents=True)
    for index in range(36):
        (approved / f"{index:02}.md").write_text(f"# Item {index:02}\n\nAPPROVED-{index:02}\n", encoding="utf8")
    excluded = capability / "plugins/iris-ui/references/excluded.md"
    excluded.parent.mkdir(parents=True)
    excluded.write_text("# Excluded\n\nEXCLUDED-FROM-TRANSFER\n", encoding="utf8")
    cache = capability / ".knowledge-cache"
    cache.mkdir()
    (cache / "policy.json").write_text(json.dumps({"schema": "knowledge-policy/v1", "allowQuery": False,
        "defaultProvider": "company", "allowedDirectories": [directory]}), encoding="utf8")
    config = work / "fixture-provider.json"
    config.write_text(json.dumps({"schema": "knowledge-rag-config/v1", "defaultProvider": "company", "providers": {
        "company": {"type": "gateway", "baseUrl": gateway, "method": "fixture-only-method",
            "appId": "fixture-only-id", "appKey": "fixture-only-key", "model": "fixture-model", "dimensions": 3},
    }}), encoding="utf8")
    return project, cache / "company.sqlite", {**env, "NODE_EXTRA_CA_CERTS": str(certificate), "KNOWLEDGE_RAG_CONFIG": str(config)}


def start_build(page, count, batches):
    existing_requests = len(batches)
    page.get_by_role("button", name="预览构建", exact=True).click()
    expect(page.get_by_text(f"本轮待外发 {count} 个去重片段", exact=False)).to_be_visible()
    assert len(batches) == existing_requests, "preview attempted to transfer documents"
    page.get_by_role("button", name="确认范围并开始构建", exact=True).click()


def verify_cache(database, count, *, complete=False):
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
        assert connection.execute("PRAGMA quick_check").fetchall() == [("ok",)]
        rows = dict(connection.execute("SELECT key, data FROM vectors WHERE dimensions=3").fetchall())
        assert len(rows) == count and all(json.loads(data) == [1, 0, 0] for data in rows.values())
        assert connection.execute("SELECT SUM(tokens) FROM usage").fetchone()[0] == count
        assert bool(connection.execute("SELECT 1 FROM state WHERE key='generation'").fetchone()) == complete
    return rows


def send(process, command):
    process.stdin.write(command + "\n")
    process.stdin.flush()


def exercise_http_resume(browser, node, stage, work, env, material):
    work.mkdir()
    with gateway_fixture(material, [200, 503, 200, "hang", 200]) as (gateway, batches, release, wait):
        project, database, child_env = configured_project(work, env, gateway, material[0])
        lock = database.with_suffix(".sqlite.lock")
        with open_project(browser, node, stage, project, child_env) as (page, _, _):
            start_build(page, 36, batches)
            expect(page.get_by_text("构建中断，还有 20 条向量待完成", exact=False)).to_be_visible(timeout=20000)
            first = verify_cache(database, 16)
            assert [len(batch) for batch in batches] == [16, 16]
            assert not lock.exists()
        with open_project(browser, node, stage, project, child_env) as (page, launcher, pid):
            assert len(batches) == 2, "reopening started an unconfirmed transfer"
            start_build(page, 20, batches)
            wait(4)
            stored = verify_cache(database, 32)
            assert first.items() <= stored.items()
            assert json.loads(lock.read_text(encoding="utf8"))["pid"] == pid
            send(launcher, "hard-stop")
            assert launcher.wait(timeout=15) == 0
            release.set()
        assert lock.exists() and json.loads(lock.read_text(encoding="utf8"))["pid"] == pid
        assert verify_cache(database, 32) == stored
        with open_project(browser, node, stage, project, child_env) as (page, _, new_pid):
            assert new_pid != pid and len(batches) == 4
            start_build(page, 4, batches)
            expect(page.get_by_text("构建完成，已读回", exact=False)).to_be_visible(timeout=20000)
            assert stored.items() <= verify_cache(database, 36, complete=True).items()
            assert not lock.exists() and not lock.with_suffix(".lock.recovery").exists()
        assert [len(batch) for batch in batches] == [16, 16, 16, 4, 4]
        assert batches[1] == batches[2] and batches[3] == batches[4]
        completed = batches[0] + batches[2] + batches[4]
        assert set(completed) == {f"APPROVED-{i:02}" for i in range(36)} and len(set(completed)) == len(completed)
    print("PASS HTTPS 503 and hard process exit resume only uncommitted vectors, using readable SQLite and automatic stale-lock recovery.", flush=True)


def exercise_managed_disconnect(browser, node, stage, work, env, material):
    work.mkdir()
    with gateway_fixture(material, [200, "hold", 200]) as (gateway, batches, release, wait):
        project, database, child_env = configured_project(work, env, gateway, material[0])
        lock = database.with_suffix(".sqlite.lock")
        with open_project(browser, node, stage, project, child_env, managed=True) as (page, launcher, pid):
            start_build(page, 36, batches)
            wait(2)
            before = verify_cache(database, 16)
            assert json.loads(lock.read_text(encoding="utf8"))["pid"] == pid
            send(launcher, "disconnect")
            assert json.loads(launcher.stdout.readline()) == {"disconnected": True}
            try:
                code = launcher.wait(timeout=0.7)
            except subprocess.TimeoutExpired:
                pass
            else:
                raise AssertionError(f"managed process exited before the current batch finished ({code})")
            assert lock.exists() and len(batches) == 2
            release.set()
            assert launcher.wait(timeout=15) == 0
        after = verify_cache(database, 32)
        assert before.items() <= after.items()
        assert not lock.exists() and len(batches) == 2
        with open_project(browser, node, stage, project, child_env) as (page, _, new_pid):
            assert new_pid != pid and len(batches) == 2
            start_build(page, 4, batches)
            expect(page.get_by_text("构建完成，已读回", exact=False)).to_be_visible(timeout=20000)
            assert after.items() <= verify_cache(database, 36, complete=True).items()
            assert not lock.exists()
        assert [len(batch) for batch in batches] == [16, 16, 4]
        completed = [value for batch in batches for value in batch]
        assert set(completed) == {f"APPROVED-{i:02}" for i in range(36)} and len(set(completed)) == len(completed)
    print("PASS managed IPC disconnect saves the current batch, skips the next, clears its lock, exits, and resumes from a new page.", flush=True)


def exercise(archive, work):
    stage = work / "离线 工作台"
    with ZipFile(archive) as package:
        release = json.loads(package.read("workbench-release.json"))
        assert release["platform"] == "windows-x64"
        package.extractall(stage)
    node = stage / "runtime/node.exe"
    assert subprocess.check_output([node, "--version"], text=True).strip() == "v" + release["node"]
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith("GIT_") and key.upper() not in {
        "WORKBENCH_STARTUP_PARENT", "WORKBENCH_LAUNCH_ANCHOR", "NODE_OPTIONS", "NODE_PATH", "NODE_TLS_REJECT_UNAUTHORIZED",
        "NODE_EXTRA_CA_CERTS", "NODE_USE_ENV_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
    }}
    env.update(PORT="0", GIT_ALLOW_PROTOCOL="", GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="NUL",
               KNOWLEDGE_RAG_CONFIG="", BOS_MCP_CONFIG="")
    project = work / "本地 知识工程"
    capability = init_standard(project, env)
    source = capability / "plugins/imedical-ui/references/fixture.md"
    source.parent.mkdir(parents=True)
    source.write_text("# 本地资料\n\n列表对齐测试资料。\n", encoding="utf8")
    cache = capability / ".knowledge-cache"
    member = work / "本地 Overlay"
    declaration = member / ".agents/capability.json"
    declaration.parent.mkdir(parents=True)
    backend = member / "backend"
    backend.mkdir()
    subprocess.run(["git", "-C", backend, "init", "-q"], env=env, check=True)
    declaration.write_text(json.dumps({
        "schemaVersion": 1, "mode": "workspace-overlay", "workspace": member.name, "contextRoot": ".agents",
        "capabilityRoot": str(capability), "sharedDirectories": [], "localDirectories": [],
        "sourceRoots": [{"name": "backend", "path": "backend", "target": "backend", "gitRoot": "backend"}],
    }), encoding="utf8")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        with open_project(browser, node, stage, project, env) as (page, _, _):
            table = page.get_by_role("table", name="本地构建缓存", exact=True)
            company = table.get_by_role("row").filter(has_text="company.sqlite")
            alternate = table.get_by_role("row").filter(has_text="index.sqlite")
            expect(company).to_contain_text("未发现索引文件")
            page.get_by_role("button", name="预览构建", exact=True).click()
            expect(page.get_by_text("本轮无需外发", exact=False)).to_be_visible()
            page.get_by_role("button", name="开始本地构建", exact=True).click()
            expect(page.get_by_text("构建完成，已读回", exact=False)).to_be_visible(timeout=20000)
            assert (cache / "company.sqlite").is_file()
            expect(company).to_contain_text("已发现")
            expect(company).to_contain_text("当前工程")

            subprocess.run([node, "-e", """
            const {build} = require('./scripts/lib/knowledge-retrieval');
            const root = process.argv[1];
            build({contextRoot:root,capabilityRoot:root},{provider:'openai'}).then(result => {
              if (!result.complete || result.embeddingTokens !== 0) process.exitCode = 1;
            }).catch(error=>{console.error(error.message); process.exitCode=1});
            """, capability], cwd=stage, env=env, check=True)
            assert (cache / "index.sqlite").is_file()
            expect(alternate).to_contain_text("未发现索引文件")
            page.get_by_role("button", name="重新读取索引", exact=True).click()
            expect(alternate).to_contain_text("已发现")

        with open_project(browser, node, stage, member, env) as (page, _, _):
            table = page.get_by_role("table", name="本地构建缓存", exact=True)
            for file in ("company.sqlite", "index.sqlite"):
                row = table.get_by_role("row").filter(has_text=file)
                expect(row).to_contain_text("共享能力根")
                expect(row).to_contain_text("已发现")
            expect(page.get_by_text("向量构建从所属 standard 工程启动。", exact=True)).to_be_visible()
            assert not (declaration.parent / ".knowledge-cache").exists()
        material = make_tls_material(work)
        exercise_http_resume(browser, node, stage, work / "https-resume", env, material)
        exercise_managed_disconnect(browser, node, stage, work / "managed-disconnect", env, material)
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    parent = Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir()) / "Codex"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workbench-knowledge-browser-", dir=parent) as temp:
        exercise(args.archive.resolve(strict=True), Path(temp))
    print("Verified local build readback, Overlay cache display, and both HTTPS build recovery paths.")
