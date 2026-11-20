"""Windows staged workbench, genuine owners, loopback-only IRIS fixture."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("project-policy-pilot.py")))
run=fixture["run"]
REPO=fixture["REPO"]

@contextmanager
def child(args,cwd,env):
    p=subprocess.Popen(args,cwd=cwd,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    try: yield p
    finally:
        p.stdin.close()
        p.wait(timeout=40)

def exercise(work,stage,project,legacy,mirror,env,launcher):
    # Only the temporary staged package approves this disposable integration commit.
    revision=run("git","rev-parse","HEAD",cwd=mirror).strip()
    rows=subprocess.check_output(["git","-C",mirror,"ls-tree","-r","-z",revision,"--","scripts","plugins","vendor","hooks"]).split(b"\0")
    digest=hashlib.sha256(b"\0".join(row for row in rows if not row.endswith(b"\tscripts/install-agents.ps1"))).hexdigest()
    worker=stage/"tools/agents-workbench/src/framework-worker.js"
    anchor="const trustedRuntime = new Map(["
    source=worker.read_text("utf-8")
    assert source.count(anchor)==1
    worker.write_text(source.replace(anchor,anchor+f"['{revision}','{digest}'],"),encoding="utf-8")
    # Session host and all its files belong to the fixture.
    isolated=work/"user"
    isolated.mkdir()
    env=dict(env,USERPROFILE=str(isolated))
    requests={profile:[] for profile in ("probeA","probeB")}
    deny_auth=set()
    rejected_auth=[]
    endpoints={}
    class Atelier(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def respond(self):
            self.rfile.read(int(self.headers.get("Content-Length","0")))
            logout="Logout=end" in self.path
            profile=self.server.profile
            rejected=not logout and profile in deny_auth
            self.send_response(401 if logout or rejected else 200)
            self.send_header("Content-Type","application/json")
            if not logout:
                requests[profile].append((self.command,self.path))
                if rejected:
                    rejected_auth.append((profile,bool(self.headers.get("Authorization"))))
                    self.send_header("WWW-Authenticate",'Basic realm="IRIS test"')
                else:
                    self.send_header("Set-Cookie",f"CSPSESSIONID-{profile}=local; Path=/api/atelier/")
            self.end_headers()
            payload={"version":"IRIS for test","api":1} if self.command=="GET" else [{"probe":1,"Value":"Development"}]
            body={"error":"Unauthorized"} if rejected else {"result":{"content":payload}}
            if self.command!="HEAD": self.wfile.write(json.dumps(body).encode())
        do_HEAD=respond
        do_GET=respond
        do_POST=respond
    owner=REPO/"tools/ai-dev-offline/configure-project.js"
    try:
        for profile in requests:
            endpoint=ThreadingHTTPServer(("127.0.0.1",0),Atelier)
            endpoint.profile=profile
            thread=threading.Thread(target=endpoint.serve_forever,daemon=True)
            thread.start()
            endpoints[profile]=(endpoint,thread)
        released=work/"首次接入"
        released.mkdir()
        run("git","init","-q",cwd=released)
        pin=run("git","rev-parse","3246ca4^{commit}",cwd=mirror).strip()
        run("git","update-ref","HEAD",pin,revision,cwd=mirror)
        try:
            run("powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-File",REPO/"scripts/install-agents.ps1",
                "-RuntimeAdapter","Codex",cwd=released,env=env)
        finally:
            run("git","update-ref","HEAD",revision,pin,cwd=mirror)
        cap=legacy/".agents"
        run("node","-e","const p=process.argv[1];require(p+'/scripts/lib/iris-development-settings').save({contextRoot:p,capabilityRoot:p},{developmentMode:'connected'})",cap)
        def invoke_owner(action,**request):
            result=subprocess.run(["node",owner],input=json.dumps({"projectRoot":str(legacy),"action":action,**request}),
                                  env=env,capture_output=True,encoding="utf-8")
            assert result.returncode==0,result.stderr
            return json.loads(result.stdout)
        def select_profile(profile):
            request={"profile":profile}
            plan=invoke_owner("projectPlan",**request)
            invoke_owner("projectApply",fingerprint=plan["fingerprint"],**request)
        for profile,(endpoint,_) in endpoints.items():
            select_profile({"id":profile,"connection":{"host":"127.0.0.1","port":endpoint.server_port,
                            "scheme":"http","namespace":"TEST","tlsVerify":False},"useCurrentCredentials":True})
        select_profile({"id":"probeA"})
        # Seed a legacy per-instance policy for A before selecting B through normal Workbench configuration.
        policy_file=cap/"config/iris-remote-policy.json"
        original_pool=run("node","-e", "const r=require(process.argv[1]);console.log(r.instanceIdentity({host:'127.0.0.1',scheme:'http',port:Number(process.argv[2])}));",
                          cap/"scripts/lib/iris-remote-operations.js",str(endpoints["probeA"][0].server_port)).strip()
        policy={"schema":"iris-remote-policy/v1","enabled":True,"poolKey":original_pool,
                "coordinationRoot":str(work/"legacy-admission")}
        policy_file.write_text(json.dumps(policy),encoding="utf-8")
        policy_bytes=policy_file.read_bytes()
        host="""const p=process.argv[1];require(p+'/scripts/iris-session-host').serve({root:process.argv[2],hostIdleMs:900000}).then(h=>{
          console.log('ready');process.stdin.resume().once('end',()=>h.stop())})"""
        with child(["node","-e",host,cap,isolated/".imedical/iris-sessions"],stage,env) as session:
            assert session.stdout.readline().strip()=="ready"
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel="msedge",headless=True)
                for root in [released,project,legacy]:
                    with child(["node","-e",launcher,root],stage,env) as server:
                        hello=json.loads(server.stdout.readline())
                        page=browser.new_page()
                        errors=[]
                        page.on("pageerror",lambda e:errors.append(str(e)))
                        def trace(response):
                            if response.url.endswith('/framework/action'):
                                result=response.json()
                                print(root.name, result.get('action'), response.status, result.get('error',''),flush=True)
                        page.on('response',trace)
                        address=hello["address"].split("#")[0]
                        page.goto(address+"#bootstrap="+hello["bootstrap"])
                        page.goto(address+"#plugins?preview=demand-delivery-plugin")
                        def click(label,expected_error=None):
                            button=page.get_by_role("button",name=label,exact=True)
                            with page.expect_response(lambda r:r.url.endswith("/framework/action")) as response:
                                button.click()
                            data=response.value.json()
                            if expected_error:
                                assert data.get("error")==expected_error,data.get("error")
                                return data
                            assert response.value.ok and not data.get("error"),data.get("error")
                            if data.get("action","").startswith("plugin-") and "inspect" not in data["action"]:
                                request=response.value.request
                                repeat=page.request.post(request.url,data=request.post_data,
                                    headers={k:v for k,v in request.all_headers().items() if k in ["origin","x-workbench-csrf","x-workbench-request","content-type"]})
                                assert repeat.ok and repeat.json()["plugin"]["status"]==data["plugin"]["status"],repeat.json().get("error")
                            return data
                        install=page.get_by_role("button",name="补装插件与依赖")
                        install.wait_for(timeout=25000)
                        install.click()
                        page.get_by_role("button",name="取消",exact=True).click()
                        assert not (root/".agents/plugins/demand-delivery-plugin/.agents-plugin/plugin.json").exists()
                        install.click()
                        assert click("确认补装")["plugin"]["installed"]
                        page.get_by_role("button",name="启用插件",exact=True).click()
                        assert click("确认启用")["plugin"]["discoveryChecked"]
                        skill=root/".agents/skills/demand-commit/SKILL.md"
                        assert skill.is_file() and "demand-delivery-plugin" in skill.read_text("utf-8-sig")
                        assert click("重读插件状态")["plugin"]["status"]=="enabled"
                        content=skill.read_bytes()
                        skill.write_bytes(content+b"\nfixture user edit\n")
                        page.get_by_role("button",name="停用插件",exact=True).click()
                        click("确认停用","plugin-discovery-pending")
                        assert skill.read_bytes().endswith(b"fixture user edit\n")
                        skill.write_bytes(content)
                        page.get_by_role("button",name="停用插件",exact=True).click()
                        assert click("确认停用")["plugin"]["status"]=="disabled" and not skill.exists()
                        if root==released:
                            page.goto(address+"#plugins?preview=bos-plugin")
                            page.get_by_role("button",name="补装插件与依赖").click()
                            assert click("确认补装")["plugin"]["initialization"].endswith("/bos-init/SKILL.md")
                            page.get_by_role("button",name="接续初始化").click()
                            assert "plugins/bos-plugin/skills/bos-init/SKILL.md" in page.get_by_label("接续请求").input_value()
                        if root==legacy:
                            page.goto(address+"#connections")
                            assert not any(requests.values())
                            mcp=root/".mcp.json"
                            before_discovery=mcp.read_bytes()
                            discovered=click("发现受管 IRIS 工具")["discovery"]
                            assert discovered["profile"]=="probeA" and discovered["processExited"] is True and discovered["backendPresent"] is True
                            assert "check_config" in discovered["tools"] and len(discovered["tools"])>1
                            page.get_by_text("受管适配器返回的工具",exact=False).click()
                            assert page.get_by_text("本次适配器已正常退出",exact=False).is_visible()
                            assert not any(requests.values()) and mcp.read_bytes()==before_discovery
                            assert not (cap/"config/iris-profile-verification.json").exists()
                            backend=json.loads((cap/"config/iris-session-backend.json").read_text("utf-8-sig"))
                            executable=root/backend["command"]
                            assert executable.resolve().is_relative_to(cap.resolve())
                            saved_exe=work/"local-discovery-vendor-fixture.exe"
                            assert not saved_exe.exists()
                            executable.rename(saved_exe)
                            try:
                                without_vendor=click("发现受管 IRIS 工具")["discovery"]
                                assert without_vendor["tools"]==discovered["tools"] and without_vendor["backendPresent"] is False
                                assert not any(requests.values())
                            finally:
                                saved_exe.rename(executable)
                            direct=json.loads(before_discovery.decode("utf-8-sig"))
                            direct["mcpServers"]["fixture-iris"].update(command=backend["command"],args=backend["args"])
                            mcp.write_text(json.dumps(direct),encoding="utf-8")
                            try:
                                click("发现受管 IRIS 工具","mcp-discovery-handoff")
                                assert not any(requests.values())
                            finally:
                                mcp.write_bytes(before_discovery)
                            disabled=json.loads(before_discovery.decode("utf-8-sig"))
                            disabled["mcpServers"]["fixture-iris"]["disabled"]=True
                            mcp.write_text(json.dumps(disabled),encoding="utf-8")
                            try:
                                click("发现受管 IRIS 工具","mcp-discovery-disabled")
                                page.get_by_text("当前工程已禁用此 MCP 服务。",exact=True).wait_for()
                                assert not any(requests.values())
                            finally:
                                mcp.write_bytes(before_discovery)
                            # The configured synthetic account is rejected by the real vendor transport.
                            receipt=cap/"config/iris-profile-verification.json"
                            central=cap/"config/project-env.json"
                            config_before=central.read_bytes()
                            credentials=json.loads(config_before.decode("utf-8-sig"))["iris"]
                            deny_auth.add("probeA")
                            try:
                                page.goto(address+"#config?edit=project")
                                with page.expect_response(lambda r:r.url.endswith("/framework/action") and
                                                          r.request.post_data_json.get("action")=="verify-connection") as denied:
                                    page.get_by_role("button",name="核验当前连接",exact=True).click()
                                response=denied.value
                                result=response.json()
                                assert response.status==409 and result.get("error")=="connection-check-failed",result.get("error")
                                page.get_by_text("原核验入口未成功。请核对开发模式、客户端连接和目标可达性，再重试。",exact=True).wait_for()
                                page.get_by_role("button",name="生成连接核验请求",exact=True).wait_for()
                                assert ("probeA",True) in rejected_auth and not requests["probeB"]
                                assert not receipt.exists() or json.loads(receipt.read_bytes())["verified"] is False
                                assert not page.get_by_text("IRIS MCP 已核验档案",exact=False).count()
                                assert all(credentials[key] not in response.text() and credentials[key] not in page.locator("body").inner_text()
                                           for key in ("username","password"))
                                assert central.read_bytes()==config_before and mcp.read_bytes()==before_discovery
                                state=json.loads(run("node",cap/"scripts/iris-remote.js","status","--project-root",legacy,cwd=legacy,env=env))
                                failure=state["session"]["lastFailedOperation"]
                                assert failure["errorCode"]=="session-authentication-failed" and failure["httpStatus"]==401,failure
                            finally:
                                deny_auth.remove("probeA")
                            print("Verified configuration-page authentication rejection, failure handoff and no verified receipt.",flush=True)
                            # Respect the original managed-session admission cooldown before repeating the real check.
                            delay=state["session"]["retryAfter"]/1000-time.time()
                            assert delay < 10, "unexpected managed-session cooldown"
                            if delay > 0:
                                time.sleep(delay + 0.05)
                            def verify_selected(profile):
                                baseline={name:len(calls) for name,calls in requests.items()}
                                page.goto(address+"#connections")
                                checked=click("核验当前连接")
                                assert checked["connection"]["verified"] and checked["connection"]["profile"]==profile,checked
                                assert any(method=="POST" and target.partition("?")[0].endswith("/action/query")
                                           for method,target in requests[profile][baseline[profile]:]),requests
                                assert all(len(calls)==baseline[name] for name,calls in requests.items() if name!=profile),requests
                                assert (cap/"config/iris-profile-verification.json").is_file()
                            def switch_to(profile):
                                page.goto(address+"#config?edit=project")
                                page.get_by_label("切换到已有档案",exact=True).select_option(profile)
                                page.get_by_role("button",name="预览修改").click()
                                page.get_by_role("button",name="保存到当前工程").click()
                                page.get_by_text("开发库配置已保存并读回",exact=False).wait_for()
                            verify_selected("probeA")
                            switch_to("probeB")
                            verify_selected("probeB")
                            switch_to("probeA")
                            # check_config reads cached settings; retire A so the next check proves a fresh contact with A.
                            retired=json.loads(run("node",cap/"scripts/iris-remote.js","close-sessions","--project-root",legacy,cwd=legacy,env=env))
                            assert retired["active"] is False,retired
                            verify_selected("probeA")
                            assert policy_file.read_bytes()==policy_bytes
                            print("Verified UI profile activation and vendor HTTP routing for A, B, and A.",flush=True)
                            page.goto(address+"#config?edit=project")
                            page.get_by_text("已核验所选库",exact=False).wait_for()
                            page.get_by_role("button",name="核验当前连接").wait_for()
                            original=mcp.read_bytes()
                            custom=json.loads(original.decode("utf-8-sig"))
                            marker=work/"custom-mcp-started"
                            script=work/"custom-mcp.js"
                            script.write_text("require('node:fs').writeFileSync("+json.dumps(str(marker))+", 'started');",encoding="utf-8")
                            custom["mcpServers"]["fixture-iris"]["args"]=[str(script)]
                            mcp.write_text(json.dumps(custom),encoding="utf-8")
                            try:
                                counts={name:len(calls) for name,calls in requests.items()}
                                click("核验当前连接","connection-handoff")
                                page.get_by_role("button",name="生成连接核验请求").click()
                                assert "核验" in page.get_by_label("接续请求").input_value()
                                page.goto(address+"#connections")
                                click("发现受管 IRIS 工具","mcp-discovery-handoff")
                                page.get_by_role("button",name="生成 MCP 核对请求").wait_for()
                                assert counts=={name:len(calls) for name,calls in requests.items()} and not marker.exists()
                            finally:
                                mcp.write_bytes(original)
                        assert not errors,errors
                        page.close()
                browser.close()
    finally:
        for endpoint,thread in endpoints.values():
            endpoint.shutdown();endpoint.server_close();thread.join()
if __name__=="__main__":
    parent=Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir())/"Codex"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workbench-owner-ui-",dir=parent) as temp:
        fixture["exercise"](Path(temp),after_staging=exercise,extra_paths=["scripts/iris-remote.js"])
    print("Passed staged plugin lifecycle and real vendor A/B/A connection checks against loopback.")
