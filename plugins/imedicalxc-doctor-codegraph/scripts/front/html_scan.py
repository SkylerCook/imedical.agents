#!/usr/bin/env python3
"""HTML 页面静态扫描：页面元信息、脚本引用、内嵌页面、可操作元素。

只做静态解析，不渲染页面；JS 绑定关系由 js_scan.py 提供，两者在
build_front_chain_db.py 中按「页面脚本 + 元素 id」关联。
"""
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    ELEMENTS_FILE, HTML_EXTS, MAX_HTML_FILE_MB, OUTPUT_DIR, PAGES_FILE, PREFIX_VARS,
    is_probably_minified, iter_front_files, module_of, normalize_router,
    read_text, to_front_relative,
)

_EVENTS = {
    "click", "dblclick", "change", "blur", "focus", "focusin", "focusout",
    "keydown", "keyup", "keypress", "mousedown", "mouseup", "mouseover",
    "mouseout", "mouseenter", "mouseleave", "select", "submit", "scroll",
    "contextmenu", "input",
}
_EVENT_ATTR_RE = re.compile(r"^on(" + "|".join(sorted(_EVENTS)) + r")$", re.I)

_TAG_RE = re.compile(r"<([a-zA-Z][\w:-]*)\b([^>]*)>", re.S)
_ATTR_RE = re.compile(
    r"""([\w:@.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""", re.S)
_SCRIPT_BLOCK_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.S | re.I)
_STYLE_BLOCK_RE = re.compile(r"<style\b[^>]*>.*?</style\s*>", re.S | re.I)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_TITLE_RE = re.compile(r"<title\b[^>]*>(.*?)</title\s*>", re.S | re.I)
_LABEL_RE = re.compile(r"<label\b[^>]*>(.*?)</label\s*>", re.S | re.I)
_LABEL_FOR_RE = re.compile(r"""\bfor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""", re.I)
_FRAME_RE = re.compile(
    r"""<iframe\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""", re.I)
_SCRIPT_SRC_RE = re.compile(
    r"""<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""", re.I)
_CSP_INCLUDE_RE = re.compile(
    r"""<csp-include\b[^>]*?\bPage\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""", re.I)
_NAV_CALL_RE = re.compile(
    r"""(?:ShowHISUIWindow|openHISUIWindow|window\.open)\s*\(\s*["']([^"']+?\.html?[^"']*)["']""",
    re.I)
_DATA_OPTIONS_HANDLER_RE = re.compile(
    r"""\b(onClick|onChange|onSelect|onDblClick|onLoadSuccess)\s*:\s*([A-Za-z_$][\w$.]*)""")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")

_EMBED_TAGS = {"iframe", "frame"}
_TEXT_LABEL_TAGS = {"a", "button", "span", "li", "div", "label"}
_LOGIN_URL_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.-]*:|//)")

# 承载服务端配置分组键的自定义属性（按钮栏 code、菜单类型、执行单 code）
_CONFIG_ATTRS = {
    "barurl", "barcode", "btncode", "menucode", "menutype",
    "sheetcode", "pagecode", "configcode",
}


def _mask(text):
    """屏蔽注释/脚本/样式内容，保留换行以维持行号。"""
    def blank(m):
        return re.sub(r"[^\n]", " ", m.group(0))
    text = _COMMENT_RE.sub(blank, text)
    text = _SCRIPT_BLOCK_RE.sub(blank, text)
    text = _STYLE_BLOCK_RE.sub(blank, text)
    return text


def _attr_map(raw_attrs):
    attrs = {}
    for m in _ATTR_RE.finditer(raw_attrs):
        name = m.group(1).lower()
        value = m.group(2) if m.group(2) is not None else (
            m.group(3) if m.group(3) is not None else m.group(4) or "")
        if name not in attrs:
            attrs[name] = value
    return attrs


def _strip_tags(fragment):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", fragment)).strip()


def _inner_label(text, pos, tag):
    """取开标签后的可见文字，用于按钮/链接的展示名。"""
    seg = text[pos:pos + 400]
    m = re.match(r"([^<]{1,80})", seg)
    if m and m.group(1).strip():
        return m.group(1).strip()
    if tag in _TEXT_LABEL_TAGS:
        m = re.search(r"^(.*?)</" + re.escape(tag) + r"\s*>", seg, re.S)
        if m:
            return _strip_tags(m.group(1))[:80]
    return ""


def _clean_handler(expr):
    expr = (expr or "").strip().rstrip(";").strip()
    if expr.lower().startswith("javascript:"):
        expr = expr[11:].strip()
    while expr.lower().startswith("return "):
        expr = expr[7:].strip()
    return expr


def _resolve_ref(page_rel, ref):
    """把页面内的相对引用解析为 front 相对路径；外部链接原样保留。"""
    ref = (ref or "").strip()
    if not ref or _LOGIN_URL_RE.match(ref):
        return ref
    ref = ref.split("#", 1)[0].split("?", 1)[0]
    if not ref:
        return ""
    if ref.startswith("/"):
        return normalize_router(ref)
    base = Path(page_rel).parent
    try:
        resolved = (base / ref).as_posix()
    except ValueError:
        return ref
    parts = []
    for part in resolved.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def _page_comment_title(text):
    for m in _COMMENT_RE.finditer(text[:2000]):
        body = m.group(0)[4:-3].strip()
        if body and _CJK_RE.search(body):
            body = re.sub(r"^\S+\.html?\s*", "", body).strip()
            return body[:80]
    return ""


def _inline_script_constants(text):
    """页面内联脚本里的路径前缀变量（appPath 等）。

    JS 里 `appPath + "OeOrdItemCMEntry/xxx"` 的前缀由页面决定（同一份 JS 被
    门诊 / 住院页面共用），这里按页收集字面量部分，供链路构建时回填。
    """
    from js_scan import scan_text

    cands = []
    for i, m in enumerate(_SCRIPT_BLOCK_RE.finditer(text)):
        block = m.group(0)
        open_end = block.find(">")
        if open_end < 0 or re.search(r"\bsrc\s*=", block[:open_end + 1], re.I):
            continue
        code = block[open_end + 1:]
        close = code.lower().rfind("</script")
        code = code[:close] if close >= 0 else code
        try:
            rec = scan_text(f"inline#{i}", code)
        except Exception:  # 内联脚本语法怪异不影响页面其余信息
            continue
        base_line = text.count("\n", 0, m.start())
        for con in rec.get("constants", []):
            name = con.get("name") or ""
            if name.rsplit(".", 1)[-1] not in PREFIX_VARS:
                continue
            cands.append({
                "name": name,
                "expr": con.get("expr") or "",
                "terms": con.get("terms") or [],
                "line": base_line + (con.get("line") or 1),
                "owner": con.get("owner") or "",
            })
    # 页面级前缀变量在初始化函数里可能被再次赋值：门/住院共用页按 admType
    # 切换 `appPath`，两条前缀都是该页运行时可取值，不能只留首条声明。
    top_level = {c["name"] for c in cands
                 if c["owner"] in ("", "__top_level__")}
    out, seen = [], set()
    for c in cands:
        if c["owner"] not in ("", "__top_level__") and c["name"] not in top_level:
            continue
        key = (c["name"], c["expr"])
        if key in seen:
            continue
        seen.add(key)
        out.append({"name": c["name"], "expr": c["expr"],
                    "terms": c["terms"], "line": c["line"]})
    out.sort(key=lambda item: (item["line"], item["name"], item["expr"]))
    return out


def scan_page(rel_path, text):
    masked = _mask(text)
    # 提取脚本/内嵌页面引用时只屏蔽注释，不能把 script 标签本身一起屏蔽掉
    visible = _COMMENT_RE.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)

    title_m = _TITLE_RE.search(text)
    title = _strip_tags(title_m.group(1))[:120] if title_m else ""

    scripts = []
    for m in _SCRIPT_SRC_RE.finditer(visible):
        src = m.group(1) if m.group(1) is not None else (
            m.group(2) if m.group(2) is not None else m.group(3))
        resolved = _resolve_ref(rel_path, src)
        if resolved and resolved not in scripts:
            scripts.append(resolved)

    frames = []
    for m in _FRAME_RE.finditer(visible):
        src = m.group(1) if m.group(1) is not None else (
            m.group(2) if m.group(2) is not None else m.group(3))
        resolved = _resolve_ref(rel_path, src)
        if resolved and resolved not in frames:
            frames.append(resolved)
    for m in _NAV_CALL_RE.finditer(text):
        resolved = _resolve_ref(rel_path, m.group(1))
        if resolved and resolved not in frames:
            frames.append(resolved)

    includes = []
    for m in _CSP_INCLUDE_RE.finditer(masked):
        page = m.group(1) if m.group(1) is not None else (
            m.group(2) if m.group(2) is not None else m.group(3))
        resolved = _resolve_ref(rel_path, page)
        if resolved and resolved != rel_path and resolved not in includes:
            includes.append(resolved)

    # label for → 文本，用于没有内联文字的输入控件
    label_for = {}
    for m in _LABEL_RE.finditer(masked):
        label_text = _strip_tags(m.group(1))[:80]
        fm = _LABEL_FOR_RE.search(m.group(0)[:m.group(0).find(">") + 1])
        if label_text and fm:
            key = fm.group(1) if fm.group(1) is not None else (
                fm.group(2) if fm.group(2) is not None else fm.group(3))
            label_for[key] = label_text

    elements = []
    line = 1
    last = 0
    for m in _TAG_RE.finditer(masked):
        line += masked.count("\n", last, m.start())
        last = m.start()
        tag = m.group(1).lower()
        if tag in ("!", "br", "hr", "meta", "link", "img", "script", "style"):
            continue
        attrs = _attr_map(m.group(2))
        elem_id = attrs.get("id", "").strip()
        name = attrs.get("name", "").strip()
        handlers = []
        for attr_name, value in attrs.items():
            em = _EVENT_ATTR_RE.match(attr_name)
            if em:
                handler = _clean_handler(value)
                if handler:
                    handlers.append((em.group(1).lower(), handler))
        href = attrs.get("href", "")
        if href and href.strip().lower().startswith("javascript:"):
            handler = _clean_handler(href)
            if handler:
                handlers.append(("click", handler))
        data_options = attrs.get("data-options", "")
        if data_options:
            for dm in _DATA_OPTIONS_HANDLER_RE.finditer(data_options):
                handlers.append(("click" if dm.group(1).lower().startswith("onclick")
                                 else dm.group(1)[2:].lower(), dm.group(2)))

        label = _inner_label(masked, m.end(), tag)
        if not label:
            label = attrs.get("value", "") or attrs.get("title", "") or attrs.get("alt", "")
        if not label and elem_id:
            label = label_for.get(elem_id, "")
        label = _strip_tags(label)[:80]

        if not (elem_id or name or handlers):
            continue
        if not handlers and not elem_id:
            continue
        base = {"page": rel_path, "tag": tag, "line": line}
        if elem_id:
            base["id"] = elem_id
        config_attrs = {k: v for k, v in attrs.items()
                        if k.lower() in _CONFIG_ATTRS and v}
        if config_attrs:
            # 服务端配置按钮栏的分组键可能写在自定义属性上（如 barurl）
            base["config_attrs"] = config_attrs
        if name:
            base["name"] = name
        if label:
            base["label"] = label
        if attrs.get("class"):
            base["cls"] = attrs["class"][:120]
        if not handlers:
            base["event"] = "click"
            base["handler"] = ""
            elements.append(base)
            continue
        for event, handler in handlers:
            rec = dict(base, event=event, handler=handler)
            elements.append(rec)

    inline_constants = _inline_script_constants(text)

    return {
        "file": rel_path,
        "module": module_of(rel_path),
        "title": title,
        "comment_title": _page_comment_title(text),
        "scripts": scripts,
        "frames": frames,
        "includes": includes,
        "inline_constants": inline_constants,
        "elements": elements,
        "stats": {"bytes": len(text), "elements": len(elements),
                  "includes": len(includes), "inline_constants": len(inline_constants)},
    }


def _scan_one(args):
    path_str, rel = args
    path = Path(path_str)
    try:
        if path.stat().st_size > MAX_HTML_FILE_MB * 1024 * 1024:
            return {"file": rel, "skipped": "oversize"}
        text = read_text(path)
        return scan_page(rel, text)
    except Exception as exc:  # 单页失败不阻断全量构建
        return {"file": rel, "error": f"{type(exc).__name__}: {exc}"}


def _write_jsonl(path, records):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            f.write("\n")
    tmp.replace(path)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    files = [(str(p), rel) for p, rel in iter_front_files(HTML_EXTS)]
    print(f"扫描 {len(files)} 个 HTML 页面...")
    results = []
    workers = max(1, min(8, (__import__("os").cpu_count() or 4)))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for idx, rec in enumerate(pool.map(_scan_one, files, chunksize=16), 1):
            results.append(rec)
            if idx % 1000 == 0:
                print(f"  {idx}/{len(files)}")
    results.sort(key=lambda r: r.get("file", ""))

    pages = [r for r in results if "error" not in r and "skipped" not in r]
    elements = []
    for page in pages:
        for elem in page["elements"]:
            elements.append(elem)
    elements.sort(key=lambda e: (e["page"], e["line"], e.get("id", ""), e["event"]))

    _write_jsonl(PAGES_FILE, results)
    _write_jsonl(ELEMENTS_FILE, elements)

    ok = len(pages)
    skipped = sum(1 for r in results if "skipped" in r)
    errors = sum(1 for r in results if "error" in r)
    print(f"完成: {ok} 个页面, {len(elements)} 个操作元素, {skipped} 跳过, {errors} 失败")
    print(f"  → {PAGES_FILE}")
    print(f"  → {ELEMENTS_FILE}")


if __name__ == "__main__":
    main()
