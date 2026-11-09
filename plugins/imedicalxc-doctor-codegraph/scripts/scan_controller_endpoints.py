#!/usr/bin/env python3
"""扫描工作区 Controller 的映射注解，生成 controller_endpoints.json。

类上的 @RequestMapping 与方法上的 @PostMapping/@GetMapping/@PutMapping/
@DeleteMapping/@RequestMapping 决定 URL，与方名无关（如 preOpRegist →
/opreg/adm/opregBroker/preOpRegist）。索引按 URL 路径归组，方法侧关系由
`controller_fqn.method` 反查，供前后端衔接与影响分析直接消费，避免每次查询
重新扫描 1,600+ 个 Java 文件。

用法:
    python scan_controller_endpoints.py            # 重建索引
    python scan_controller_endpoints.py --check    # 只报告与源码是否一致
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import INFRA_REPOS, OUTPUT_DIR, WORKSPACE_REPOS, WORKSPACE_ROOT, to_repo_relative

ENDPOINT_FILE = OUTPUT_DIR / "controller_endpoints.json"

PKG_RE = re.compile(r"^\s*package\s+([\w.]+);", re.M)
IMPORT_RE = re.compile(r"^\s*import\s+(?!static\b)([\w.]+?)(\.\*)?\s*;", re.M)
# public class 后可能跟 extends / implements，类名在 class 之后
CLASS_RE = re.compile(r"\b(?:public\s+)?(?:abstract\s+|final\s+)?class\s+(\w+)")
MAPPING_RE = re.compile(
    r"@(RequestMapping|PostMapping|GetMapping|PutMapping|DeleteMapping)\s*(?:\(([^)]*)\))?", re.S)
VALUE_RE = re.compile(r'"([^"]*)"')
MODIFIER_RE = re.compile(
    r"^(?:public|protected|private|default)\s+"
    r"(?:(?:static|final|synchronized|native|abstract|strictfp)\s+)*")
# 与 query_commit_impact.TYPE_TOKEN_RE 同口径：排除注解名，只取类型短名
TYPE_TOKEN_RE = re.compile(r"(?<!@)\b[A-Z][A-Za-z0-9_$]*\b")
VERB = {"PostMapping": "POST", "GetMapping": "GET", "PutMapping": "PUT", "DeleteMapping": "DELETE"}


def strip_comments(text):
    # 保留块注释占用的换行数，后续按字符偏移换算行号才与源文件一致
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def _verbs(ann_name, args):
    if ann_name in VERB:
        return VERB[ann_name]
    found = re.findall(r"RequestMethod\.(\w+)", args or "")
    return found[0] if found else "ANY"


def _paths(args):
    """只取映射路径，跳过 produces/consumes/name 等字符串属性。"""
    if not args:
        return []
    named = re.search(r"\b(?:value|path)\s*=\s*(\{[^}]*\}|\"[^\"]*\")", args)
    if named:
        return VALUE_RE.findall(named.group(1))
    positional = re.split(r"\b(?:method|params|headers|consumes|produces|name|value|path)\s*=", args)[0]
    return VALUE_RE.findall(positional)


def _join(*parts):
    return "/".join(p.strip("/") for p in parts if p and p.strip("/")).lower()


def _norm(text):
    return re.sub(r"\s+", " ", text or "").strip()


def _balanced(text, open_idx):
    """从 '(' 起做括号配平，返回内部参数文本（注解内的括号不影响）。"""
    depth = 0
    for i in range(open_idx, len(text)):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1:i]
    return ""


def _split_params(raw):
    """按顶层逗号切参数，泛型与嵌套括号内的逗号不切。"""
    out, buf, depth = [], [], 0
    for ch in raw:
        if ch in "<([{":
            depth += 1
        elif ch in ">)]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(_norm("".join(buf)))
            buf = []
        else:
            buf.append(ch)
    out.append(_norm("".join(buf)))
    return [p for p in out if p]


def _skip_annotation(text, i):
    """跳过 @Xxx 或 @Xxx(...)，返回结束位置；不是注解返回 None。"""
    m = re.match(r"@[\w.]+", text[i:])
    if not m:
        return None
    j = i + m.end()
    k = j
    while k < len(text) and text[k].isspace():
        k += 1
    if k < len(text) and text[k] == "(":
        depth = 0
        for p in range(k, len(text)):
            if text[p] == "(":
                depth += 1
            elif text[p] == ")":
                depth -= 1
                if depth == 0:
                    return p + 1
        return None
    return j


def _signature(text, start, limit=1200):
    """从映射注解结束处解析方法签名，返回 (返回类型, 方法名, 参数列表)。

    只接受紧邻的声明：注解与方法之间出现 `;`/`{`/`}` 说明映射挂的不是方法，
    宁可漏记也不把入口错配到后面的方法上。
    """
    window = text[start:start + limit]
    i = 0
    while True:
        ws = re.match(r"\s+", window[i:])
        if ws:
            i += ws.end()
        if window[i:i + 1] == "@":
            j = _skip_annotation(window, i)
            if j is None:
                return None
            i = j
            continue
        break
    open_rel = window.find("(", i)
    if open_rel < 0:
        return None
    head = MODIFIER_RE.sub("", _norm(window[i:open_rel]))
    if re.search(r"[;{}=]", head):
        return None
    ret_type, sep, method = head.rpartition(" ")
    if not sep or not re.fullmatch(r"[A-Za-z_$][\w$]*", method):
        return None
    return ret_type, method, _split_params(_balanced(text, start + open_rel))


def parse_controller(path):
    """解析单个 Controller 源文件，返回 (fqn, 类级路径, 端点列表, 类型作用域)。

    类型作用域记录显式 import 与通配 import，类型反查按全限定类名匹配，
    避免不同模块的同名 DTO（如 ipcare/opcare 各自的 FeignOeStopMultiDTO）串号。
    """
    text = strip_comments(path.read_text(encoding="utf-8", errors="ignore"))
    pm, cm = PKG_RE.search(text), CLASS_RE.search(text)
    if not (cm and "Controller" in cm.group(1)):
        return "", "", [], {}
    pkg = pm.group(1) if pm else ""
    cls = cm.group(1)
    fqn = f"{pkg}.{cls}" if pkg else cls
    class_pos = cm.start()

    base = ""
    for m in MAPPING_RE.finditer(text[:class_pos]):
        if m.group(1) == "RequestMapping":
            vals = _paths(m.group(2))
            base = vals[0] if vals else ""
            break

    endpoints = []
    for m in MAPPING_RE.finditer(text, class_pos):
        sig = _signature(text, m.end())
        if not sig:
            continue
        ret_type, method, parameters = sig
        values = _paths(m.group(2))
        if not values:
            continue
        http = _verbs(m.group(1), m.group(2))
        for value in values:
            endpoints.append({
                "path": _join(base, value),
                "http": http,
                "controller": cls,
                "controller_fqn": fqn,
                "method": method,
                "return_type": ret_type,
                "parameters": parameters,
                "class_path": _join(base),
                "method_path": _join(value),
                "file": to_repo_relative(path),
                "line": text.count("\n", 0, m.start()) + 1,
            })

    referenced = set()
    for ep in endpoints:
        referenced.update(type_names(ep))
    imports, wildcards = {}, []
    for m in IMPORT_RE.finditer(text[:class_pos]):
        target, wildcard = m.group(1), m.group(2)
        if wildcard:
            wildcards.append(target)
        elif target.rsplit(".", 1)[-1] in referenced:
            imports[target.rsplit(".", 1)[-1]] = target
    scope = {"package": pkg, "imports": imports, "wildcards": sorted(wildcards)}
    return fqn, _join(base), endpoints, scope


def type_names(ep):
    """端点签名里出现的类型短名（返回类型 + 入参）。"""
    names = set(TYPE_TOKEN_RE.findall(ep.get("return_type") or ""))
    for p in ep.get("parameters") or []:
        names.update(TYPE_TOKEN_RE.findall(p or ""))
    return names


def controller_files():
    files = []
    for repo in WORKSPACE_REPOS + INFRA_REPOS:
        root = WORKSPACE_ROOT / "src" / "backend" / repo
        if not root.is_dir():
            continue
        for p in root.rglob("*Controller.java"):
            if "src/main/java" in p.as_posix():
                files.append(p)
    return sorted(files)


def source_digest(files):
    """按源码内容（而非 mtime）判定新鲜度，保证不同机器/克隆上结果可复现。"""
    h = hashlib.sha256()
    for path in files:
        h.update(to_repo_relative(path).encode("utf-8"))
        h.update(hashlib.sha256(path.read_bytes()).digest())
    return h.hexdigest()


def build_index(files, digest=""):
    endpoints = {}
    classes = set()
    scopes = {}
    for path in files:
        fqn, _, eps, scope = parse_controller(path)
        if fqn:
            classes.add(fqn)
            scopes[fqn] = scope
        for ep in eps:
            endpoints.setdefault(ep["path"], []).append(ep)
    for items in endpoints.values():
        items.sort(key=lambda x: (x["controller_fqn"], x["method"], x["http"]))
    return {
        "meta": {
            "source_digest": digest,
            "sources": len(files),
            "repos": WORKSPACE_REPOS + INFRA_REPOS,
            "controllers": len(classes),
            "endpoints": len(endpoints),
            "mappings": sum(len(v) for v in endpoints.values()),
        },
        "endpoints": dict(sorted(endpoints.items())),
        "type_scopes": dict(sorted(scopes.items())),
    }


def scan():
    files = controller_files()
    if not files:
        sys.exit(f"未找到 Controller 源文件，请确认工作区根目录: {WORKSPACE_ROOT}")
    return build_index(files, source_digest(files))


def save(index):
    ENDPOINT_FILE.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")),
                             encoding="utf-8")
    return ENDPOINT_FILE


def load():
    """读取构建产物；缺失或损坏返回 None，由调用方决定是否重建。"""
    if not ENDPOINT_FILE.exists():
        return None
    try:
        data = json.loads(ENDPOINT_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if data.get("endpoints") else None


def method_index(endpoints):
    """controller_fqn.method → [{http, path, class_path, method_path, file, line}]。"""
    out = {}
    for path, items in endpoints.items():
        for ep in items:
            out.setdefault(f"{ep['controller_fqn']}.{ep['method']}", []).append({
                "http": ep.get("http", ""),
                "path": path,
                "class_path": ep.get("class_path", ""),
                "method_path": ep.get("method_path", ""),
                "file": ep.get("file", ""),
                "line": ep.get("line"),
            })
    for items in out.values():
        items.sort(key=lambda x: (x["path"], x["http"]))
    return out


def resolve_type(scope, name):
    """把签名里的类型短名解析为候选全限定名。

    只认显式 import、同包、通配 import 三种来源；跨模块同名 DTO 不会互相命中。
    """
    scope = scope or {}
    fqns = set()
    imports = scope.get("imports") or {}
    if name in imports:
        fqns.add(imports[name])
    pkg = scope.get("package") or ""
    if pkg:
        fqns.add(f"{pkg}.{name}")
    for wildcard in scope.get("wildcards") or []:
        fqns.add(f"{wildcard}.{name}")
    return fqns


def type_index(endpoints, scopes=None):
    """类型全限定名 → Controller 方法签名中的使用关系（返回类型 / 入参）。

    纯 DTO/VO/PO 提交在方法调用图里没有方法节点，按此反查仍能落到
    Controller 入口，再由前端链路库衔接到页面。只覆盖签名内的类型，
    嵌套在字段里的类型不在此列。
    """
    scopes = scopes or {}
    out = {}
    for path, items in endpoints.items():
        for ep in items:
            ret_types = set(TYPE_TOKEN_RE.findall(ep.get("return_type") or ""))
            param_types = set()
            for p in ep.get("parameters") or []:
                param_types.update(TYPE_TOKEN_RE.findall(p or ""))
            scope = scopes.get(ep["controller_fqn"])
            for name in ret_types | param_types:
                usage = sorted(
                    (["return"] if name in ret_types else [])
                    + (["parameter"] if name in param_types else [])
                )
                for fqn in resolve_type(scope, name):
                    out.setdefault(fqn, []).append({
                        "controller": ep["controller"],
                        "controller_fqn": ep["controller_fqn"],
                        "method": ep["method"],
                        "http": ep["http"],
                        "path": path,
                        "file": ep.get("file", ""),
                        "line": ep.get("line"),
                        "type": name,
                        "usage": usage,
                    })
    for rows in out.values():
        rows.sort(key=lambda x: (x["controller_fqn"], x["method"], x["http"], x["path"]))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="只比较源码摘要，不写文件")
    args = parser.parse_args()

    index = scan()
    meta = index["meta"]
    if args.check:
        cached = load()
        same = (cached or {}).get("meta", {}).get("source_digest") == meta["source_digest"]
        print(f"{'一致' if same else '过期'}：{ENDPOINT_FILE}")
        sys.exit(0 if same else 1)

    save(index)
    print(f"[controller-endpoints] {ENDPOINT_FILE}")
    print(f"  {meta['sources']} 个源文件 → {meta['controllers']} 个 Controller / "
          f"{meta['endpoints']} 条 URL / {meta['mappings']} 个方法映射")


if __name__ == "__main__":
    main()
