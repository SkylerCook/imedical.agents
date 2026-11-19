"""Installed stock updater, plugin settings readers and staged Windows workbench."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("project-policy-pilot.py")))
repo=fixture["REPO"]
run=fixture["run"]
ids=["coding-iris-plugin","iris-cure-form-dev","i18n-iris-plugin","iris-interface-dev"]
rows={
    ids[0]:("iris_project_profile.md","前端源码编码","sourceEncoding","utf8"),
    ids[1]:("cure_form_profile.md","WorkRoot","WorkRoot","custom/forms"),
    ids[2]:("i18n_project_profile.md","OutputDir","xmlPrintOutputDir","custom/xml"),
    ids[3]:("iris_interface_profile.md","outputRoot","outputRoot","custom/interface")}
ps=["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-File"]

def seed(project,env):
    cap=project/".agents"
    run("node",cap/"scripts/plugin-deploy.js","ensure","--explicit","--project-root",project,"--plugin","extract-doc",env=env)
    run(*ps,cap/"scripts/update-plugin-profile.ps1","-ProjectRoot",project,"-Plugin","extract-doc","-Status","enabled",env=env)
    for id,(fname,key,_,value) in rows.items():
        run("node",cap/"scripts/plugin-deploy.js","ensure","--explicit","--project-root",project,"--plugin",id,env=env)
        if id!=ids[0]:
            run(*ps,cap/"scripts/update-plugin-profile.ps1","-ProjectRoot",project,"-Plugin",id,"-Status","enabled",env=env)
        f=cap/"config"/fname
        txt=f.read_text("utf-8-sig") if f.exists() else ""
        txt="\n".join(line for line in txt.splitlines() if not line.startswith(("- "+key+":","- "+key+"：")))
        f.write_text(txt+"\n<!-- fixture comment -->\n- UnknownFixture: keep\n- "+key+": "+value+"\n",encoding="utf-8-sig")

def exercise(work,stage,new,old,mirror,env,launcher):
    for project in (old,new):
        cap=project/".agents"
        cli=cap/"scripts/plugin-settings.js"
        if project==new:
            run("node",cap/"scripts/plugin-deploy.js","ensure","--explicit","--project-root",project,"--plugin","extract-doc",env=env)
            run(*ps,cap/"scripts/update-plugin-profile.ps1","-ProjectRoot",project,"-Plugin","extract-doc","-Status","enabled",env=env)
        def read(id):return json.loads(run("node",cli,"Read",id,project,env=env))
        for id,(_,_,key,value) in rows.items():
            if project==new and id!=ids[0]:
                assert id not in json.loads((cap/"config/project.jsonc").read_text("utf-8-sig").replace("// keep project fields","")).get("pluginSettings",{})
                run("node",cap/"scripts/plugin-deploy.js","ensure","--explicit","--project-root",project,"--plugin",id,env=env)
            if project==new:
                run(*ps,cap/"scripts/update-plugin-profile.ps1","-ProjectRoot",project,"-Plugin",id,"-Status","enabled",env=env)
            run(*ps,cap/"scripts/update-agents.ps1","-ProjectRoot",project,"-Plugin",id,"-Mode","Write","-NoPull",env=env)
            if project==old:
                assert read(id).get(key)==value,(id,key)
                assert "UnknownFixture: keep" in (cap/"config"/rows[id][0]).read_text("utf-8-sig")
            else:
                canonical=json.loads(run("node","-e","const p=process.argv[1];console.log(JSON.stringify(require(p+'/scripts/lib/configuration-file-io').parse(require('fs').readFileSync(p+'/config/project.jsonc','utf8')).pluginSettings))",cap))
                assert id in canonical,(id,"first deployment")
                run("node",cli,"Init",id,project,env=env)
        main=cap/"config/project.jsonc"
        before=main.read_bytes()
        for id in ids: run("node",cli,"Write",id,project,env=env)
        assert main.read_bytes()==before
        run(*ps,cap/"scripts/update-agents.ps1","-ProjectRoot",project,"-Mode","Write","-NoPull",env=env)
        assert main.read_bytes()==before
    cap=old/".agents"
    proc=subprocess.Popen(["node","-e",launcher,old],cwd=stage,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    try:
        hello=json.loads(proc.stdout.readline())
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel="msedge",headless=True)
            page=browser.new_page()
            address=hello["address"].split("#")[0]
            page.goto(address+"#bootstrap="+hello["bootstrap"])
            page.goto(address+"#config?edit=project")
            field=page.get_by_label("xmlPrintOutputDir",exact=True)
            assert field.input_value()=="custom/xml"
            field.fill("custom/ui")
            page.get_by_role("button",name="预览修改").click()
            page.get_by_role("button",name="保存到当前工程").click()
            page.get_by_text("插件参数已保存并读回。",exact=True).wait_for()
            result=json.loads(run("node",cap/"plugins/i18n-iris-plugin/scripts/resolve-project-directory.js","xml","--project-root",old))
            assert Path(result["outputDir"])==old/"custom/ui"
            browser.close()
    finally:
        proc.stdin.close()
        proc.wait(timeout=30)

if __name__=="__main__":
    parent=Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir())/"Codex"
    parent.mkdir(exist_ok=True)
    extra=["scripts/lib/project-plugin-settings.js","scripts/plugin-settings.js","scripts/lib/plugin-catalog.json"]
    extra += ["plugins/"+id for id in ids]
    extra += [p.relative_to(repo).as_posix() for p in (repo/"plugins").glob("*/.agents-plugin/plugin.json") if p.parent.parent.name not in ids]
    with tempfile.TemporaryDirectory(prefix="workbench-plugin-settings-",dir=parent) as temp:
        fixture["exercise"](Path(temp),after_staging=exercise,extra_paths=extra,before_upgrade=seed)
    print("Passed historical update, clean install, plugin settings UI and original CLI.")
