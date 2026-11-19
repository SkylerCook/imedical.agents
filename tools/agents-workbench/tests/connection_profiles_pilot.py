"""Real profile owner and packaged React acceptance on an upgraded Windows project."""
import json
import os
import secrets
import subprocess
from pathlib import Path


def invoke(owner, project, action, **request):
    result = subprocess.run(["node", owner], input=json.dumps(dict(projectRoot=str(project), action=action, **request)),
                            capture_output=True, encoding="utf-8", check=True)
    return json.loads(result.stdout)


def check_previous_client(previous, current, ipc_root):
    script = """const {serve}=require(process.argv[1]+'/iris-session-host');
    const previous=require(process.argv[2]+'/lib/iris-session-ipc');
    (async()=>{const root=process.argv[3],host=await serve({root});
      const client=await previous.connect({root,start:false});
      try {await client.request('status');
        for (const method of ['call','markUnknown','close']) {
          await require('node:assert/strict').rejects(client.request(method,{projectRoot:'fixture'}),{code:'session-host-version-mismatch'});
        }
      } finally {client.close();await host.stop();}
      const path=require('node:path'),os=require('node:os');
      const idleRoot=path.join(root,'previous-home');
      const old=await require(process.argv[2]+'/iris-session-host').serve({
        root:path.join(idleRoot,'.imedical','iris-sessions'),hostIdleMs:1});
      const original=os.homedir;
      try {
        os.homedir=()=>idleRoot;
        const newer=await require(process.argv[1]+'/lib/iris-session-ipc').connect({
          root:path.join(idleRoot,'.imedical','iris-sessions'),start:false});
        try {
          for (const method of ['call','markBoundUnknown','closeBound'])
            await require('node:assert/strict').rejects(newer.request(method,{projectRoot:'fixture'}),{code:'session-host-version-mismatch'});
        } finally {newer.close();}
        const owner=require(process.argv[4]+'/configure-project');
        await require(process.argv[4]+'/iris-connection-profiles').awaitLegacyExit(owner);
        if(require('node:fs').existsSync(path.join(idleRoot,'.imedical/iris-sessions/host.json')))throw Error('host still active');
      } finally {os.homedir=original;await old.stop();}
    })().catch(()=>process.exitCode=1);"""
    subprocess.run(["node","-e",script,current,previous,ipc_root,Path(__file__).resolve().parents[2]/"ai-dev-offline"],check=True)


def seed(owner, project):
    # Synthetic credentials live only in this disposable project and process memory.
    pair = {k: secrets.token_hex(16) for k in ("username", "password")}
    profile = dict(host="a.invalid", port=19721, namespace="FIXTUREA", scheme="https", alias="devA", tlsVerify=True)
    central = project / ".agents/config/project-env.json"
    central.write_text(json.dumps(dict(iris={**profile, **pair}, mcp={"serverName":"fixture-iris"}, sftp={"host":"independent.invalid"})))
    request = dict(connection={**profile, **pair, "writeCredentials": True}, syncProjectEnv=True, configureMcp=True,
                   nodeExe=subprocess.check_output(["node","-p","process.execPath"],text=True).strip())
    plan = invoke(owner,project,"projectPlan",**request)
    invoke(owner,project,"projectApply",fingerprint=plan["fingerprint"],**request)
    return pair


def check_sync_owners(project,owner,host):
    cap=project/".agents"
    rel="plugins/coding-iris-plugin/scripts/iris-tools"
    entry=cap/rel/"sync-env-config.js"
    source_entry=Path(__file__).resolve().parents[3]/rel/"sync-env-config.js"
    old=entry.with_name("previous-sync-fixture.js")
    assert not old.exists()
    old.write_bytes(subprocess.check_output(["git","-C",cap,"show","e943fc29:"+rel+"/sync-env-config.js"]))
    main=cap/"config/project.jsonc"
    central=cap/"config/project-env.json"
    mcp=project/".mcp.json"
    backend=cap/"config/iris-session-backend.json"
    saved={p:p.read_bytes() for p in [main,central,mcp,backend] if p.exists()}
    env=dict(os.environ,IRIS_HOST="unselected.invalid",IRIS_NAMESPACE="UNSELECTED",IRIS_TLS_VERIFY="false")
    def call(script,*args):
        return subprocess.run(["node",script,*args],cwd=project,env=env,capture_output=True,encoding="utf-8")
    def load(p): return json.loads(p.read_text("utf-8-sig"))
    def put(p,v): p.write_text(json.dumps(v),encoding="utf-8")
    try:
        command="const p=process.argv[1];require(p+'/scripts/lib/iris-development-settings').save({contextRoot:p,capabilityRoot:p},{developmentMode:'connected'})"
        subprocess.run(["node","-e",command,cap],check=True)
        for cli in [source_entry,entry,old]:
            result=call(cli)
            assert result.returncode==0,result.stderr
        check=call(entry,"--check-profile")
        assert check.returncode==0 and "selected-profile" in check.stdout
        stable=mcp.read_bytes()
        for source,field in [(central,"host"),(mcp,"IRIS_TLS_VERIFY")]:
            original=source.read_bytes()
            wrong=load(source)
            if source==central: wrong["iris"][field]="foreign.invalid"
            else:
                row=wrong["mcpServers"]["fixture-iris"]["env"]
                row[field]=str(row[field]).lower()!="true"
            put(source,wrong)
            drift=source.read_bytes()
            for cli,args in [(source_entry,[]),(entry,[]),(old,[]),(entry,["--check-profile"]),(cap/"scripts/iris-mcp.js",["check","--json"])]:
                result=call(cli,*args)
                assert result.returncode and source.name in result.stderr,(source.name,cli.name,result.stderr)
            result=call(cap/rel/"session-migration.js","--project-root",str(project),"--mode","Check")
            assert result.returncode and source.name in result.stdout
            assert source.read_bytes()==drift
            if source!=mcp: assert mcp.read_bytes()==stable
            model=invoke(owner,project,"projectInspect")
            assert model["host"]==host and not model["consistent"] and any(source.name in item for item in model["conflicts"])
            if source==central:
                before=load(mcp)["mcpServers"]["fixture-iris"]
                wrong["sftp"]={"enabled":True,"runtime":"custom","args":["local.py"],"serverName":"file-transfer","command":"python",
                               "host":"sftp.invalid","username":"fixture","keyFile":"private.fixture","localPath":".","remotePath":"/fixture"}
                put(source,wrong)
                result=call(entry)
                assert result.returncode and source.name in result.stderr
                updated=load(mcp)["mcpServers"]
                assert updated["fixture-iris"]==before and updated["file-transfer"]["env"]["TARGET_HOST"]=="sftp.invalid"
                mcp.write_bytes(stable)
            source.write_bytes(original)
        toml=project/".iris-agentic-dev.toml"
        original=toml.read_bytes()
        try:
            assert host.encode() in original
            toml.write_bytes(original.replace(host.encode(),b"other.invalid"))
            result=call(entry,"--check-profile")
            assert result.returncode and ".iris-agentic-dev.toml" in result.stderr
            assert mcp.read_bytes()==stable
        finally: toml.write_bytes(original)
    finally:
        for p,data in saved.items(): p.write_bytes(data)
        old.unlink()


def exercise(page, owner, project, initial):
    def model():
        return invoke(owner,project,"projectProfiles")
    def choose(identifier):
        req = {"profile":{"id":identifier}}
        plan = invoke(owner,project,"projectPlan",**req)
        invoke(owner,project,"projectApply",fingerprint=plan["fingerprint"],**req)
    def check(active,host,namespace,pair):
        s=model()
        assert s["target"]["tlsVerify"]==(active=="current")
        assert s["active"]==active and s["consistent"] and s["verification"]=="configuration-only", s
        assert all(s["bindings"].values())
        central=json.loads((project/".agents/config/project-env.json").read_text("utf-8-sig"))
        assert central["iris"]["host"]==host and central["iris"]["namespace"]==namespace
        assert central["iris"]["password"]==pair["password"] and central["sftp"]["host"]=="independent.invalid"
        entry=json.loads((project/".mcp.json").read_text("utf-8-sig"))["mcpServers"]["fixture-iris"]
        assert entry["env"]["IRIS_HOST"]==host and entry["env"]["IRIS_PASSWORD"]==pair["password"]
        assert host in (project/".iris-agentic-dev.toml").read_text("utf-8-sig")
        main=(project/".agents/config/project.jsonc").read_text("utf-8-sig")
        assert all(v not in main for v in [*initial.values(),*pair.values()])
    page.get_by_role("link",name="工程配置",exact=True).click()
    page.get_by_role("button",name="编辑工程连接").click()
    assert model()["active"]=="" and model()["target"]["host"]=="a.invalid"
    page.get_by_label("新增并切换",exact=False).fill("devB")
    for label,value in [("IRIS 主机","b.invalid"),("命名空间","FIXTUREB")]:
        page.get_by_label(label,exact=True).fill(value)
    page.get_by_label("验证 TLS 证书",exact=True).select_option("false")
    pair={k:secrets.token_hex(16) for k in ("username","password")}
    for label,key in [("IRIS 账号","username"),("IRIS 密码","password")]:
        page.get_by_label(label,exact=True).select_option("replace")
        page.get_by_label(label+"新值",exact=True).fill(pair[key])
    def preview():
        with page.expect_response(lambda r: "/settings/plan/project" in r.url) as response:
            page.get_by_role("button",name="预览修改").click()
        assert response.value.ok, response.value.json().get("error")
    preview()
    page.get_by_role("button",name="保存到当前工程").click()
    page.get_by_text("开发库配置已保存并读回",exact=False).wait_for()
    check("devB","b.invalid","FIXTUREB",pair)
    check_sync_owners(project,owner,"b.invalid")
    choose("current")
    check("current","a.invalid","FIXTUREA",initial)
    check_sync_owners(project,owner,"a.invalid")
    shared=invoke(owner,project,"projectPlan",profile={"id":"another","useCurrentCredentials":True,
        "connection":{**model()["target"],"host":"another.invalid"}})
    assert shared["to"]["credentialRef"]=="private:current" and shared["to"]["alias"]=="another"
    page.reload()
    field=page.get_by_label("切换到已有档案")
    assert field.input_value()=="current"
    field.select_option("devB")
    preview()
    page.get_by_role("button",name="保存到当前工程").wait_for()
    config=project/".iris-agentic-dev.toml"
    config.write_bytes(config.read_bytes()+b"\n# concurrent edit\n")
    page.get_by_role("button",name="保存到当前工程").click()
    page.get_by_text("工程配置已变化，保存已停止",exact=False).wait_for()
    check("current","a.invalid","FIXTUREA",initial)
    script="""const owner=require(process.argv[1]);const req={projectRoot:process.argv[2],profile:{id:'devB'}};
    req.fingerprint=owner.plan(req).fingerprint;
    let writes=0;owner.apply(req,{beforeWrite(){if(++writes===2) throw Error('fixture-interruption')}})
    .then(()=>process.exit(1)).catch(e=>{if(e.message!=='fixture-interruption')process.exit(1)});"""
    subprocess.run(["node","-e",script,owner,project],check=True)
    check("current","a.invalid","FIXTUREA",initial)
