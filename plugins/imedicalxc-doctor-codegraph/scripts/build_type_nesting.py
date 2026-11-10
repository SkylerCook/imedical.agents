#!/usr/bin/env python3
"""类型嵌套引用索引（type_nesting.json）

扫描工作区 src/main/java 下的字段声明，建立「字段类型全限定名 → 外层类型」
的反向索引。契约类型的 JSON 序列化注解只在作为 Feign/Controller 方法签名
顶层类型时能被直接反查到；嵌套在 VO 字段里的类型（如 FeignRisRequestVO 位于
FeignOrderRisReturnVO.RISRequest）不会出现在签名中，查询期沿本索引向上展开。

约束:
  - 只索引 com.mediway 项目类型，java.* 等标准库类型不入表
  - 字段必须带 private/protected/public 修饰符（局部变量没有访问修饰符，天然排除）
  - 泛型实参逐个登记（List<X> / Map<String, X>），数组按元素类型登记
  - 输出确定性排序，同一份源码重建应逐字节一致（meta.generatedAt 除外）
"""

import json
import os
import re
from datetime import datetime
from pathlib import Path

from config import OUTPUT_DIR, PROJECT_ROOT

WORKSPACE_ROOT = PROJECT_ROOT.parent
SRC_ROOT = WORKSPACE_ROOT / "src" / "backend"
OUTPUT_PATH = OUTPUT_DIR / "type_nesting.json"

PACKAGE_RE = re.compile(r"^\s*package\s+([\w.]+);", re.M)
IMPORT_RE = re.compile(r"^\s*import\s+(?!static\b)([\w.]+?)(\.\*)?\s*;", re.M)
TYPE_TOKEN_RE = re.compile(r"(?<!@)\b[A-Z][A-Za-z0-9_$]*\b")
CLASS_RE = re.compile(
    r"^\s*(?:public\s+|final\s+|abstract\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)",
    re.M,
)
# 只认带访问修饰符的字段声明；方法体里的局部变量没有这些修饰符
FIELD_RE = re.compile(
    r"^\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*"
    r"(?:private|protected|public)\s+"
    r"(?:(?:static|final|transient|volatile)\s+)*"
    r"([\w.$]+(?:\s*<[^;=(){}]+>)?(?:\s*\[\s*\])*)\s+"
    r"([A-Za-z_$][\w$]*)\s*(?:=[^;]*)?;",
    re.M,
)


def strip_comments(text):
    """去掉 // 与 /* */ 注释，字符串/字符字面量原样保留。"""
    out, i, n = [], 0, len(text)
    while i < n:
        ch = text[i]
        if ch in "\"'":
            quote = ch
            out.append(ch)
            i += 1
            while i < n:
                out.append(text[i])
                if text[i] == "\\":
                    if i + 1 < n:
                        out.append(text[i + 1])
                        i += 2
                        continue
                elif text[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if text.startswith("//", i):
            end = text.find("\n", i)
            i = n if end < 0 else end
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
            out.append("\n")
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def parse_scope(text):
    pkg = PACKAGE_RE.search(text)
    imports, wildcards = {}, []
    for m in IMPORT_RE.finditer(text):
        target, wildcard = m.group(1), m.group(2)
        if wildcard:
            wildcards.append(target)
        else:
            imports[target.rsplit(".", 1)[-1]] = target
    return {
        "package": pkg.group(1) if pkg else "",
        "imports": imports,
        "wildcards": wildcards,
    }


def resolve_type(scope, name, known):
    """短名 → 全限定名；只接受源码里真实存在的类。

    String/List 这类标准库短名会按「同包」猜出 `pkg.String` 假类型，必须用
    已知类集合过滤；显式 import 优先，避免同包同名类与 import 同时命中。
    """
    candidates = []
    if "." in name:
        candidates = [name]
    elif name in scope["imports"]:
        candidates = [scope["imports"][name]]
    else:
        if scope["package"]:
            candidates.append(f"{scope['package']}.{name}")
        candidates.extend(f"{w}.{name}" for w in scope["wildcards"])
    return [c for c in candidates if c in known]


def iter_java_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in (".git", "target", "test"))
        if "src/main/java" not in dirpath.replace("\\", "/"):
            continue
        for name in sorted(filenames):
            if name.endswith(".java"):
                yield Path(dirpath) / name


def scan_classes():
    """第一遍：收集源码中真实存在的顶层类型全限定名。"""
    known, files = set(), 0
    for path in iter_java_files(SRC_ROOT):
        try:
            text = strip_comments(path.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
        files += 1
        cls = CLASS_RE.search(text)
        scope = parse_scope(text)
        if cls and scope["package"]:
            known.add(f"{scope['package']}.{cls.group(1)}")
    return known, files


def build():
    known, files = scan_classes()
    edges = {}
    classes = 0
    for path in iter_java_files(SRC_ROOT):
        try:
            text = strip_comments(path.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
        cls = CLASS_RE.search(text)
        scope = parse_scope(text)
        if not cls or not scope["package"]:
            continue
        enclosing = f"{scope['package']}.{cls.group(1)}"
        classes += 1
        for field_type, field_name in FIELD_RE.findall(text):
            for token in TYPE_TOKEN_RE.findall(field_type):
                for fqn in resolve_type(scope, token, known):
                    if fqn == enclosing:
                        continue
                    edges.setdefault(fqn, set()).add((enclosing, field_name))

    out_edges = {
        fqn: [list(pair) for pair in sorted(rows)]
        for fqn, rows in sorted(edges.items())
    }
    doc = {
        "meta": {
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "files": files,
            "classes": classes,
            "types": len(out_edges),
            "edges": sum(len(v) for v in out_edges.values()),
            "scope": "src/main/java, fields with private/protected/public, com.mediway only",
        },
        "edges": out_edges,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"[type-nesting] {OUTPUT_PATH}")
    print(f"  文件 {files} · 类 {classes} · 嵌套类型 {doc['meta']['types']} · 引用边 {doc['meta']['edges']}")


if __name__ == "__main__":
    build()
