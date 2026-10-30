# -*- coding: utf-8 -*-
"""解析「数据变更通知邮件」的收件人与抄送人。

- 收件人：腾讯文档「信创版HIS数据库升级脚本汇总表格」配置子表（默认「脚本执行负责人」）
          的「负责人邮箱」列，去重后作为 To。
- 抄送人：网易企业邮 CardDAV 通讯录配置分组（默认「信创-研发-医生站」「信创-研发-监督人」）
          的成员邮箱，去重（并剔除已出现在收件人中的人）后作为 Cc。

数据源与列位置在 config/commit-report-push.json 的 email.recipientSource / email.ccSource 配置。
成功后将结果写回 email.recipients / email.cc / email.recipientsResolvedAt（该 config 为本地文件、不入库），
并把摘要以 JSON 打印到 stdout；失败时非零退出、不覆盖已有配置（流程沿用上次结果并告警）。

收件人/抄送人个人邮箱不写入入库配置，可用环境变量直接指定（优先于实时解析）：
- COMMIT_REPORT_EMAIL_RECIPIENTS：逗号分隔的收件人邮箱
- COMMIT_REPORT_EMAIL_CC：逗号分隔的抄送人邮箱
环境变量缺失时回退 <仓库根>/.qoder/settings.local.json 的 commitReport.env 同名键。

凭据运行时读取（不落盘到本脚本/配置）：
- 腾讯文档：环境变量 TD_CLIENT_ID / TD_OPEN_ID / TD_ACCESS_TOKEN，
  缺省回退 ~/.qoder/settings.json 的 mcpServers["tencent-docs"].env
- 邮箱（CardDAV）：环境变量 MCP_EMAIL_SERVER_EMAIL_ADDRESS / MCP_EMAIL_SERVER_PASSWORD，
  缺省回退 <仓库根>/.qoder/settings.local.json 的 mcpServers["email"].env
"""

import argparse
import base64
import http.client
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(os.path.dirname(HERE), "config", "commit-report-push.json")
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
USER_SETTINGS = os.path.join(os.path.expanduser("~"), ".qoder", "settings.json")
PROJECT_SETTINGS = os.path.join(REPO_ROOT, ".qoder", "settings.local.json")

TD_BASE = "https://docs.qq.com/openapi"
CARDDAV_HOST = "contacts.qiye.163.com"

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
DAV = "{DAV:}"
CD = "{urn:ietf:params:xml:ns:carddav}"


def config_env(name):
    """读取运行期配置：优先进程环境变量，其次 .qoder/settings.local.json 的 commitReport.env。"""
    v = os.environ.get(name)
    if v:
        return v
    try:
        with open(PROJECT_SETTINGS, encoding="utf-8") as f:
            env = (json.load(f).get("commitReport") or {}).get("env") or {}
        v = env.get(name)
        return str(v) if v else ""
    except (OSError, ValueError):
        return ""


def config_env_hint(name, purpose):
    return (
        "缺少 %s（%s）。请在 shell 环境变量或 %s 的 commitReport.env 中配置。"
        % (name, purpose, PROJECT_SETTINGS)
    )


def split_emails(raw):
    return [s.strip() for s in re.split(r"[,;\s]+", raw or "") if s.strip()]


def log(msg):
    print(msg, file=sys.stderr)


def fail(msg):
    log("ERROR: " + msg)
    sys.exit(1)


# ---------- 腾讯文档（收件人来源） ----------

def _load_td_settings():
    """从多个来源合并腾讯文档凭据，返回 (env_dict, source_label)"""
    env = {}
    for settings_path, label in [
        (USER_SETTINGS, "user"),
        (PROJECT_SETTINGS, "project"),
    ]:
        try:
            with open(settings_path, encoding="utf-8") as f:
                m = json.load(f).get("mcpServers", {}).get("tencent-docs", {}).get("env", {})
            for k, v in m.items():
                if v and k not in env:
                    env[k] = v
        except OSError:
            pass
    return env


def load_td_env():
    """加载直连 API 凭据（Client-Id / Open-Id / Access-Token）"""
    cid = os.environ.get("TD_CLIENT_ID")
    oid = os.environ.get("TD_OPEN_ID")
    tok = os.environ.get("TD_ACCESS_TOKEN")
    if not (cid and oid and tok):
        env = _load_td_settings()
        cid = cid or env.get("TD_CLIENT_ID")
        oid = oid or env.get("TD_OPEN_ID")
        tok = tok or env.get("TD_ACCESS_TOKEN")
    if cid and oid and tok:
        return {
            "Client-Id": cid,
            "Open-Id": oid,
            "Access-Token": tok,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
    return None


def load_td_mcp_env():
    """加载 MCP HTTP 代理凭据（TD_TOKEN + TD_MCP_URL）"""
    tok = os.environ.get("TD_TOKEN")
    url = os.environ.get("TD_MCP_URL")
    if not (tok and url):
        env = _load_td_settings()
        tok = tok or env.get("TD_TOKEN")
        url = url or env.get("TD_MCP_URL") or "https://docs.qq.com/openapi/mcp"
    if tok and url:
        return {"token": tok, "url": url}
    return None


def td_get(path, headers):
    req = urllib.request.Request(TD_BASE + path, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        fail("腾讯文档接口 %s 返回 HTTP %s %s" % (path.split("?")[0], e.code, detail))
    data = json.loads(raw)
    if isinstance(data, dict) and data.get("ret") not in (None, 0):
        fail("腾讯文档接口 %s 返回 ret=%s msg=%s" % (path.split("?")[0], data.get("ret"), data.get("msg")))
    return data


def _mcp_call(mcp_env, tool_name, arguments):
    """通过 MCP HTTP 协议调用工具，返回 result content"""
    session_id = None
    # initialize
    init_body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                    "clientInfo": {"name": "resolve-recipients", "version": "1.0"}},
    }).encode("utf-8")
    req = urllib.request.Request(mcp_env["url"], data=init_body, method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": mcp_env["token"],
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        session_id = resp.headers.get("mcp-session-id")
        resp.read()

    # tools/call
    call_body = json.dumps({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": mcp_env["token"],
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    req = urllib.request.Request(mcp_env["url"], data=call_body, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")

    # parse SSE or JSON
    text = raw.strip()
    if text.startswith("event:"):
        for line in text.split("\n"):
            line = line.strip()
            if line.startswith("data:"):
                text = line[5:].strip()
                break
    result = json.loads(text)
    if "error" in result:
        fail("MCP %s 错误: %s" % (tool_name, result["error"]))
    return result.get("result", {}).get("content", [])


def col_letter(idx0):
    s = ""
    n = idx0 + 1
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def cell_text(c):
    cv = (c or {}).get("cellValue")
    if not cv:
        return ""
    if cv.get("link"):
        return str(cv["link"].get("text") or cv["link"].get("url") or "").strip()
    if cv.get("text") is not None:
        return str(cv["text"]).strip()
    if cv.get("select"):
        return ",".join(cv["select"].get("value") or []).strip()
    if cv.get("number") is not None:
        return str(cv["number"]).strip()
    return ""


def resolve_from_sheet(src, headers):
    """从腾讯文档子表解析收件人邮箱（负责人邮箱列去重）"""
    book = src["bookId"]
    sheet_id = src.get("sheetId")
    sheet_title = src.get("sheetTitle")
    col = int(src.get("emailColumn", 2))
    enc = urllib.parse.quote(book, safe="")

    info = td_get("/sheetbook/v2/%s/sheets-info" % enc, headers)
    sheet_data = (info.get("data") or {}).get("sheetData") or []
    target = None
    for s in sheet_data:
        if sheet_id and s.get("sheetID") == sheet_id:
            target = s
            break
        if not sheet_id and sheet_title and s.get("title") == sheet_title:
            target = s
            break
    if not target:
        fail("子表未找到（sheetId=%s sheetTitle=%s），现有子表: %s"
             % (sheet_id, sheet_title, [(s.get("sheetID"), s.get("title")) for s in sheet_data]))

    rows = int(target.get("rowCount") or 200)
    rng = "A1:%s%d" % (col_letter(col), rows + 5)
    data = td_get("/spreadsheet/v3/files/%s/%s/%s"
                  % (enc, urllib.parse.quote(target["sheetID"], safe=""), urllib.parse.quote(rng, safe="")),
                  headers)
    grid = (data.get("gridData") or {}).get("rows") or []
    out, seen = [], set()
    for row in grid:
        values = row.get("values") or []
        if col >= len(values):
            continue
        t = cell_text(values[col])
        if EMAIL_RE.match(t) and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    if not out:
        fail("子表「%s」未解析到任何邮箱（emailColumn=%d）" % (target.get("title"), col))
    log("收件人来源子表「%s」（%d 行），解析 %d 个邮箱" % (target.get("title"), rows, len(out)))
    return out


def resolve_from_sheet_mcp(src, mcp_env):
    """通过 MCP HTTP 协议从腾讯文档子表解析收件人邮箱"""
    book = src["bookId"]
    sheet_id = src.get("sheetId")
    col = int(src.get("emailColumn", 2))

    content = _mcp_call(mcp_env, "sheet.get_cell_data", {
        "file_id": book,
        "sheet_id": sheet_id,
        "start_col": col,
        "end_col": col,
        "start_row": 0,
        "end_row": 60,
        "return_csv": True,
    })
    csv_text = ""
    for item in content:
        if item.get("type") == "text":
            raw_text = item.get("text", "")
            try:
                parsed = json.loads(raw_text)
                csv_text = parsed.get("csv_data", "")
            except (json.JSONDecodeError, TypeError):
                csv_text = raw_text
            break
    if not csv_text:
        fail("MCP sheet.get_cell_data 返回空数据")

    out, seen = [], set()
    for line in csv_text.strip().split("\n"):
        t = line.strip().strip('"')
        if EMAIL_RE.match(t) and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    if not out:
        fail("MCP 子表「%s」未解析到任何邮箱（emailColumn=%d）" % (sheet_id, col))
    log("收件人来源 MCP 子表「%s」，解析 %d 个邮箱" % (sheet_id, len(out)))
    return out


# ---------- CardDAV 通讯录（抄送人来源） ----------

def load_email_auth():
    user = os.environ.get("MCP_EMAIL_SERVER_EMAIL_ADDRESS")
    pwd = os.environ.get("MCP_EMAIL_SERVER_PASSWORD")
    if not (user and pwd):
        try:
            with open(PROJECT_SETTINGS, encoding="utf-8") as f:
                m = json.load(f).get("mcpServers", {}).get("email", {}).get("env", {})
            user = user or m.get("MCP_EMAIL_SERVER_EMAIL_ADDRESS")
            pwd = pwd or m.get("MCP_EMAIL_SERVER_PASSWORD")
        except OSError as e:
            log("读取 %s 失败: %s" % (PROJECT_SETTINGS, e))
    if not (user and pwd):
        fail("缺少邮箱凭据（环境变量 MCP_EMAIL_SERVER_* 或 %s 的 mcpServers['email'].env）" % PROJECT_SETTINGS)
    return "Basic " + base64.b64encode(("%s:%s" % (user, pwd)).encode("utf-8")).decode("ascii")


def dav_req(auth, method, path, body=None, depth=None):
    conn = http.client.HTTPSConnection(CARDDAV_HOST, 443, context=ssl.create_default_context(), timeout=60)
    headers = {"Authorization": auth, "Accept": "*/*"}
    if body is not None:
        headers["Content-Type"] = 'application/xml; charset="utf-8"'
    if depth is not None:
        headers["Depth"] = str(depth)
    conn.request(method, path, body=body, headers=headers)
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    if resp.status not in (200, 207):
        fail("CardDAV %s %s 返回 %s" % (method, path, resp.status))
    return data


def unfold(text):
    out = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.startswith((" ", "\t")) and out:
            out[-1] += line[1:]
        else:
            out.append(line)
    return out


def resolve_from_carddav(group_names):
    """从 CardDAV 通讯录分组解析抄送人邮箱（成员邮箱去重）"""
    auth = load_email_auth()

    body = dav_req(auth, "PROPFIND", "/.well-known/carddav",
                   b'<?xml version="1.0" encoding="utf-8"?>'
                   b'<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
                   depth=0)
    root = ET.fromstring(body)
    principal = None
    for e in root.iter(DAV + "current-user-principal"):
        for h in e.iter(DAV + "href"):
            principal = h.text
            break
    if not principal:
        fail("CardDAV 未解析到 current-user-principal")

    body = dav_req(auth, "PROPFIND", principal,
                   b'<?xml version="1.0" encoding="utf-8"?>'
                   b'<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">'
                   b"<d:prop><c:addressbook-home-set/></d:prop></d:propfind>",
                   depth=0)
    root = ET.fromstring(body)
    home = None
    for e in root.iter(CD + "addressbook-home-set"):
        for h in e.iter(DAV + "href"):
            home = h.text
            break
    if not home:
        fail("CardDAV 未解析到 addressbook-home-set")
    book = home.rstrip("/") + "/contacts/"

    # 该服务器 allprop 的 propstat 全 404 属正常，取 href 列表即可
    body = dav_req(auth, "PROPFIND", book,
                   b'<?xml version="1.0" encoding="utf-8"?>'
                   b'<d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>',
                   depth=1)
    root = ET.fromstring(body)
    hrefs = [h.text for h in root.iter(DAV + "href") if h.text and h.text.endswith(".vcf")]
    if not hrefs:
        fail("CardDAV 通讯录未发现 .vcf 卡片")

    parts = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<c:addressbook-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">',
        "<d:prop><c:address-data/></d:prop>",
    ]
    for h in hrefs:
        parts.append("<d:href>%s</d:href>" % h)
    parts.append("</c:addressbook-multiget>")
    body = dav_req(auth, "REPORT", book, "".join(parts).encode("utf-8"), depth=1)
    root = ET.fromstring(body)

    cards = {}
    groups = {}
    for resp in root.iter(DAV + "response"):
        for ad in resp.iter(CD + "address-data"):
            if not ad.text:
                continue
            props = {}
            for line in unfold(ad.text):
                if ":" not in line:
                    continue
                left, _, value = line.partition(":")
                props.setdefault(left.split(";")[0].upper(), []).append(value)
            uid = (props.get("UID") or [""])[0]
            fn = (props.get("FN") or [""])[0]
            kind = (props.get("X-ADDRESSBOOKSERVER-KIND") or [""])[0]
            emails = [v.strip() for v in props.get("EMAIL", []) if v.strip()]
            members = [v.strip() for v in props.get("X-ADDRESSBOOKSERVER-MEMBER", []) if v.strip()]
            if uid:
                cards[uid] = {"fn": fn, "emails": emails}
            if kind == "group" or members:
                groups[fn] = members

    out, seen = [], set()
    for g in group_names:
        if g not in groups:
            fail("通讯录分组「%s」不存在，现有分组: %s" % (g, sorted(groups.keys())))
        got = 0
        for ref in groups[g]:
            key = ref[len("urn:uuid:"):] if ref.startswith("urn:uuid:") else ref
            mc = cards.get(key)
            if not mc or not mc["emails"]:
                log("分组「%s」成员 %s 未解析到邮箱，跳过" % (g, ref))
                continue
            for em in mc["emails"]:
                if EMAIL_RE.match(em) and em.lower() not in seen:
                    seen.add(em.lower())
                    out.append(em)
                    got += 1
        if got == 0:
            fail("通讯录分组「%s」未解析到任何成员邮箱" % g)
    log("抄送来源分组「%s」，解析 %d 个邮箱" % ("、".join(group_names), len(out)))
    return out


def main():
    ap = argparse.ArgumentParser(description="解析数据变更通知邮件收件人/抄送人")
    ap.add_argument("--no-write", action="store_true", help="只解析并打印，不写回配置")
    args = ap.parse_args()

    if not os.path.exists(CONFIG_PATH):
        fail("配置文件不存在: %s" % CONFIG_PATH)
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    email_cfg = cfg.get("email") or {}
    rec_src = email_cfg.get("recipientSource")
    cc_src = email_cfg.get("ccSource")
    if not rec_src:
        fail("email.recipientSource 未配置")
    if not cc_src:
        fail("email.ccSource 未配置")

    cached_to = email_cfg.get("recipients") or []
    cached_cc = email_cfg.get("cc") or []
    cached_at = email_cfg.get("recipientsResolvedAt", "N/A")
    warnings = []

    # --- 收件人：环境变量直填 > 实时获取腾讯文档 > 本地缓存 ---
    to_list = None
    env_to = split_emails(config_env("COMMIT_REPORT_EMAIL_RECIPIENTS"))
    if env_to:
        to_list = env_to
        log("收件人：使用环境变量 COMMIT_REPORT_EMAIL_RECIPIENTS（%d 个）" % len(to_list))
    # 路径 1：直连 API（Client-Id / Open-Id / Access-Token）
    if to_list is None:
        try:
            td_headers = load_td_env()
            if td_headers:
                to_list = resolve_from_sheet(rec_src, td_headers)
                log("收件人：直连 API 获取成功（%d 个）" % len(to_list))
        except SystemExit:
            pass
    # 路径 2：MCP HTTP 代理（TD_TOKEN + TD_MCP_URL）
    if to_list is None:
        try:
            mcp_env = load_td_mcp_env()
            if mcp_env:
                to_list = resolve_from_sheet_mcp(rec_src, mcp_env)
                log("收件人：MCP 代理获取成功（%d 个）" % len(to_list))
        except SystemExit:
            pass
    if to_list is None:
        if cached_to:
            warnings.append("收件人：腾讯文档获取失败，沿用缓存（%d 个，解析于 %s）" % (len(cached_to), cached_at))
            log("WARNING: %s" % warnings[-1])
            to_list = list(cached_to)
        else:
            fail("收件人：腾讯文档获取失败且无缓存可用。" + config_env_hint(
                "COMMIT_REPORT_EMAIL_RECIPIENTS", "逗号分隔的收件人邮箱"))

    # --- 抄送人：环境变量直填 > 实时获取 CardDAV > 本地缓存 ---
    cc_list = None
    env_cc = split_emails(config_env("COMMIT_REPORT_EMAIL_CC"))
    if env_cc:
        cc_list = env_cc
        log("抄送人：使用环境变量 COMMIT_REPORT_EMAIL_CC（%d 个）" % len(cc_list))
    if cc_list is None:
        try:
            cc_list = resolve_from_carddav(cc_src.get("groups") or ["信创-研发-医生站", "信创-研发-监督人"])
            log("抄送人：实时获取成功（%d 个）" % len(cc_list))
        except SystemExit:
            pass
    if cc_list is None:
        if cached_cc:
            warnings.append("抄送人：CardDAV 获取失败，沿用缓存（%d 个，解析于 %s）" % (len(cached_cc), cached_at))
            log("WARNING: %s" % warnings[-1])
            cc_list = list(cached_cc)
        else:
            fail("抄送人：CardDAV 获取失败且无缓存可用。" + config_env_hint(
                "COMMIT_REPORT_EMAIL_CC", "逗号分隔的抄送人邮箱"))

    # --- 去重：抄送人剔除收件人 ---
    to_low = {e.lower() for e in to_list}
    cc_list = [e for e in cc_list if e.lower() not in to_low]

    result = {
        "to": to_list, "cc": cc_list,
        "toCount": len(to_list), "ccCount": len(cc_list),
    }
    if warnings:
        result["warnings"] = warnings
    if not args.no_write:
        email_cfg["recipients"] = to_list
        email_cfg["cc"] = cc_list
        email_cfg["recipientsResolvedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
        cfg["email"] = email_cfg
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
            f.write("\n")
        result["configWritten"] = CONFIG_PATH
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
