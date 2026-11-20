"""Isolated Windows acceptance for the project policy and the production React build."""
import argparse
import base64
from contextlib import contextmanager
from hashlib import file_digest, sha256
import json
import os
from pathlib import Path
from secrets import token_hex
import shutil
import subprocess
import tempfile
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright
import connection_profiles_pilot as profiles

REPO = Path(__file__).resolve().parents[3]
ORIGIN = "https://gitee.com/skyler-cook/imedical.agents.git"


def run(*args, cwd=None, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env, text=True, encoding="utf-8", errors="replace")


def external_edit(config, before, after):
    data = config.read_bytes()
    assert data.count(before) == 1
    updated = data.replace(before, after)
    config.write_bytes(updated)
    return updated


def exercise_external_settings(page, config):
    alias = page.get_by_label("环境别名", exact=True)
    preview = page.get_by_role("button", name="预览修改", exact=True)
    save = page.get_by_role("button", name="保存到当前工程", exact=True)
    reload_source = page.get_by_role("button", name="重新读取来源", exact=True)
    expect(alias).to_have_value("fixture")
    alias.fill("fixture-draft")
    with page.expect_response(lambda r: r.url.endswith("/settings/plan/project")) as prepared:
        preview.click()
    assert prepared.value.ok, prepared.value.json()
    expect(save).to_be_visible()
    edited = external_edit(config, b'"nested": 17', b'"nested": 18')
    with page.expect_response(lambda r: r.url.endswith("/settings/apply")) as rejected:
        save.click()
    assert rejected.value.status == 409
    assert config.read_bytes() == edited
    reload_source.click()
    expect(alias).to_have_value("fixture-draft")
    preview.click()
    save.click()
    expect(page.get_by_text("工程开发声明已保存并读回", exact=False)).to_be_visible()
    assert b'"nested": 18' in config.read_bytes() and b'// keep project fields' in config.read_bytes()
    page.get_by_role("button", name="关闭", exact=True).click()
    page.get_by_role("button", name="编辑工程连接").click()

    expect(alias).to_have_value("fixture-draft")
    alias.fill("fixture-conflict")
    secret = token_hex(20)
    password = page.get_by_label("IRIS 密码", exact=True)
    password.select_option("replace")
    page.get_by_label("IRIS 密码新值", exact=True).fill(secret)
    edited = external_edit(config, b'"fixture-draft"', b'"fixture-external"')
    with page.expect_response(lambda r: r.url.endswith("/settings/plan/project")) as rejected:
        preview.click()
    assert rejected.value.status == 409 and secret not in rejected.value.text()
    assert config.read_bytes() == edited
    reload_source.click()
    conflict = page.get_by_role("group", name="环境别名", exact=True)
    use_source = conflict.get_by_role("button", name="使用来源值", exact=True)
    expect(use_source).to_be_visible()
    expect(conflict.get_by_role("button", name="保留我的修改", exact=True)).to_be_visible()
    expect(conflict.get_by_text("来源值 · fixture-external", exact=True)).to_be_visible()
    expect(conflict.get_by_text("我的修改 · fixture-conflict", exact=True)).to_be_visible()
    expect(preview).to_be_disabled()
    use_source.click()
    expect(alias).to_have_value("fixture-external")
    expect(password).to_have_value("keep")
    expect(page.get_by_label("IRIS 密码新值", exact=True)).to_have_count(0)
    assert not page.evaluate("value => [localStorage, sessionStorage].some(store => JSON.stringify(store).includes(value))", secret)
    expect(preview).to_be_enabled()
    assert config.read_bytes() == edited
    page.get_by_label("环境类型", exact=True).select_option("development")
    with page.expect_response(lambda r: r.url.endswith("/settings/plan/project")) as accepted:
        preview.click()
    assert accepted.value.ok
    assert accepted.value.request.post_data_json["changes"] == {"irisDevelopment.environmentType": {"value": "development"}}
    save.click()
    expect(page.get_by_text("工程开发声明已保存并读回", exact=False)).to_be_visible()
    assert b'"fixture-external"' in config.read_bytes()


def exercise_persistent_drafts(stage, project, other_project, env, launcher, node):
    directory = Path(env["USERPROFILE"]) / ".imedical/agents-workbench/drafts"
    assert project.name == other_project.name and project != other_project
    key = ".agents/config/project.jsonc"
    config, other_config = project / key, other_project / key
    on_disk, other_on_disk = config.read_bytes(), other_config.read_bytes()
    secret_input = "fixture-draft-input-sensitive-8ef252"
    secret_env = "fixture-draft-env-sensitive-fc21a0"
    local_alias = "fixture-persisted-draft"
    draft_env = dict(env, IRIS_PASSWORD=secret_env)
    expect_saved = "本机草稿已保存。"
    expect_cleared = "本机草稿已清除。当前编辑内容仍可继续处理。"

    @contextmanager
    def settings(browser, target):
        proc = subprocess.Popen([node, "-e", launcher, target], cwd=stage, env=draft_env,
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8")
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            hello = json.loads(proc.stdout.readline())
            base = hello["address"].split("#")[0]
            page.goto(base + "#bootstrap=" + hello["bootstrap"])
            page.get_by_role("link", name="工程配置", exact=True).click()
            page.get_by_role("button", name="编辑工程连接").click()
            yield page, base
            assert not errors, errors
        finally:
            page.close()
            proc.stdin.close()
            proc.wait(timeout=30)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        try:
            with settings(browser, project) as (page, first_origin):
                alias = page.get_by_label("环境别名", exact=True)
                expect(alias).to_have_value("fixture-external")
                assert not directory.exists()
                alias.fill(local_alias)
                page.get_by_label("IRIS 密码", exact=True).select_option("replace")
                page.get_by_label("IRIS 密码新值", exact=True).fill(secret_input)
                assert not directory.exists() and config.read_bytes() == on_disk
                page.get_by_role("button", name="保存本机草稿", exact=True).click()
                expect(page.get_by_text(expect_saved, exact=True)).to_be_visible()
                [draft_file] = list(directory.glob("*-project.json"))
                saved = draft_file.read_bytes()
                stored_draft = json.loads(saved)
                assert stored_draft["schema"] == 1
                assert stored_draft["values"] == {"irisDevelopment.environmentAlias": local_alias}
                assert all(secret.encode() not in saved for secret in [secret_env, secret_input])
                assert config.read_bytes() == on_disk

            edited = external_edit(config, b'"environmentType": "development"', b'"environmentType": "test"')
            with settings(browser, project) as (page, new_origin):
                assert new_origin != first_origin
                expect(page.get_by_label("环境别名", exact=True)).to_have_value(local_alias)
                expect(page.get_by_label("环境类型", exact=True)).to_have_value("test")
                expect(page.get_by_text("已恢复本机草稿，请核对后重新预览。", exact=True)).to_be_visible()
                expect(page.get_by_text("草稿记录了凭据操作。请重新选择操作，替换时重新输入凭据。", exact=True)).to_be_visible()
                expect(page.get_by_label("IRIS 密码", exact=True)).to_have_value("keep")
                expect(page.get_by_label("IRIS 密码新值", exact=True)).to_have_count(0)
                assert config.read_bytes() == edited and draft_file.read_bytes() == saved

            with settings(browser, other_project) as (page, _):
                alias = page.get_by_label("环境别名", exact=True)
                expect(alias).to_have_value("fixture")
                alias.fill("fixture-other-workspace-draft")
                page.get_by_role("button", name="保存本机草稿", exact=True).click()
                expect(page.get_by_text(expect_saved, exact=True)).to_be_visible()
                assert len(list(directory.glob("*-project.json"))) == 2
                assert draft_file.read_bytes() == saved and other_config.read_bytes() == other_on_disk
                page.get_by_role("button", name="清除本机草稿", exact=True).click()
                expect(page.get_by_text(expect_cleared, exact=True)).to_be_visible()
                assert list(directory.glob("*-project.json")) == [draft_file]

            external_alias = "fixture-external-after-draft"
            edited = external_edit(config, b'"fixture-external"', f'"{external_alias}"'.encode())
            with settings(browser, project) as (page, _):
                conflict = page.get_by_role("group", name="环境别名", exact=True)
                expect(conflict.get_by_text(f"来源值 · {external_alias}", exact=True)).to_be_visible()
                expect(conflict.get_by_text(f"我的修改 · {local_alias}", exact=True)).to_be_visible()
                preview = page.get_by_role("button", name="预览修改", exact=True)
                expect(preview).to_be_disabled()
                conflict.get_by_role("button", name="保留我的修改", exact=True).click()
                expect(page.get_by_label("环境别名", exact=True)).to_have_value(local_alias)
                expect(preview).to_be_enabled()
                assert config.read_bytes() == edited and draft_file.read_bytes() == saved

            for invalid in [b'{"schema":', json.dumps({**stored_draft, "schema": 999}).encode()]:
                draft_file.write_bytes(invalid)
                with settings(browser, project) as (page, _):
                    alias = page.get_by_label("环境别名", exact=True)
                    expect(alias).to_have_value(external_alias)
                    expect(page.get_by_text("本机草稿无法读取，可继续编辑配置或清除本机草稿。", exact=True)).to_be_visible()
                    expect(alias).to_be_editable()
                    assert draft_file.read_bytes() == invalid
                    alias.fill("fixture-editable-with-invalid-draft")
                    page.get_by_role("button", name="预览修改", exact=True).click()
                    expect(page.get_by_role("button", name="保存到当前工程", exact=True)).to_be_visible()
                    page.get_by_role("button", name="重新编辑", exact=True).click()
                    page.get_by_role("button", name="清除本机草稿", exact=True).click()
                    expect(page.get_by_text(expect_cleared, exact=True)).to_be_visible()
                    assert not draft_file.exists() and config.read_bytes() == edited

            cap = project / ".agents"
            reference = "plugins/coding-iris-plugin/references/hisui-widget-index.md"
            index = cap / "vendor/knowledge-index/company.sqlite"
            knowledge = [node, cap / "scripts/knowledge-query.js", "--project-root", project]
            offline = dict(env, GIT_ALLOW_PROTOCOL="", KNOWLEDGE_RAG_CONFIG="")

            def retained_assets():
                with index.open("rb") as stream:
                    return (cap / reference).read_bytes(), index.stat().st_size, file_digest(stream, "sha256").hexdigest()

            def read_original_knowledge():
                result = json.loads(run(*knowledge, "--local-only", "--query", "comboq", "--domain", "ui", cwd=project, env=offline))
                assert result["mode"] == "lexical" and result["embeddingTokens"] == 0
                assert any(match["path"] == reference for match in result["matches"])
                return result["matches"]

            original_assets = retained_assets()
            original_matches = read_original_knowledge()
            assert original_assets[1] > 0
            with settings(browser, project) as (page, _):
                alias = page.get_by_label("环境别名", exact=True)
                expect(alias).to_have_value(external_alias)
                alias.fill("fixture-not-applied-to-owner")
                page.get_by_role("button", name="保存本机草稿", exact=True).click()
                expect(page.get_by_text(expect_saved, exact=True)).to_be_visible()
                assert draft_file.is_file() and retained_assets() == original_assets
                page.get_by_role("button", name="清除本机草稿", exact=True).click()
                expect(page.get_by_text(expect_cleared, exact=True)).to_be_visible()
                assert not draft_file.exists() and config.read_bytes() == edited
                assert retained_assets() == original_assets

            # The original installed owners still work with the Workbench service closed.
            assert read_original_knowledge() == original_matches
            policy = [node, cap / "scripts/plugin-deploy.js"]
            roots = ["--context-root", cap, "--capability-root", cap]
            assert json.loads(run(*policy, "read-policy", *roots, cwd=project, env=offline))["autoInstall"] is False
            run(*policy, "configure", "--project-root", project, "--auto-install", "true", cwd=project, env=offline)
            assert json.loads(run(*policy, "read-policy", *roots, cwd=project, env=offline))["autoInstall"] is True

            with settings(browser, project) as (page, _):
                expect(page.get_by_label("环境别名", exact=True)).to_have_value(external_alias)
                expect(page.get_by_label("允许自动补装插件", exact=True)).to_have_value("true")
                expect(page.get_by_text("已恢复本机草稿，请核对后重新预览。", exact=True)).to_have_count(0)
                page.keyboard.press("Escape")
                page.get_by_role("link", name="知识与向量", exact=True).click()
                table = page.get_by_role("table", name="公司分发索引状态")
                expect(table.get_by_text("已选装", exact=True)).to_be_visible()
                expect(table.get_by_text("格式可读", exact=True)).to_be_visible()
                page.get_by_label("关键词", exact=True).fill("comboq")
                page.get_by_role("button", name="搜索知识", exact=True).click()
                expect(page.get_by_text(reference, exact=True).first).to_be_visible()
                assert retained_assets() == original_assets
            print("Verified draft clear preserves installed knowledge and index; original CLIs and reopened UI read back", flush=True)
        finally:
            browser.close()


def exercise_interrupted_settings(stage, project, env, launcher, node="node"):
    owner = stage / "tools/ai-dev-offline/configure-project.js"
    backup = project / ".ai-dev-config-backups"
    interrupt = """const fs=require('node:fs'),path=require('node:path');
    const owner=require(process.argv[1]);
    const request={projectRoot:process.argv[2],profile:{id:'devB'}};
    request.fingerprint=owner.plan(request).fingerprint;
    const stopAt=process.argv[3];
    if(stopAt==='receipt'){
      const rename=fs.renameSync;
      fs.renameSync=(source,target)=>{
        if(path.basename(target)==='receipt.json' && JSON.parse(fs.readFileSync(source,'utf8')).state==='applied')process.exit(85);
        return rename(source,target);
      };
    }
    let writes=0;
    owner.apply(request,{beforeWrite(){if(writes++===Number(stopAt))process.exit(84)}})
      .then(()=>process.exit(stopAt==='complete' ? 0 : 1)).catch(()=>process.exit(2));"""
    abort_undo = """const fs=require('node:fs');
    const owner=require(process.argv[1]);
    const request={projectRoot:process.argv[2],receiptFile:process.argv[3]};
    const receipt=JSON.parse(fs.readFileSync(request.receiptFile,'utf8'));
    const targets=new Set(receipt.entries.map(entry=>entry.file));
    const rename=fs.renameSync, unlink=fs.unlinkSync;
    fs.renameSync=(source,target)=>{
      rename(source,target);
      if(targets.has(target))process.exit(86);
    };
    fs.unlinkSync=file=>{
      unlink(file);
      if(targets.has(file))process.exit(86);
    };
    owner.rollback(request).then(()=>process.exit(1)).catch(()=>process.exit(2));"""

    def original_files(receipt):
        return {Path(entry["file"]): base64.b64decode(entry["original"]) if entry["beforeHash"] != "absent" else None
                for entry in receipt["entries"]}

    def read_files(files):
        return {file: file.read_bytes() if file.exists() else None for file in files}

    def interrupted_save(stop_at):
        previous = set(backup.iterdir())
        aborted = subprocess.run(
            [node, "-e", interrupt, owner, project, str(stop_at)],
            cwd=project, env=env, capture_output=True, timeout=30,
        )
        assert aborted.returncode == (85 if stop_at == "receipt" else 84), aborted.stderr
        [created] = set(backup.iterdir()) - previous
        receipt_file = created / "receipt.json"
        receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
        assert receipt["state"] == "prepared"
        originals = original_files(receipt)
        actual = read_files(originals)
        written = len(originals) if stop_at == "receipt" else stop_at
        # Apply is ordered and journaled. Each prefix must match the planned hashes,
        # while all later files must still match their original bytes.
        for index, entry in enumerate(receipt["entries"]):
            file = Path(entry["file"])
            if index < written:
                assert actual[file] is not None
                assert sha256(actual[file]).hexdigest() == entry["afterHash"]
            else:
                assert actual[file] == originals[file]
        assert len(originals) > 1
        assert (project / ".gitignore").read_bytes() == ignore_before
        return receipt_file, originals, actual

    # The seeded project already has the owner-managed privacy exclusions.
    ignore_before = (project / ".gitignore").read_bytes()
    prepared_receipt, initial_files, _ = interrupted_save(0)

    server = subprocess.Popen([node, "-e", launcher, project], cwd=stage, env=env, stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, text=True, encoding="utf-8")
    try:
        hello = json.loads(server.stdout.readline())
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            context = browser.new_context()
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(hello["address"].split("#")[0] + "#bootstrap=" + hello["bootstrap"])
            page.get_by_role("link", name="任务与恢复", exact=True).click()
            untouched_row = page.get_by_role("row").filter(has_text=prepared_receipt.parent.name)
            untouched_row.get_by_text("与保存前一致", exact=True).wait_for()
            expect(untouched_row.get_by_role("button")).to_have_count(0)
            assert read_files(initial_files) == initial_files
            assert json.loads(prepared_receipt.read_text(encoding="utf-8"))["state"] == "prepared"

            receipt_file, originals, partial = interrupted_save(1)
            assert originals == initial_files
            interrupted = receipt_file.parent
            page.reload()
            row = page.get_by_role("row").filter(has_text=interrupted.name)
            restore = row.get_by_role("button", name="恢复配置", exact=True)
            restore.wait_for()
            assert read_files(originals) == partial
            assert json.loads(receipt_file.read_text(encoding="utf-8"))["state"] == "prepared"

            file = next(file for file in originals if originals[file] != partial[file])
            divergent = partial[file] + b"\n "
            restore.click()
            confirm = page.get_by_role("button", name="确认恢复", exact=True)
            confirm.wait_for()
            file.write_bytes(divergent)
            with page.expect_response(lambda r: r.url.endswith("/framework/recover-project-config")) as rejected:
                confirm.click()
            assert rejected.value.status == 409
            row.get_by_text("有后续修改", exact=False).wait_for()
            assert read_files(originals) == {**partial, file: divergent}

            file.write_bytes(partial[file])
            page.get_by_role("button", name="重新读取", exact=True).click()
            restore.click()
            with page.expect_response(lambda r: r.url.endswith("/framework/recover-project-config")) as accepted:
                confirm.click()
            assert accepted.value.ok, accepted.value.json()
            row.get_by_text("中断后已恢复", exact=True).wait_for()
            assert read_files(originals) == originals
            assert json.loads(receipt_file.read_text(encoding="utf-8"))["state"] == "reverted-after-interruption"
            page.reload()
            row.get_by_text("中断后已恢复", exact=True).wait_for()
            receipt_bytes = receipt_file.read_bytes()
            with page.expect_download() as downloaded:
                page.get_by_role("button", name="导出工程状态", exact=True).click()
            assert downloaded.value.suggested_filename == "agents-workbench-state.json"
            exported = Path(downloaded.value.path()).read_text(encoding="utf-8")
            report = json.loads(exported)
            assert report["schema"] == "agents-workbench-state/v1"
            assert report["framework"]["layout"] == "standard"
            recorded = next(item for item in report["configuration"]["receipts"] if item["id"] == interrupted.name)
            assert recorded["state"] == "reverted-after-interruption"
            central = json.loads((project / ".agents/config/project-env.json").read_text(encoding="utf-8-sig"))
            forbidden = [json.dumps(str(project), ensure_ascii=False)[1:-1], project.name, "a.invalid", "b.invalid",
                         "FIXTUREA", "FIXTUREB", "recoveryToken", "beforeHash", "afterHash"]
            forbidden += [value for pair in central.get("irisProfileCredentials", {}).values() for value in pair.values()]
            assert all(value not in exported for value in forbidden)
            assert read_files(originals) == originals
            assert receipt_file.read_bytes() == receipt_bytes

            for written in range(2, len(initial_files)):
                receipt_file, originals, partial = interrupted_save(written)
                assert originals == initial_files
                page.reload()
                partial_row = page.get_by_role("row").filter(has_text=receipt_file.parent.name)
                partial_row.get_by_text("写入待完成，可核对恢复", exact=True).wait_for()
                assert read_files(originals) == partial
                partial_row.get_by_role("button", name="恢复配置", exact=True).click()
                with page.expect_response(lambda r: r.url.endswith("/framework/recover-project-config")) as recovered:
                    page.get_by_role("button", name="确认恢复", exact=True).click()
                assert recovered.value.ok, recovered.value.json()
                partial_row.get_by_text("中断后已恢复", exact=True).wait_for()
                assert json.loads(receipt_file.read_text(encoding="utf-8"))["state"] == "reverted-after-interruption"
                assert read_files(originals) == originals
                page.reload()
                partial_row.get_by_text("中断后已恢复", exact=True).wait_for()

            full_receipt, before_save, applied_files = interrupted_save("receipt")
            assert before_save == initial_files
            full = full_receipt.parent
            page.reload()
            full_row = page.get_by_role("row").filter(has_text=full.name)
            button = full_row.get_by_role("button", name="核验保存结果", exact=True)
            button.wait_for()
            assert full_row.get_by_role("button", name="恢复配置", exact=True).count() == 0
            with page.expect_response(lambda r: r.url.endswith("/framework/recover-project-config")) as verified:
                button.click()
            assert verified.value.ok, verified.value.json()
            full_row.get_by_text("已保存并读回", exact=True).wait_for()
            assert json.loads(full_receipt.read_text(encoding="utf-8"))["state"] == "applied"
            assert read_files(before_save) == applied_files
            page.reload()
            full_row.get_by_text("已保存并读回", exact=True).wait_for()

            full_row.get_by_role("button", name="撤销本次保存", exact=True).click()
            dialog = page.get_by_role("dialog", name="撤销配置保存", exact=True)
            dialog.get_by_text("发现后续修改时会停止撤销。", exact=False).wait_for()
            assert read_files(before_save) == applied_files
            assert json.loads(full_receipt.read_text(encoding="utf-8"))["state"] == "applied"
            with page.expect_response(lambda r: r.url.endswith("/framework/recover-project-config")) as undone:
                dialog.get_by_role("button", name="确认撤销", exact=True).click()
            assert undone.value.ok, undone.value.json()
            assert undone.value.request.post_data_json["intent"] == "rollback"
            assert undone.value.json() == {"receiptId": full.name, "state": "rolled-back"}
            full_row.get_by_text("已回滚", exact=True).wait_for()
            assert json.loads(full_receipt.read_text(encoding="utf-8"))["state"] == "rolled-back"
            assert read_files(before_save) == before_save
            files = ", ".join(file.relative_to(project).as_posix() for file in before_save)
            print(f"Verified all {len(before_save) + 1} save boundaries in Edge for {files}", flush=True)

            previous = set(backup.iterdir())
            applied = subprocess.run([node, "-e", interrupt, owner, project, "complete"], cwd=project, env=env,
                                     capture_output=True)
            assert applied.returncode == 0, applied.stderr
            [resumable] = set(backup.iterdir()) - previous
            resumed_receipt = resumable / "receipt.json"
            record = json.loads(resumed_receipt.read_text(encoding="utf-8"))
            assert record["state"] == "applied"
            before_retry = original_files(record)
            applied_files = read_files(before_retry)
            aborted = subprocess.run([node, "-e", abort_undo, owner, project, resumed_receipt], cwd=project, env=env,
                                     capture_output=True)
            assert aborted.returncode == 86, aborted.stderr
            assert json.loads(resumed_receipt.read_text(encoding="utf-8"))["state"] == "rolling-back"
            restored_files = read_files(before_retry)
            assert sum(restored_files[file] == data for file, data in before_retry.items()) == 1 < len(before_retry)
            assert all(restored_files[file] in (data, applied_files[file]) for file, data in before_retry.items())

            tasks_url = page.url
            page.close()
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(tasks_url)
            resumed_row = page.get_by_role("row").filter(has_text=resumable.name)
            resumed_row.get_by_role("button", name="继续撤销", exact=True).click()
            dialog = page.get_by_role("dialog", name="撤销配置保存", exact=True)
            dialog.get_by_text(f"预计恢复 {len(before_retry) - 1} 个文件。", exact=False).wait_for()
            assert read_files(before_retry) == restored_files
            with page.expect_response(lambda r: r.url.endswith("/framework/recover-project-config")) as resumed:
                dialog.get_by_role("button", name="确认撤销", exact=True).click()
            assert resumed.value.ok, resumed.value.json()
            assert resumed.value.request.post_data_json["intent"] == "rollback"
            assert resumed.value.json() == {"receiptId": resumable.name, "state": "rolled-back"}
            resumed_row.get_by_text("已回滚", exact=True).wait_for()
            assert json.loads(resumed_receipt.read_text(encoding="utf-8"))["state"] == "rolled-back"
            assert read_files(before_retry) == before_retry
            assert not errors, errors
            browser.close()
    finally:
        server.stdin.close()
        server.wait(timeout=30)


def exercise_legacy_rollback(project, previous_runtime, updater, env, migrated):
    cap = project / ".agents"
    config = cap / "config"
    main = config / "project.jsonc"
    legacy_files = [config / name for name in ("plugin-deployment.json", "plugin_profile.md", "iris-development.json")]
    comment = b"  // preserve local notes through rollback"
    marker = b"\r\n" + comment + b'\r\n  "fixtureLocal": {"keep": true},'
    body = main.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    main.write_bytes(b"\xef\xbb\xbf" + body.removeprefix(b"\xef\xbb\xbf").replace(b"{", b"{" + marker, 1))

    def read_main():
        return json.loads(run("node", "-e", "const [helper,file]=process.argv.slice(1); const io=require(helper);"
            "console.log(JSON.stringify(io.parse(io.readText(file))));", cap / "scripts/lib/configuration-file-io.js", main))

    run("node", cap / "scripts/plugin-deploy.js", "rollback-project", "--project-root", project, cwd=project, env=env)
    domains = ("deployment", "plugins", "irisDevelopment")
    assert all(file.is_file() for file in legacy_files)
    rolled_back = read_main()
    assert not any(name in rolled_back for name in domains)
    assert rolled_back["fixtureLocal"] == {"keep": True}
    restored = {file: file.read_bytes() for file in [main, *legacy_files, project / ".mcp.json"]}

    old_tool = previous_runtime / "plugins/coding-iris-plugin/scripts/iris-tools"
    check = json.loads(run("node", old_tool / "source-sync.js", "configure", "--project-root", project,
                           "--mode", "Check", "--environment-alias", "fixture", "--environment-type", "test", cwd=project, env=env))
    assert check["developmentMode"] == check["remoteAdmission"] == "offline"
    assert check["configurationReady"] and not check["configurationGaps"]
    assert {"path": ".agents/config/iris-development.json", "status": "preserved"} in check["files"]
    sync = json.loads(run("node", old_tool / "sync-env-config.js", cwd=project, env=env))
    assert sync["status"] == "skipped-offline"
    old_list = json.loads(run("node", previous_runtime / "scripts/plugin-deploy.js", "list", "--project-root", project, cwd=project, env=env))
    assert any(row["name"] == "coding-iris-plugin" and row["status"] == "enabled" for row in old_list)
    old_policy = json.loads(run("node", "-e", "const [owner,cap]=process.argv.slice(1);"
                                "console.log(JSON.stringify(require(owner).policy(cap)));",
                                previous_runtime / "scripts/lib/plugin-deployment.js", cap, cwd=project, env=env))
    assert old_policy == migrated["deployment"]
    assert all(file.read_bytes() == expected for file, expected in restored.items())

    run(*updater, cwd=project, env=env)
    reapplied = read_main()
    assert all(reapplied[name] == migrated[name] for name in domains)
    assert reapplied["fixtureLocal"] == {"keep": True} and not any(file.exists() for file in legacy_files)
    expected = main.read_bytes()
    assert expected.startswith(b"\xef\xbb\xbf") and comment in expected
    assert b"\n" not in expected.replace(b"\r\n", b"")
    run(*updater, cwd=project, env=env)
    assert main.read_bytes() == expected and not any(file.exists() for file in legacy_files)
    print("Verified historical CLI reads offline after rollback, and stock update migrates the same project again", flush=True)


def exercise(work, interactive=False, after_staging=None, extra_paths=(), before_upgrade=None, archive=None):
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
    for name in ["BOS_MCP_CONFIG", "KNOWLEDGE_RAG_CONFIG", "IMEDICAL_DEPLOYMENT_LOCK", "PSMODULEPATH"]:
        env.pop(name, None)
    env["PSModulePath"] = str(Path(os.environ["SYSTEMROOT"]) / "System32/WindowsPowerShell/v1.0/Modules")
    cap = project / ".agents"
    ps = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]
    # Fetch through the updater actually installed at the previous release.
    target = run("git", "rev-parse", "HEAD", cwd=mirror).strip()
    baseline = run("git", "rev-parse", "e943fc29^{commit}", cwd=mirror).strip()
    legacy_project = work / "旧版" / project.name
    legacy_project.mkdir(parents=True)
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
    previous_runtime = work / "previous-runtime"
    legacy_scripts = previous_runtime / "scripts"
    shutil.copytree(legacy_cap / "scripts",legacy_scripts)
    shutil.copytree(legacy_cap / owner, previous_runtime / owner)
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
    legacy_updater = [*ps, legacy_cap / "scripts/update-agents.ps1", "-ProjectRoot", legacy_project,
                      "-Mode", "Write", "-NoPull", "-Plugin", "coding-iris-plugin"]
    exercise_legacy_rollback(legacy_project, previous_runtime, legacy_updater, env, legacy_main)
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
    node = "node"
    entry = "tools/agents-workbench/prototype/serve.js"
    if archive:
        with ZipFile(archive) as package:
            release = json.loads(package.read("workbench-release.json"))
            assert release.get("platform") == "windows-x64" and release.get("node"), "Expected a Windows x64 Workbench ZIP"
            package.extractall(stage)
        node = stage / "runtime/node.exe"
        assert run(node, "--version").strip() == f'v{release["node"]}'
        entry = "tools/agents-workbench/src/start-release.js"
        print(f'Unpacked Workbench {release["version"]} with Node {release["node"]}', flush=True)
    else:
        run(node, REPO / "tools/agents-workbench/react/package-runtime.mjs", stage)
    launcher = """const c=require('node:child_process').fork(ENTRY,
      ['--project',process.argv[1]],{silent:true});c.on('message',m=>console.log(JSON.stringify(m)));
      process.stdin.resume().once('end',()=>c.kill());c.on('exit',()=>process.exit());""".replace("ENTRY", json.dumps(entry))
    if after_staging:
        return after_staging(work,stage,project,legacy_project,mirror,env,launcher)
    profile = work / "isolated-workbench-profile"
    profile.mkdir()
    workbench_env = dict(env, USERPROFILE=str(profile))
    legacy_server = subprocess.Popen([node,"-e",launcher,legacy_project],cwd=stage,env=workbench_env,
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
    exercise_interrupted_settings(stage, legacy_project, workbench_env, launcher, node)
    selected = json.loads(run(node, cap / "scripts/knowledge-query.js", "--project-root", project,
                              "--action", "install-index", "--provider", "company", cwd=project, env=env))
    assert selected["installed"] is True and "company" in selected["providers"]
    proc = subprocess.Popen([node, "-e", launcher, project], cwd=stage, env=workbench_env,
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
            exercise_external_settings(page, main)
            page.keyboard.press("Escape")
            page.get_by_role("link", name="插件", exact=True).click()
            page.get_by_role("table", name="插件目录").get_by_text("已停用", exact=True).wait_for()
            assert not errors, errors
            browser.close()
    finally:
        proc.stdin.close()
        proc.wait(timeout=30)
    run("node", source_sync, "configure", "--project-root", project, "--mode", "Check",
        "--development-mode", "offline", "--environment-alias", "fixture-external")
    exercise_persistent_drafts(stage, project, legacy_project, workbench_env, launcher, node)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--try", dest="interactive", action="store_true", help="保留隔离项目的浏览器窗口供手动试用，按 Enter 清理")
    parser.add_argument("--archive", type=Path, help="解包并验收指定的 Windows 工作台 ZIP")
    options = parser.parse_args()
    parent = Path("D:/tmp/Codex") if Path("D:/tmp/Codex").is_dir() else Path(tempfile.gettempdir()) / "Codex"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workbench-policy-", dir=parent, ignore_cleanup_errors=False) as temp:
        exercise(Path(temp), options.interactive, archive=options.archive)
    print("Passed historical update, A/B/A profile switching, external settings edits, persistent drafts, recovery, undo, interrupted undo, state export and CLI readback")
