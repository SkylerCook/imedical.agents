#!/usr/bin/env python3
"""JS 文件静态扫描：函数定义、调用、HTTP 请求、事件绑定、URL 常量。

全部基于轻量 token 流，不执行代码；对动态分发（eval、字符串 handler）只保留
可解析部分，无法解析的引用写入 unresolved 字段供人工核对。
"""
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    JS_INDEX_FILE, JS_EXTS, MAX_JS_FILE_MB, OUTPUT_DIR,
    is_probably_minified, iter_front_files, read_text, to_front_relative,
)
from js_tokens import KEYWORDS, tokenize
from config_injection import CALL_BINDINGS, match_endpoint

_CALL_BINDINGS = {}
for _name, _scenario, _binding in CALL_BINDINGS:
    _CALL_BINDINGS.setdefault(_name, []).append((_scenario, _binding))

# 资源路径字符集；含空白/括号/引号/分号的候选是回调或整段代码，不能当接口地址
_URL_CHARS_RE = re.compile(r"^[^\s()\"'`{};]+$")
_IDENT_CHAIN_RE = re.compile(r"^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$")
# 首参即真实 handler 的防抖/节流/包装器
_HANDLER_WRAPPERS = {"throttle", "debounce", "proxy", "wrap"}

EVENTS = {
    "click", "dblclick", "change", "blur", "focus", "focusin", "focusout",
    "keydown", "keyup", "keypress", "mousedown", "mouseup", "mouseover",
    "mouseout", "mouseenter", "mouseleave", "select", "submit", "scroll",
    "contextmenu", "input",
}

# 1st 参数是 url 的同步请求封装
SIMPLE_REQUESTS = {
    "$ipost": "POST", "$iget": "GET", "$iput": "PUT", "$idelete": "DELETE",
    "$ipost_enc": "POST", "$iget_enc": "GET",
}
_AJAX_CALLEES = {"$.ajax", "$.post", "$.get", "$.getJSON", "$.postJSON"}

# 通用库方法，不作为业务调用边记录（避免把 jQuery/DOM 调用塞进调用图）
NOISE_CALLEES = {
    "$", "jQuery",
    "console.log", "console.error", "console.warn", "console.info", "console.debug",
    "Math.max", "Math.min", "Math.round", "Math.floor", "Math.ceil", "Math.abs",
    "JSON.stringify", "JSON.parse", "Object.keys", "Object.assign", "Object.defineProperty",
    "Array.isArray", "String.fromCharCode", "Number.parseInt", "Number.parseFloat",
    "parseInt", "parseFloat", "isNaN", "encodeURIComponent", "decodeURIComponent",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "String", "Number", "Boolean", "Array", "Object", "Date", "RegExp",
}
NOISE_METHODS = {
    "click", "on", "off", "bind", "unbind", "delegate", "undelegate", "trigger",
    "val", "text", "html", "append", "appendTo", "prepend", "after", "before",
    "attr", "removeAttr", "prop", "data", "each", "map", "filter", "find",
    "show", "hide", "toggle", "addClass", "removeClass", "hasClass", "css",
    "parent", "parents", "children", "next", "prev", "siblings", "closest",
    "remove", "empty", "clone", "width", "height", "offset", "scrollTop",
    "serialize", "serializeArray", "is", "not", "has", "length",
    "push", "pop", "shift", "unshift", "slice", "splice", "concat", "join",
    "indexOf", "lastIndexOf", "forEach", "reduce", "some", "every", "includes",
    "toString", "valueOf", "trim", "replace", "split", "substring", "substr",
    "toLowerCase", "toUpperCase", "charAt", "match", "test", "exec",
    "apply", "call", "then", "catch", "finally", "resolve", "reject",
    "open", "send", "setRequestHeader", "getItem", "setItem", "removeItem",
}

# *_Common_ControlObj 上的钩子把字符串实参 eval 成注册表成员：BeforeUpdate("X") → BeforeUpdateFuncs.X
_DISPATCH_HOOKS = {
    "BeforeUpdate": "BeforeUpdateFuncs",
    "AfterUpdate": "AfterUpdateFuncs",
    "BeforeStop": "BeforeStopFuncs",
    "AfterStop": "AfterStopFuncs",
    "AfterAdd": "AfterAddFuncs",
    "Interface": "Funcs",
}

# 页面弹出/跳转 API：对象实参里承载 URL 的键，以及位置实参下标
_PAGE_OPENERS = {
    "websys_showModal": (("url",), None),
    "websys_addTab": (("url",), None),
    "windowOpenFrame": (("url",), None),
    "windowTopOpenFrame": (("url",), None),
    "commonShowWin": (("url",), None),
    "ShowHISUIWindow": (("src", "url"), 1),
    "showHISUIWindow": (("src", "url"), 1),
    "openHISUIWindow": (("src", "url"), 1),
    "addTab": (("url",), 2),
    "open": ((), 0),
}
# 只做路径拼装的包装函数：URL 就是第一个实参，解开后继续解析
_PASS_THROUGH_URL_WRAPPERS = {
    "websys_frontPathCombine", "websys_writeMWToken",
    "encodeURI", "encodeURIComponent", "decodeURI", "decodeURIComponent",
}

# 插件初始化对象里可能承载点击回调的键
PLUGIN_KEYS = ("onClick", "onSelect", "onChange", "onDblClick", "onBeforeLoad", "onLoadSuccess")

# `$HUI.<plugin>("#id", {...})` 形式的组件初始化（selector 在第一个实参）
_HUI_PLUGINS = {
    "linkbutton", "button", "menubutton", "splitbutton", "switchbutton",
    "panel", "datagrid", "tree", "treegrid", "tabs",
}
_HUI_RECEIVERS = {"$HUI", "$hui", "$Hui", "$jQuery", "jQuery"}

# 服务端配置注入请求里承载分组键的字段（按优先级）
_CONFIG_CODE_KEYS = ("code", "barCode", "bar_code", "menuType", "menu_type",
                     "bcCode", "bc_code", "pageCode", "page_code")

_ASSIGN_BLOCKERS = set("=!<>+-*/%&|^?:")

_INLINE_ON_RE = re.compile(
    r"""on(click|change|blur|focus|keydown|keyup|mousedown|mouseup)\s*=\s*
        (?:"([^"]*)"|'([^']*)')""", re.X | re.S)
_INLINE_LABEL_RE = re.compile(r">\s*([^<>{}]{1,40}?)\s*<")
_JAVASCRIPT_HREF_RE = re.compile(r"""href\s*=\s*(?:"javascript:([^"]*)"|'javascript:([^']*)')""", re.I)
_DATA_OPTIONS_ONCLICK_RE = re.compile(r"""onClick\s*:\s*([A-Za-z_$][\w$.]*)""")
_TEMPLATE_VAR_RE = re.compile(r"\$\{([A-Za-z_$][\w$.]*)\}")

_MATCH_CACHE = {"tokens": None, "match": None}


def _match_map(tokens):
    """一次扫描建立括号配对表，避免逐次向前扫描导致 O(n²)。

    缓存持有 tokens 强引用：用 id(tokens) 做 key 时，旧列表释放后 id 可能被
    下一个文件复用，导致复用到上一个文件的配对表。
    """
    if _MATCH_CACHE["tokens"] is tokens:
        return _MATCH_CACHE["match"]
    match = [-1] * len(tokens)
    stack = []
    for i, (kind, value, _) in enumerate(tokens):
        if kind != "punc":
            continue
        if value in "([{":
            stack.append(i)
        elif value in ")]}":
            if stack:
                open_idx = stack.pop()
                match[open_idx] = i
                match[i] = open_idx
    _MATCH_CACHE["tokens"] = tokens
    _MATCH_CACHE["match"] = match
    return match


def _find_matching(tokens, i):
    match = _match_map(tokens)
    return match[i] if 0 <= i < len(match) and match[i] >= 0 else len(tokens) - 1


def _render(tokens, start, end):
    out = []
    for i in range(start, end):
        kind, value, _ = tokens[i]
        if kind in ("str", "tpl"):
            out.append(json.dumps(value, ensure_ascii=False))
        else:
            out.append(value)
    return "".join(out)


def _read_lhs(tokens, eq_idx):
    j = eq_idx - 1
    if j < 0 or tokens[j][0] != "id":
        return None, None
    parts = [tokens[j][1]]
    j -= 1
    while j >= 1 and tokens[j][1] == "." and tokens[j - 1][0] == "id":
        parts.insert(0, tokens[j - 1][1])
        j -= 2
    return ".".join(parts), j + 1


def _is_arrow(tokens, i):
    return i + 1 < len(tokens) and tokens[i][1] == "=" and tokens[i + 1][1] == ">"


def _arrow_body(tokens, i):
    """从 '=>' 后定位 body 起止；返回 (start, end, next_index)。"""
    j = i + 2
    if j < len(tokens) and tokens[j][1] == "{":
        end = _find_matching(tokens, j)
        return j, end, end + 1
    depth = 0
    k = j
    while k < len(tokens):
        kind, value, _ = tokens[k]
        if kind == "punc":
            if value in "([{":
                depth += 1
            elif value in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif value in ",;" and depth == 0:
                break
        k += 1
    return j, max(j, k - 1), k


def _function_body(tokens, i):
    """tokens[i] 为 function/async 后的 function 关键字，返回 (param_start, body_start, body_end)。"""
    j = i + 1
    if j < len(tokens) and tokens[j][1] == "*":
        j += 1
    name_idx = -1
    if j < len(tokens) and tokens[j][0] == "id":
        name_idx = j
        j += 1
    if j >= len(tokens) or tokens[j][1] != "(":
        return name_idx, None, None
    params_end = _find_matching(tokens, j)
    k = params_end + 1
    if k >= len(tokens) or tokens[k][1] != "{":
        return name_idx, None, None
    body_end = _find_matching(tokens, k)
    return name_idx, k, body_end


def _value_end(tokens, start, obj_close):
    depth = 0
    i = start
    while i < obj_close:
        kind, value, _ = tokens[i]
        if kind == "punc":
            if value in "([{":
                depth += 1
            elif value in ")]}":
                if depth == 0:
                    return i - 1
                depth -= 1
            elif value == "," and depth == 0:
                return i - 1
        i += 1
    return obj_close - 1


def _statement_end(tokens, start, limit):
    """语句级取值区间：遇到顶层 ; 或 , 截止，避免把后续整段代码当成表达式。"""
    depth = 0
    i = start
    while i < limit:
        kind, value, _ = tokens[i]
        if kind == "punc":
            if value in "([{":
                depth += 1
            elif value in ")]}":
                if depth == 0:
                    return i - 1
                depth -= 1
            elif value in ";," and depth == 0:
                return i - 1
        i += 1
    return limit - 1


def _ternary_branches(tokens, start, end):
    """顶层三元表达式：返回 (条件区间, 真分支区间, 假分支区间)；嵌套三元按最外层切分。"""
    depth = 0
    q = None
    for i in range(start, end):
        value = tokens[i][1]
        if value in "([{":
            depth += 1
        elif value in ")]}":
            depth -= 1
        elif value == "?" and depth == 0 and not _is_optional_chain(tokens, i):
            q = i
            break
    if q is None:
        return None
    nested = 0
    depth = 0
    for i in range(q + 1, end):
        value = tokens[i][1]
        if value in "([{":
            depth += 1
        elif value in ")]}":
            depth -= 1
        elif depth == 0 and value == "?" and not _is_optional_chain(tokens, i):
            nested += 1
        elif depth == 0 and value == ":":
            if nested == 0:
                return (start, q), (q + 1, i), (i + 1, end)
            nested -= 1
    return None


def _terms_weight(terms):
    """分支取舍只看字符串字面量：真实 URL 分支通常带更长路径片段。"""
    return sum(len(t.get("v", "")) for t in terms or [] if t.get("t") == "s")


def _terms_have_string(terms):
    for term in terms or []:
        if term.get("t") == "s":
            return True
        if term.get("t") == "x" and any(_terms_have_string(branch) for branch in term.get("v") or []):
            return True
    return False


def _single_call_range(tokens, start, end):
    """整个区间正好是一次单实参调用时返回 (被调名, 实参区间)。"""
    if end - start < 4 or tokens[start][0] != "id":
        return None
    callee, i = _member_chain(tokens, start, end)
    if i < end and tokens[i][1] == "?" and i + 2 < end \
            and tokens[i + 1][1] == "." and tokens[i + 2][1] == "(":
        i += 2
    if i >= end or tokens[i][1] != "(" or _find_matching(tokens, i) != end - 1:
        return None
    args = _arg_ranges(tokens, i)
    if len(args) != 1:
        return None
    return ".".join(callee), args[0]


def _parse_url_terms(tokens, start, end):
    """把 url 实参解析成可回填常量的词项：str / ref / unknown。"""
    # 整体被括号包住时先脱壳：`(cond ? a : b)` 与 `x + (cond ? a : b)` 都要能拆出三元
    while end - start >= 2 and tokens[start][1] == "(" \
            and _find_matching(tokens, start) == end - 1:
        start, end = start + 1, end - 1
    call = _single_call_range(tokens, start, end)
    if call and call[0].rsplit(".", 1)[-1] in _PASS_THROUGH_URL_WRAPPERS:
        return _parse_url_terms(tokens, *call[1])
    ternary = _ternary_branches(tokens, start, end)
    if ternary is not None:
        cond_range, left_range, right_range = ternary
        left = _parse_url_terms(tokens, *left_range)
        right = _parse_url_terms(tokens, *right_range)
        lw = _terms_weight(left)
        rw = _terms_weight(right)
        if lw == rw and lw:
            # 等长分支通常是模块前缀二选一（如 PAAdmType=="I" ? "ipcare" : "opcare"），
            # 两个分支都保留，构建阶段按页面所属模块选择；
            # cond 用于让同一条件在多处出现时收敛到同一分支（ipcare+Ipcare / opcare+Opcare）
            return [{"t": "x", "v": [left, right],
                     "cond": re.sub(r"\s+", "", _render(tokens, *cond_range))}]
        return left if lw > rw else right
    terms = []
    i = start
    expect_value = True
    while i < end:
        kind, value, _ = tokens[i]
        if expect_value:
            if kind in ("str", "tpl"):
                terms.append({"t": "s", "v": value})
            elif kind == "id" and value not in KEYWORDS:
                parts, j = _member_chain(tokens, i, end)
                if j < end and tokens[j][1] == "(":
                    terms.append({"t": "u", "v": _render(tokens, i, end)})
                    return terms
                terms.append({"t": "r", "v": ".".join(parts)})
                i = j - 1
            elif kind == "punc" and value == "(" and _find_matching(tokens, i) < end:
                # 拼接项里的括号表达式（appPath + (cond ? "/a" : "/b")）递归解析
                close = _find_matching(tokens, i)
                terms.extend(_parse_url_terms(tokens, i + 1, close))
                i = close
            else:
                terms.append({"t": "u", "v": _render(tokens, i, end)})
                return terms
            expect_value = False
        else:
            if kind == "punc" and value == "+":
                expect_value = True
            else:
                terms.append({"t": "u", "v": _render(tokens, i, end)})
                return terms
        i += 1
    if expect_value and terms:
        terms.append({"t": "u", "v": "?"})
    return terms


def _object_keys(tokens, start, end):
    keys = []
    i = start + 1
    close = end
    while i < close:
        kind, value, _ = tokens[i]
        if kind in ("id", "str", "num") and i + 1 < close and tokens[i + 1][1] == ":":
            keys.append(value)
            i += 2
            depth = 0
            while i < close:
                if tokens[i][0] == "punc":
                    if tokens[i][1] in "([{":
                        depth += 1
                    elif tokens[i][1] in ")]}":
                        depth -= 1
                    elif tokens[i][1] == "," and depth == 0:
                        break
                i += 1
        elif kind == "punc" and value in "([{":
            i = _find_matching(tokens, i) + 1
        else:
            i += 1
    return keys


def _object_value(tokens, start, end, key):
    """在对象字面量 token 区间内取某个键的值区间。"""
    i = start + 1
    while i < end:
        kind, value, _ = tokens[i]
        if kind in ("id", "str", "num") and i + 1 < end and tokens[i + 1][1] == ":":
            vend = _value_end(tokens, i + 2, end)
            if value == key:
                return i + 2, vend + 1
            i = vend + 1
            continue
        if kind == "punc" and value in "([{":
            i = _find_matching(tokens, i) + 1
        else:
            i += 1
    return None


def _arg_ranges(tokens, open_idx):
    end = _find_matching(tokens, open_idx)
    ranges = []
    start = open_idx + 1
    i = start
    depth = 0
    while i < end:
        kind, value, _ = tokens[i]
        if kind == "punc":
            if value in "([{":
                depth += 1
            elif value in ")]}":
                depth -= 1
            elif value == "," and depth == 0:
                ranges.append((start, i))
                start = i + 1
        i += 1
    if start < end:
        ranges.append((start, end))
    return ranges


def _call_open(tokens, i):
    """`f(...)` / `f?.(...)` 的左括号下标；不是调用时返回 -1。"""
    if i + 1 >= len(tokens):
        return -1
    if tokens[i + 1][1] == "(":
        return i + 1
    if (tokens[i + 1][1] == "?" and i + 3 < len(tokens)
            and tokens[i + 2][1] == "." and tokens[i + 3][1] == "("):
        return i + 3
    return -1


def _call_args(tokens, i):
    open_idx = _call_open(tokens, i)
    return _arg_ranges(tokens, open_idx) if open_idx >= 0 else []


def _is_optional_chain(tokens, i):
    """`?.` / `?.[` / `?.(` 里的 `?` 不是三元运算符。"""
    return (tokens[i][1] == "?" and i + 1 < len(tokens)
            and tokens[i + 1][1] in (".", "[", "("))


def _member_chain(tokens, i, limit):
    """读取 `a.b?.c` 形式的标识符链，返回 (分段名, 链尾下标)。"""
    names = [tokens[i][1]]
    j = i + 1
    while j < limit:
        if tokens[j][1] == "." and j + 1 < limit and tokens[j + 1][0] == "id":
            names.append(tokens[j + 1][1])
            j += 2
            continue
        if (tokens[j][1] == "?" and j + 2 < limit
                and tokens[j + 1][1] == "." and tokens[j + 2][0] == "id"):
            names.append(tokens[j + 2][1])
            j += 3
            continue
        break
    return names, j


def _bare_param_index(tokens, arg_range, params):
    """实参正好是一个形参名时返回形参下标。"""
    start, end = arg_range
    if end - start != 1 or tokens[start][0] != "id":
        return None
    if tokens[start][1] not in params:
        return None
    return params.index(tokens[start][1])


def _matching_back(tokens, close_idx):
    """从右括号/右花括号反向找到配对的左括号。"""
    opener = {")": "(", "]": "[", "}": "{"}[tokens[close_idx][1]]
    depth = 0
    i = close_idx
    while i >= 0:
        value = tokens[i][1]
        if value in (")", "]", "}"):
            depth += 1
        elif value in ("(", "[", "{"):
            depth -= 1
            if depth == 0:
                return i if value == opener else -1
        i -= 1
    return -1


def _params_for_body(tokens, body_start):
    """取函数体对应的形参名；不解析解构形参（`{a,b}`/`[a]`）。"""
    if body_start is None or body_start <= 0:
        return []
    prev = tokens[body_start - 1][1]
    # 词法层把 `=>` 切成 `=` 和 `>` 两个 punc token
    if prev == "=>":
        after_arrow = body_start - 1
    elif prev == ">" and body_start >= 2 and tokens[body_start - 2][1] == "=":
        after_arrow = body_start - 2
    else:
        after_arrow = -1
    if after_arrow > 0:
        if tokens[after_arrow - 1][1] == ")":
            open_idx = _matching_back(tokens, after_arrow - 1)
        elif tokens[after_arrow - 1][0] == "id":
            return [tokens[after_arrow - 1][1]]
        else:
            return []
    elif prev == ")":
        open_idx = _matching_back(tokens, body_start - 1)
    else:
        return []
    if open_idx < 0:
        return []
    names, depth = [], 0
    for i in range(open_idx + 1, body_start - 1):
        kind, value, _ = tokens[i]
        if value in ("(", "[", "{"):
            depth += 1
        elif value in (")", "]", "}"):
            depth -= 1
        elif depth == 0 and kind == "id":
            names.append(value)
    return names


def _locals_for_body(tokens, start, end):
    """收集函数体内的 var/let/const 名；同名裸调用是在调用局部变量而非全局函数。"""
    if not start or end is None or end < start:
        return []
    names = set()
    i = start
    while i <= end:
        kind, value, _ = tokens[i]
        if kind == "id" and value in ("var", "let", "const"):
            i = _collect_declarators(tokens, i + 1, end, names)
            continue
        i += 1
    return sorted(names)


def _collect_declarators(tokens, i, end, names):
    expect_name, depth = True, 0
    while i <= end:
        kind, value, _ = tokens[i]
        if value in ("(", "[", "{"):
            depth += 1
        elif value in (")", "]", "}"):
            if depth == 0:
                return i
            depth -= 1
        elif depth == 0:
            if value == ";":
                return i + 1
            if expect_name:
                if kind == "id":
                    names.add(value)
                    expect_name = False
                else:
                    return i + 1
            elif value == ",":
                expect_name = True
        i += 1
    return i


class _Scanner:
    def __init__(self, rel_path):
        self.file = rel_path
        self.tokens = []
        self.defs = []
        self.constants = {}
        self.bindings = []
        self.toolbar_bindings = []
        self.bar_bindings = []
        self.config_calls = []
        self.attr_vars = {}
        self.inline_elements = []
        self.anon_seq = 0
        self.def_name_tokens = set()
        self.var_candidates = []

    # ── 函数定义 ────────────────────────────────────────────────
    def _add_def(self, qualified, name, kind, line, start, end, is_nested_hint=False):
        if start is None or end is None or end < start:
            return None
        self.defs.append({
            "qualified": qualified, "name": name, "kind": kind, "line": line,
            "start": start, "end": end, "nested_hint": is_nested_hint,
            "params": _params_for_body(self.tokens, start),
            "locals": _locals_for_body(self.tokens, start, end),
        })
        return qualified

    def _scan_object(self, open_idx, owner, depth=0):
        close = _find_matching(self.tokens, open_idx)
        i = open_idx + 1
        while i < close:
            kind, value, line = self.tokens[i]
            if kind in ("id", "str", "num") and i + 1 < close and self.tokens[i + 1][1] == ":":
                lens = value
                vstart = i + 2
                vend = _value_end(self.tokens, vstart, close)
                qual = f"{owner}.{lens}" if owner else str(lens)
                self._scan_value(qual, lens, vstart, vend + 1, line, depth)
                i = vend + 1
                continue
            if kind == "punc" and value in "([{":
                i = _find_matching(self.tokens, i) + 1
                continue
            i += 1
        return close

    def _scan_value(self, qual, name, start, end, line, depth):
        if start >= end:
            return
        first = self.tokens[start]
        if first[1] == "function":
            name_idx, body_start, body_end = _function_body(self.tokens, start)
            if body_start is not None:
                self._add_def(qual, name, "object", line, body_start, body_end)
                if name_idx >= 0:
                    self.def_name_tokens.add(name_idx)
            return
        if first[1] == "async" and start + 1 < end and self.tokens[start + 1][1] == "function":
            name_idx, body_start, body_end = _function_body(self.tokens, start + 1)
            if body_start is not None:
                self._add_def(qual, name, "object", line, body_start, body_end)
            return
        arrow = self._find_arrow(start, end)
        if arrow is not None:
            body_start, body_end, _ = _arrow_body(self.tokens, arrow)
            self._add_def(qual, name, "object", line, body_start, body_end)
            return
        if first[1] == "{" and depth < 3:
            self._scan_object(start, qual, depth + 1)
            return
        self.constants.setdefault(qual, []).append({
            "expr": _render(self.tokens, start, end),
            "terms": _parse_url_terms(self.tokens, start, end),
            "line": line,
            "idx": start,
        })

    def _find_arrow(self, start, end):
        if start >= end:
            return None
        i = start
        if self.tokens[i][1] == "async":
            i += 1
        if i >= end:
            return None
        if self.tokens[i][1] == "(":
            close = _find_matching(self.tokens, i)
            if close + 1 < end and _is_arrow(self.tokens, close + 1):
                return close + 1
        if self.tokens[i][0] == "id" and i + 1 < end and _is_arrow(self.tokens, i + 1):
            return i + 1
        return None

    # ── 事件绑定 ────────────────────────────────────────────────
    def _handler_from_range(self, start, end, line):
        if start >= end:
            return None
        first = self.tokens[start][1]
        if first == "function":
            _, body_start, body_end = _function_body(self.tokens, start)
            if body_start is None:
                return None
            return self._add_anon_handler(body_start, body_end, line)
        arrow = self._find_arrow(start, end)
        if arrow is not None:
            body_start, body_end, _ = _arrow_body(self.tokens, arrow)
            return self._add_anon_handler(body_start, body_end, line)
        text = _render(self.tokens, start, end).strip()
        if not text:
            return None
        if text.endswith(")"):
            # throttle(fn, ms) / debounce(fn, ms) 这类包装器实际绑的是首参函数
            return self._unwrap_handler_call(start, end)
        return text.lstrip("$").lstrip(".") if text.startswith("$.") else text

    def _add_anon_handler(self, body_start, body_end, line):
        self.anon_seq += 1
        qual = f"__handler_{self.anon_seq}"
        self._add_def(qual, qual, "handler", line, body_start, body_end)
        return qual

    def _unwrap_handler_call(self, start, end):
        """从包装器调用中取真实 handler；首参为函数表达式或限定名时解包。"""
        tokens = self.tokens
        open_idx = _matching_back(tokens, end - 1)
        if open_idx <= start:
            return None
        args = _arg_ranges(tokens, open_idx)
        if not args:
            return None
        a_start, a_end = args[0]
        line = tokens[a_start][2]
        if tokens[a_start][1] == "function":
            _, body_start, body_end = _function_body(tokens, a_start)
            if body_start is None:
                return None
            return self._add_anon_handler(body_start, body_end, line)
        arrow = self._find_arrow(a_start, a_end)
        if arrow is not None:
            body_start, body_end, _ = _arrow_body(tokens, arrow)
            return self._add_anon_handler(body_start, body_end, line)
        candidate = _render(tokens, a_start, a_end).strip()
        if not _IDENT_CHAIN_RE.fullmatch(candidate):
            return None
        # 单参调用多半是工厂函数（loadTable("1")），只有已知包装器才按首参解包
        callee = _render(tokens, start, open_idx).strip().rsplit(".", 1)[-1]
        if len(args) < 2 and callee not in _HANDLER_WRAPPERS:
            return None
        return candidate

    def _add_binding(self, selector, event, handler, line, plugin="", url_terms=None):
        if not selector or not selector.startswith("#"):
            return
        for one in selector.split(","):
            one = one.strip()
            if one.startswith("#") and len(one) > 1:
                rec = {
                    "selector": one, "event": event, "handler": handler or "",
                    "line": line,
                }
                if plugin:
                    rec["plugin"] = plugin
                if url_terms:
                    rec["url_terms"] = url_terms
                self.bindings.append(rec)

    def _scan_bindings(self):
        tokens = self.tokens
        n = len(tokens)
        for i in range(n - 1):
            if tokens[i][1] != "$" or tokens[i + 1][1] != "(":
                continue
            sel_end = _find_matching(tokens, i + 1)
            if sel_end - i != 3 or tokens[i + 2][0] != "str":
                continue
            selector = tokens[i + 2][1].strip()
            j = sel_end + 1
            if j + 1 >= n or tokens[j][1] != "." or tokens[j + 1][0] != "id":
                continue
            method = tokens[j + 1][1]
            if j + 2 >= n or tokens[j + 2][1] != "(":
                continue
            args = _arg_ranges(tokens, j + 2)
            line = tokens[j + 1][2]
            if method in EVENTS and args:
                handler = self._handler_from_range(args[0][0], args[0][1], line)
                self._add_binding(selector, method, handler, line)
            elif method in ("on", "bind") and len(args) >= 2:
                event = tokens[args[0][0]][1] if tokens[args[0][0]][0] == "str" else ""
                if event in EVENTS:
                    if len(args) >= 3 and tokens[args[1][0]][0] == "str":
                        sub = tokens[args[1][0]][1].strip()
                        handler = self._handler_from_range(args[2][0], args[2][1], line)
                        self._add_binding(sub, event, handler, line)
                    else:
                        handler = self._handler_from_range(args[1][0], args[1][1], line)
                        self._add_binding(selector, event, handler, line)
            elif method == "delegate" and len(args) >= 3:
                event = tokens[args[1][0]][1] if tokens[args[1][0]][0] == "str" else ""
                if event in EVENTS and tokens[args[0][0]][0] == "str":
                    handler = self._handler_from_range(args[2][0], args[2][1], line)
                    self._add_binding(tokens[args[0][0]][1].strip(), event, handler, line)
            elif method in ("linkbutton", "button", "menubutton", "splitbutton", "switchbutton", "panel"):
                if args and tokens[args[0][0]][1] == "{":
                    for key in PLUGIN_KEYS:
                        vr = _object_value(tokens, args[0][0], args[0][1], key)
                        if vr:
                            handler = self._handler_from_range(vr[0], vr[1], line)
                            if handler:
                                self._add_binding(selector, "click", handler, line, plugin=method)
            elif method == "datagrid" and args and tokens[args[0][0]][1] == "{":
                pass  # datagrid 的 onClick 已在 PLUGIN_KEYS 中统一处理

    def _scan_bar_bindings(self):
        """兼容旧字段：只保留按钮栏场景（marybtnbar / getBtnCfgData）。"""
        for rec in self.config_calls:
            if rec["scenario"] == "doc_btnbar" and rec["group"]:
                self.bar_bindings.append({"code": rec["group"], "line": rec["line"],
                                          "scenario": rec["scenario"]})

    def _scan_hui_bindings(self):
        """`$HUI.linkbutton("#btn-save", {onClick: saveClick})` 形式的组件事件绑定。"""
        tokens = self.tokens
        n = len(tokens)
        for i in range(n - 4):
            if tokens[i][0] != "id" or tokens[i][1] not in _HUI_RECEIVERS:
                continue
            if tokens[i + 1][1] != "." or tokens[i + 2][0] != "id" or tokens[i + 3][1] != "(":
                continue
            plugin = tokens[i + 2][1]
            if plugin not in _HUI_PLUGINS:
                continue
            args = _arg_ranges(tokens, i + 3)
            if not args or tokens[args[0][0]][0] != "str":
                continue
            selector = tokens[args[0][0]][1].strip()
            if not selector.startswith("#"):
                continue
            opt = next((a for a in args[1:] if tokens[a[0]][1] == "{"), None)
            if not opt:
                continue
            line = tokens[i + 2][2]
            for key in PLUGIN_KEYS:
                vr = _object_value(tokens, opt[0], opt[1], key)
                if not vr:
                    continue
                handler = self._handler_from_range(vr[0], vr[1], line)
                if handler:
                    self._add_binding(selector, "click", handler, line, plugin=plugin)

    def _selector_receiver(self, method_idx):
        """datagrid 调用前的 jQuery 选择器：`$("#dg").datagrid(...)` 取 `#dg`。"""
        tokens = self.tokens
        if method_idx < 4 or tokens[method_idx - 1][1] != "." or tokens[method_idx - 2][1] != ")":
            return ""
        open_idx = _matching_back(tokens, method_idx - 2)
        if open_idx < 1 or open_idx + 2 != method_idx - 2:
            return ""
        if tokens[open_idx - 1][1] not in ("$", "$jQuery", "jQuery"):
            return ""
        if tokens[open_idx + 1][0] != "str":
            return ""
        return tokens[open_idx + 1][1].strip()

    def _array_decl(self, name):
        """同文件内 `const <name> = [...]` 的数组区间。"""
        tokens = self.tokens
        for j in range(len(tokens) - 2):
            if tokens[j][0] == "id" and tokens[j][1] == name \
                    and tokens[j + 1][1] == "=" and tokens[j + 2][1] == "[":
                return j + 2, _find_matching(tokens, j + 2)
        return None

    def _extract_toolbar_items(self, open_idx, close_idx, selector, line):
        tokens = self.tokens
        i = open_idx + 1
        while i < close_idx:
            if tokens[i][1] == "{":
                end = _find_matching(tokens, i)
                text_r = _object_value(tokens, i, end, "text")
                h_r = _object_value(tokens, i, end, "handler")
                label = tokens[text_r[0]][1] if text_r and tokens[text_r[0]][0] == "str" else ""
                handler = self._handler_from_range(h_r[0], h_r[1], line) if h_r else ""
                if handler:
                    self.toolbar_bindings.append({
                        "selector": selector, "label": label, "handler": handler,
                        "line": line, "plugin": "datagrid",
                    })
                i = end + 1
                continue
            if tokens[i][1] in "([{":
                i = _find_matching(tokens, i) + 1
                continue
            i += 1

    def _scan_toolbar_bindings(self):
        """datagrid 工具栏数组里的按钮：`toolbar: [{text:'保存', handler:saveClick}]`。

        工具栏按钮由 JS 构造、HTML 里没有对应元素，需要单独落成操作元素；
        toolbar 值可能是数组字面量、同名变量，或 `cond ? toolbar : []` 三元。
        """
        tokens = self.tokens
        n = len(tokens)
        for i in range(n - 2):
            if tokens[i][0] != "id" or tokens[i][1] != "datagrid" or tokens[i + 1][1] != "(":
                continue
            selector = self._selector_receiver(i)
            args = _arg_ranges(tokens, i + 1)
            obj = next((a for a in args if tokens[a[0]][1] == "{"), None)
            if not selector:
                selector = next((tokens[a[0]][1].strip() for a in args
                                 if tokens[a[0]][0] == "str" and tokens[a[0]][1].strip().startswith("#")), "")
            if not obj:
                continue
            tb = _object_value(tokens, obj[0], obj[1], "toolbar")
            if not tb:
                continue
            arrays = []
            if tokens[tb[0]][1] == "[":
                arrays.append((tb[0], _find_matching(tokens, tb[0])))
            else:
                for j in range(tb[0], tb[1]):
                    if tokens[j][0] != "id" or tokens[j][1] in KEYWORDS:
                        continue
                    decl = self._array_decl(tokens[j][1])
                    if decl:
                        arrays.append(decl)
            for open_idx, close_idx in arrays:
                self._extract_toolbar_items(open_idx, close_idx, selector, tokens[i][2])

    def _expr_literal(self, start, end):
        """把实参解析成字符串：单字面量、常量引用或同一表达式内的字面量拼接。"""
        tokens = self.tokens
        if start >= end:
            return ""
        if end - start == 1 and tokens[start][0] in ("str", "tpl"):
            return tokens[start][1]
        text = _render(tokens, start, end).strip()
        if re.fullmatch(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*", text):
            vals = self.constants.get(text)
            if vals:
                joined = "".join(t.get("v", "") for t in vals[-1].get("terms", [])
                                 if t.get("t") == "s")
                if joined:
                    return joined
        if any(tokens[i][1] == "{" for i in range(start, end)):
            return ""
        joined = "".join(tokens[i][1] for i in range(start, end) if tokens[i][0] in ("str", "tpl"))
        return joined

    def _attr_ref(self, start, end):
        """识别 $(...).attr('barurl') / this.attr('barurl')，返回属性名。"""
        for i in range(start, end - 3):
            if (self.tokens[i][1] == "attr" and self.tokens[i + 1][1] == "("
                    and self.tokens[i + 2][0] in ("str", "tpl")
                    and self.tokens[i + 3][1] == ")"):
                return self.tokens[i + 2][1]
        return ""

    def _url_candidates(self, start, end):
        """URL 实参可能写成常量、变量或字符串拼接，三者都要参与场景识别。"""
        candidates = [self._expr_literal(start, end), _render(self.tokens, start, end)]
        return [c for c in candidates if c and _URL_CHARS_RE.match(c)]

    def _config_group(self, payload):
        """从请求 payload 取分组键，并支持 queryParams/params 一层嵌套。"""
        tokens = self.tokens
        fallback = ""

        def resolve(value_range):
            attr = self._attr_ref(*value_range)
            if attr:
                return "", f"attr:{attr}"
            group = self._expr_literal(*value_range)
            if group:
                return group, ""
            expr = _render(tokens, *value_range)
            # var barurl = $(...).attr('barurl') 这类间接取值，按属性名绑定
            attr = self.attr_vars.get(expr)
            if attr:
                return "", f"attr:{attr}"
            return "", expr

        for key in _CONFIG_CODE_KEYS:
            value_range = _object_value(tokens, payload[0], payload[1], key)
            if value_range:
                group, raw = resolve(value_range)
                if group or raw.startswith("attr:"):
                    return group, raw
                fallback = fallback or raw
        for container in ("queryParams", "params", "data", "body"):
            inner = _object_value(tokens, payload[0], payload[1], container)
            if not inner or tokens[inner[0]][1] != "{":
                continue
            for key in _CONFIG_CODE_KEYS + ("url",):
                value_range = _object_value(tokens, inner[0], inner[1], key)
                if value_range:
                    group, raw = resolve(value_range)
                    if group or raw.startswith("attr:"):
                        return group, raw
                    fallback = fallback or raw
        return "", fallback

    def _id_chain(self, start, end):
        tokens = self.tokens
        if start >= end or tokens[start][0] != "id":
            return ""
        parts = [tokens[start][1]]
        i = start + 1
        while i + 1 < end and tokens[i][1] == "." and tokens[i + 1][0] == "id":
            parts.append(tokens[i + 1][1])
            i += 2
        return ".".join(parts) if i == end else ""

    def _looks_like_endpoint_arg(self, value_range, const_hits):
        start, end = value_range
        chain = self._id_chain(start, end)
        if chain and chain in const_hits:
            return True
        return any(self.tokens[i][0] in ("str", "tpl") and match_endpoint(self.tokens[i][1])
                   for i in range(start, end))

    def _scan_attr_vars(self):
        """登记 `var x = $(...).attr('barurl')`，供分组键间接引用时回填。"""
        tokens = self.tokens
        n = len(tokens)
        for i in range(n - 3):
            if tokens[i][1] not in ("var", "let", "const"):
                continue
            if tokens[i + 1][0] != "id" or tokens[i + 2][1] != "=":
                continue
            end = _statement_end(tokens, i + 3, n) + 1
            attr = self._attr_ref(i + 3, end)
            if attr:
                self.attr_vars.setdefault(tokens[i + 1][1], attr)

    def _scan_config_calls(self):
        """识别服务端配置注入调用：按钮栏、右键菜单等，登记到 config_calls。

        场景判定只看 URL 实参是否命中 config_injection.DETECT_ENDPOINTS；
        分组键从 payload 的 code/barCode/menuType 等字段提取，变量能通过
        同文件常量回填就回填，回填不了保留 raw 表达式供统计。
        """
        tokens = self.tokens
        n = len(tokens)
        self._scan_attr_vars()
        const_hits = {
            qual for qual, vals in self.constants.items()
            if match_endpoint("".join(t.get("v", "") for t in vals[-1].get("terms", [])
                                      if t.get("t") == "s"))
        }
        for i in range(n - 1):
            kind, value, line = tokens[i]
            if kind != "id" or _call_open(tokens, i) < 0:
                continue
            if value in KEYWORDS or i in self.def_name_tokens:
                continue
            args = _call_args(tokens, i)
            if not args:
                continue

            # 页面初始化数据下发的菜单：靠渲染函数+类型实参识别，没有配置接口
            for scenario_id, binding in _CALL_BINDINGS.get(value, []):
                idx = binding.get("arg", 0)
                if idx >= len(args):
                    continue
                arg_text = self._expr_literal(*args[idx])
                groups = binding.get("map", {}).get(arg_text)
                if not groups:
                    continue
                self.config_calls.append({
                    "scenario": scenario_id, "group": "", "groups": sorted(groups),
                    "line": line, "form": "call", "endpoint": "",
                    "raw": f"{value}:{arg_text}"[:200],
                })

            payload = None
            form = "request"
            if value == "marybtnbar":
                form = "marybtnbar"
                if tokens[args[0][0]][1] == "{":
                    payload = args[0]
            elif not any(self._looks_like_endpoint_arg(arg, const_hits) for arg in args):
                continue

            scenario = ""
            endpoint = ""
            if payload is not None:
                # marybtnbar 的接口地址写在配置对象的 url 键
                url_range = _object_value(tokens, payload[0], payload[1], "url")
                if url_range:
                    for candidate in self._url_candidates(*url_range):
                        scenario = match_endpoint(candidate)
                        if scenario:
                            endpoint = candidate
                            break
            if not scenario:
                for arg in args:
                    for candidate in self._url_candidates(*arg):
                        scenario = match_endpoint(candidate)
                        if scenario:
                            endpoint = candidate
                            break
                    if scenario:
                        break

            if not scenario:
                continue
            if payload is None:
                payload = next((arg for arg in args if tokens[arg[0]][1] == "{"), None)
            group, raw = self._config_group(payload) if payload else ("", "")
            self.config_calls.append({
                "scenario": scenario, "group": group, "line": line, "form": form,
                "endpoint": endpoint[:200], "raw": raw[:200],
            })

    # ── 请求 / 调用 ─────────────────────────────────────────────
    @staticmethod
    def _callee_at(tokens, i):
        parts = [tokens[i][1]]
        j = i - 1
        while j >= 1:
            if tokens[j][1] == "." and tokens[j - 1][0] == "id":
                parts.insert(0, tokens[j - 1][1])
                j -= 2
                continue
            # `obj?.method(...)` 的接收者同样属于被调名，丢掉会退化成裸方法名
            if (tokens[j][1] == "." and tokens[j - 1][1] == "?"
                    and j >= 2 and tokens[j - 2][0] == "id"):
                parts.insert(0, tokens[j - 2][1])
                j -= 3
                continue
            break
        return ".".join(parts), j + 1

    def _request_wrappers(self):
        """同文件请求包装：`function $ipostAsync(url, data) { return $ipost(url, data, ...) }`。

        地址藏在调用点，包装体内的请求只能看到形参名；识别后由调用点实参直接登记请求。
        只接受第一个实参就是形参的透传，避免把普通业务函数误当包装器。
        """
        tokens = self.tokens
        wrappers = {}
        for d in self.defs:
            name = d["name"]
            if name.startswith("__handler_") or name in SIMPLE_REQUESTS:
                continue
            params = d.get("params") or []
            if not params:
                continue
            inner = None
            for i in range(d["start"], min(d["end"], len(tokens) - 1)):
                if tokens[i][0] != "id" or tokens[i][1] not in SIMPLE_REQUESTS:
                    continue
                if tokens[i + 1][1] != "(":
                    continue
                args = _arg_ranges(tokens, i + 1)
                if args:
                    inner = (tokens[i][1], args)
                    break
            if not inner:
                continue
            callee, args = inner
            url_arg = _bare_param_index(tokens, args[0], params)
            if url_arg is None:
                continue
            data_arg = _bare_param_index(tokens, args[1], params) if len(args) > 1 else None
            wrappers.setdefault(name, {
                "method": SIMPLE_REQUESTS[callee],
                "url_arg": url_arg,
                "data_arg": data_arg,
            })
        return wrappers

    def _wrapper_request_at(self, i, callee, start, line, wrappers):
        spec = wrappers.get(callee)
        if not spec or "." in callee:
            return None
        tokens = self.tokens
        args = _call_args(tokens, i)
        if spec["url_arg"] >= len(args):
            return None
        url_range = args[spec["url_arg"]]
        data_arg = spec.get("data_arg")
        param_keys = []
        if data_arg is not None and data_arg < len(args):
            data_start, data_end = args[data_arg]
            if tokens[data_start][1] == "{":
                param_keys = _object_keys(tokens, data_start, data_end)
        return {
            "method": spec["method"],
            "url_terms": _parse_url_terms(tokens, url_range[0], url_range[1]),
            "url_expr": _render(tokens, url_range[0], url_range[1]),
            "param_keys": param_keys,
            "idx": start, "line": line, "wrapper": callee,
        }

    def _collect_calls_and_requests(self):
        tokens = self.tokens
        n = len(tokens)
        calls = []
        requests = []
        opens = []
        wrappers = self._request_wrappers()
        for i in range(n - 1):
            kind, value, line = tokens[i]
            if kind != "id" or _call_open(tokens, i) < 0:
                continue
            if i in self.def_name_tokens or value in KEYWORDS:
                continue
            callee, start = self._callee_at(tokens, i)
            # 成员调用（`$(...).datagrid(...)`、`fn.call(...)`）的裸方法名不能当全局函数解析
            member = start >= 1 and tokens[start - 1][1] == "."
            # 构造函数不是对业务方法的调用（new Event(...) 曾被解析成其他模块的同名函数）
            if start >= 1 and tokens[start - 1][1] == "new":
                continue
            dispatch = self._dispatch_at(i, callee, start, line)
            if dispatch:
                calls.append(dispatch)
                continue
            page_open = self._open_at(i, callee, start, line)
            if page_open:
                opens.append(page_open)
            first = callee.split(".", 1)[0]
            if first in KEYWORDS and first != "this":
                continue
            is_request = (callee in SIMPLE_REQUESTS or callee in wrappers
                          or callee in _AJAX_CALLEES
                          or callee == "fetch" or callee.endswith(".open"))
            if is_request or callee in NOISE_CALLEES or (callee.rsplit(".", 1)[-1] in NOISE_METHODS and "." in callee):
                pass  # 请求封装/通用库方法不记录普通调用边
            else:
                call = {"callee": callee, "kind": "call", "member": member,
                        "idx": start, "line": line}
                # 回调实参：`ShowChangeCookType("Win", DoExchange, prescNo)` 把同文件函数
                # 作为引用传出，真正的请求写在 DoExchange 里；不记录这条边请求就不可达
                callbacks = self._callback_args(i)
                if callbacks:
                    call["callbacks"] = callbacks
                calls.append(call)

            req = self._request_at(i, callee, start, line)
            if not req:
                req = self._wrapper_request_at(i, callee, start, line, wrappers)
            if req:
                requests.append(req)
        return calls, requests, opens

    def _callback_args(self, i):
        """调用实参里的裸函数标识符（`f(win, DoExchange)` 的 DoExchange）。

        只认单 token 标识符，字符串/成员访问/字面量都不算；是否真的是本文件函数
        由导出阶段按 def_meta 过滤，避免把数据参数当成回调。
        """
        out = []
        for start, end in _call_args(self.tokens, i) or []:
            if end - start != 1:
                continue
            kind, value, line = self.tokens[start]
            if kind != "id" or value in KEYWORDS:
                continue
            if start >= 1 and self.tokens[start - 1][1] in (".", "new"):
                continue
            out.append({"name": value, "line": line})
        return out

    def _open_at(self, i, callee, start, line):
        """页面弹出/跳转：websys_showModal({url}) / ShowHISUIWindow(src) / window.open(url)…

        只登记地址实参，构建阶段再按界面脚本作用域解析成具体 HTML，形成界面 → 界面边。
        """
        opener = callee.rsplit(".", 1)[-1]
        if opener in ("attr", "prop"):
            return self._src_open_at(i, start, line)
        spec = _PAGE_OPENERS.get(opener)
        if not spec:
            return None
        if opener == "open" and callee not in ("window.open", "globalThis.open", "top.open"):
            return None
        args = _call_args(self.tokens, i)
        if not args:
            return None
        obj_keys, arg_idx = spec
        url_range = None
        if self.tokens[args[0][0]][1] == "{" and args[0][1] - args[0][0] > 1:
            for key in obj_keys:
                url_range = _object_value(self.tokens, args[0][0], args[0][1], key)
                if url_range:
                    break
        if url_range is None and arg_idx is not None and arg_idx < len(args):
            url_range = args[arg_idx]
        if not url_range or url_range[0] >= url_range[1]:
            return None
        # websys_showModal("close"/"options"/"hide") 是窗口命令，不是地址
        if opener == "websys_showModal" and self.tokens[url_range[0]][0] == "str":
            return None
        terms = _parse_url_terms(self.tokens, url_range[0], url_range[1])
        if not (_terms_have_string(terms) or any(t.get("t") == "r" for t in terms)):
            return None
        return {
            "url_terms": terms,
            "url_expr": _render(self.tokens, url_range[0], url_range[1]),
            "opener": opener, "idx": start, "line": line,
        }

    def _src_open_at(self, i, start, line):
        """`$("#TabMain").attr("src", LinkUrl)`：主框架 iframe 换页，等价于打开页面。"""
        tokens = self.tokens
        if start < 2 or tokens[start - 2][1] != ")":
            return None
        args = _call_args(tokens, i)
        if len(args) < 2 or tokens[args[0][0]][0] != "str":
            return None
        if tokens[args[0][0]][1].strip().lower() != "src":
            return None
        url_range = args[1]
        if url_range[1] - url_range[0] == 1 and tokens[url_range[0]][0] == "str" \
                and not tokens[url_range[0]][1].strip():
            return None
        terms = _parse_url_terms(tokens, url_range[0], url_range[1])
        if not (_terms_have_string(terms) or any(t.get("t") == "r" for t in terms)):
            return None
        return {
            "url_terms": terms,
            "url_expr": _render(tokens, url_range[0], url_range[1]),
            "opener": "iframe_src", "idx": start, "line": line,
        }

    def _dispatch_at(self, i, callee, start, line):
        """钩子字符串实参 → 注册表成员边：Common_ControlObj.BeforeUpdate("X") ⇒ BeforeUpdateFuncs.X。

        eval("BeforeUpdateFuncs." + f) 这类分派无法从调用边解析，单独记一条 dispatch 边，
        由构建阶段按页面脚本/全局唯一后缀回填到具体函数。
        """
        parts = callee.split(".")
        if len(parts) < 2:
            return None
        registry = _DISPATCH_HOOKS.get(parts[-1])
        if not registry:
            return None
        receiver = parts[-2]
        if receiver != "Common_ControlObj" and not receiver.endswith("_Common_ControlObj"):
            return None
        args = _call_args(self.tokens, i)
        if not args:
            return None
        start_idx, end_idx = args[0]
        if end_idx - start_idx != 1 or self.tokens[start_idx][0] != "str":
            return None
        key = self.tokens[start_idx][1]
        if not re.fullmatch(r"[A-Za-z_$][\w$]*", key):
            return None
        return {"callee": f"@dispatch:{registry}.{key}", "kind": "dispatch",
                "idx": start, "line": line}

    def _request_at(self, i, callee, start, line):
        tokens = self.tokens
        args = _call_args(tokens, i)
        if callee in SIMPLE_REQUESTS:
            if not args:
                return None
            return {
                "method": SIMPLE_REQUESTS[callee],
                "url_terms": _parse_url_terms(tokens, args[0][0], args[0][1]),
                "url_expr": _render(tokens, args[0][0], args[0][1]),
                "param_keys": _object_keys(tokens, args[1][0], args[1][1])
                if len(args) > 1 and tokens[args[1][0]][1] == "{" else [],
                "idx": start, "line": line, "wrapper": callee,
            }
        if callee == "$iexport" and len(args) >= 2:
            method = tokens[args[0][0]][1] if tokens[args[0][0]][0] == "str" else "POST"
            return {
                "method": method.upper(),
                "url_terms": _parse_url_terms(tokens, args[1][0], args[1][1]),
                "url_expr": _render(tokens, args[1][0], args[1][1]),
                "param_keys": [], "idx": start, "line": line, "wrapper": callee,
            }
        if callee in ("$.ajax", "$.post", "$.get", "$.getJSON", "$.postJSON"):
            method = {"$.post": "POST", "$.get": "GET", "$.getJSON": "GET", "$.postJSON": "POST"}.get(callee, "GET")
            url_range = args[0] if args else None
            if url_range and tokens[url_range[0]][1] == "{":
                url_range = _object_value(tokens, url_range[0], url_range[1], "url")
                type_range = _object_value(tokens, args[0][0], args[0][1], "type") or \
                    _object_value(tokens, args[0][0], args[0][1], "method")
                if type_range and tokens[type_range[0]][0] == "str":
                    method = tokens[type_range[0]][1].upper()
            if not url_range:
                return None
            return {
                "method": method,
                "url_terms": _parse_url_terms(tokens, url_range[0], url_range[1]),
                "url_expr": _render(tokens, url_range[0], url_range[1]),
                "param_keys": _object_keys(tokens, args[1][0], args[1][1])
                if len(args) > 1 and tokens[args[1][0]][1] == "{" else [],
                "idx": start, "line": line, "wrapper": callee,
            }
        if callee == "fetch" and args:
            method = "GET"
            if len(args) > 1 and tokens[args[1][0]][1] == "{":
                mr = _object_value(tokens, args[1][0], args[1][1], "method")
                if mr and tokens[mr[0]][0] == "str":
                    method = tokens[mr[0]][1].upper()
            return {
                "method": method,
                "url_terms": _parse_url_terms(tokens, args[0][0], args[0][1]),
                "url_expr": _render(tokens, args[0][0], args[0][1]),
                "param_keys": [], "idx": start, "line": line, "wrapper": callee,
            }
        if callee.endswith(".open") and len(args) >= 2 and tokens[args[0][0]][0] == "str":
            method = tokens[args[0][0]][1].upper()
            if method in ("GET", "POST", "PUT", "DELETE", "PATCH"):
                return {
                    "method": method,
                    "url_terms": _parse_url_terms(tokens, args[1][0], args[1][1]),
                    "url_expr": _render(tokens, args[1][0], args[1][1]),
                    "param_keys": [], "idx": start, "line": line, "wrapper": "XMLHttpRequest.open",
                }
        return None

    # ── 主流程 ──────────────────────────────────────────────────
    def scan(self, text):
        self.tokens = tokenize(text)
        tokens = self.tokens
        n = len(tokens)

        # 1. 函数/常量/对象字面量
        i = 0
        while i < n:
            kind, value, line = tokens[i]
            if kind == "id" and value == "function" and (i == 0 or tokens[i - 1][1] not in (":", "=", "(", ",")):
                name_idx, body_start, body_end = _function_body(tokens, i)
                if name_idx >= 0 and body_start is not None:
                    self.def_name_tokens.add(name_idx)
                    self._add_def(tokens[name_idx][1], tokens[name_idx][1], "declaration", line, body_start, body_end)
                    i = body_end + 1
                    continue
            if kind == "id" and value == "class" and i + 1 < n and tokens[i + 1][0] == "id":
                self._scan_class(i)
            if value == "=" and i + 1 < n and tokens[i + 1][1] not in _ASSIGN_BLOCKERS:
                lhs, lhs_start = _read_lhs(tokens, i)
                if lhs and (i == 0 or tokens[i - 1][1] not in ("=", "!", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "?")):
                    self.var_candidates.append((lhs.split(".", 1)[0], i))
                    rhs = i + 1
                    if tokens[rhs][1] == "function":
                        name_idx, body_start, body_end = _function_body(tokens, rhs)
                        if body_start is not None:
                            self._add_def(lhs, lhs.rsplit(".", 1)[-1], "assignment", line, body_start, body_end)
                            i = body_end + 1
                            continue
                    arrow = self._find_arrow(rhs, n)
                    if arrow is not None:
                        body_start, body_end, nxt = _arrow_body(tokens, arrow)
                        self._add_def(lhs, lhs.rsplit(".", 1)[-1], "assignment", line, body_start, body_end)
                        i = max(i + 1, nxt)
                        continue
                    if tokens[rhs][1] == "{" and rhs + 1 <= n:
                        self._scan_object(rhs, lhs)
                    else:
                        # 普通赋值也可能是 URL 常量（如 let appPath = menuWin.baseAppPath + "opcare/ipbook/"）
                        vend = _statement_end(tokens, rhs, n)
                        terms = _parse_url_terms(tokens, rhs, vend + 1)
                        if _terms_have_string(terms):
                            self._scan_value(lhs, lhs.rsplit(".", 1)[-1], rhs, vend + 1, line, 0)
            i += 1

        self._scan_namespace_extends()
        self._scan_body_constants()
        self._scan_bindings()
        self._scan_hui_bindings()
        self._scan_toolbar_bindings()
        self._scan_config_calls()
        self._scan_bar_bindings()
        self._scan_inline_elements()

        calls, requests, opens = self._collect_calls_and_requests()
        self._assign_owners(calls, requests, opens)
        top_vars = self._top_level_vars()

        return {
            "file": self.file,
            "functions": self._export_functions(),
            "top_vars": top_vars,
            "constants": [{kk: vv for kk, vv in dict(name=k, **v).items() if kk != "idx"}
                          for k, vals in sorted(self.constants.items()) for v in vals],
            "bindings": self.bindings,
            "toolbar_bindings": self.toolbar_bindings,
            "bar_bindings": self.bar_bindings,
            "config_calls": self.config_calls,
            "inline_elements": self.inline_elements,
            "stats": {"tokens": n, "calls": len(calls), "requests": len(requests)},
        }

    def _scan_namespace_extends(self):
        """`BILL_INF.apply(BILL_INF, {...})` / `$.extend(TARGET, {...})` / `Object.assign(TARGET, {...})`。

        对象字面量里的方法是 TARGET 的成员，扫成 `TARGET.method` 才能让方法体内的调用
        有正确宿主；否则会落到 __top_level__，把按需弹窗误算成页面加载即弹出。
        """
        tokens = self.tokens
        for i in range(1, len(tokens) - 1):
            kind, value, _ = tokens[i]
            if kind != "id" or value not in ("apply", "assign", "extend"):
                continue
            if tokens[i - 1][1] != "." or tokens[i + 1][1] != "(":
                continue
            callee, _ = self._callee_at(tokens, i)
            if callee != "Object.assign" and not callee.endswith((".apply", ".extend")):
                continue
            args = _arg_ranges(tokens, i + 1)
            if len(args) < 2:
                continue
            target = _render(tokens, args[0][0], args[0][1]).strip()
            if not re.fullmatch(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*", target):
                continue
            if tokens[args[1][0]][1] != "{":
                continue
            self._scan_object(args[1][0], target)

    def _top_level_vars(self):
        """文件顶层变量名：用于识别 `var Api = (function(){...})()` 这类命名空间对象。"""
        ranges = [(d["start"], d["end"]) for d in self.defs]
        names = set()
        for name, idx in self.var_candidates:
            if any(start <= idx <= end for start, end in ranges):
                continue
            names.add(name)
        return sorted(names)

    def _scan_body_constants(self):
        """补扫箭头函数/函数声明体内的 URL 赋值。

        主扫描只覆盖对象字面量方法体（函数关键字前是冒号不会整体跳过），
        `const fn = () => { let url = ...; websys_showModal({url}) }` 这类
        箭头函数体里的地址变量会漏掉，这里按函数区间补齐。
        """
        seen = {(c.get("name"), c.get("line"), c.get("expr"))
                for vals in self.constants.values() for c in vals}
        tokens = self.tokens
        for d in self.defs:
            end = d["end"]
            i = d["start"]
            while i < end:
                if tokens[i][1] != "=" or i + 1 >= end or tokens[i + 1][1] in _ASSIGN_BLOCKERS:
                    i += 1
                    continue
                if i > 0 and tokens[i - 1][1] in ("=", "!", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "?"):
                    i += 1
                    continue
                lhs, lhs_start = _read_lhs(tokens, i)
                if not lhs:
                    i += 1
                    continue
                rhs = i + 1
                next_i = i + 1
                if tokens[rhs][1] not in ("{", "function"):
                    vend = _statement_end(tokens, rhs, end)
                    terms = _parse_url_terms(tokens, rhs, vend + 1)
                    expr = _render(tokens, rhs, vend + 1)
                    key = (lhs.rsplit(".", 1)[-1], tokens[lhs_start][2], expr)
                    if _terms_have_string(terms) and key not in seen:
                        seen.add(key)
                        self.constants.setdefault(lhs, []).append({
                            "expr": expr, "terms": terms,
                            "line": tokens[lhs_start][2], "idx": lhs_start,
                        })
                    next_i = vend + 1
                i = max(i + 1, next_i)

    def _scan_class(self, i):
        tokens = self.tokens
        name = tokens[i + 1][1]
        j = i + 2
        while j < len(tokens) and tokens[j][1] != "{":
            j += 1
        if j >= len(tokens):
            return
        end = _find_matching(tokens, j)
        k = j + 1
        while k < end:
            if tokens[k][1] == "static":
                k += 1
                continue
            if tokens[k][0] == "id" and k + 1 < end and tokens[k + 1][1] == "(":
                close = _find_matching(tokens, k + 1)
                if close + 1 < end and tokens[close + 1][1] == "{":
                    body_end = _find_matching(tokens, close + 1)
                    self._add_def(f"{name}.{tokens[k][1]}", tokens[k][1], "method",
                                  tokens[k][2], close + 1, body_end)
                    k = body_end + 1
                    continue
            if tokens[k][0] == "punc" and tokens[k][1] in "([{":
                k = _find_matching(tokens, k) + 1
            else:
                k += 1

    def _assign_owners(self, calls, requests, opens):
        defs = self.defs
        consts = [c for vals in self.constants.values() for c in vals]
        if not defs:
            for item in calls + requests + opens + consts:
                item["owner"] = ""
            self.def_meta = {}
            self.calls = calls
            self.requests = requests
            self.opens = opens
            return
        # 同名函数只保留首个定义，后续定义记重载次数
        uniq = {}
        for d in sorted(defs, key=lambda x: (x["start"], -x["end"])):
            key = d["qualified"]
            if key in uniq:
                uniq[key]["redefinitions"] = uniq[key].get("redefinitions", 0) + 1
                continue
            uniq[key] = d
        ordered = sorted(uniq.values(), key=lambda x: (x["start"], -x["end"]))

        # 顶层代码作为 __top_level__，保证初始化请求有宿主
        top = {"qualified": "__top_level__", "name": "__top_level__", "kind": "top_level",
               "line": 1, "start": 0, "end": len(self.tokens) - 1}
        ordered.insert(0, top)
        for d in ordered:
            d["parent"] = ""
        stack = []
        for d in ordered:
            while stack and not (stack[-1]["start"] <= d["start"] and d["end"] <= stack[-1]["end"]):
                stack.pop()
            if stack:
                d["parent"] = stack[-1]["qualified"]
            stack.append(d)

        # 按 token 位置升序回填宿主：区间天然嵌套，维护活动栈即可 O(n)
        self.def_meta = {d["qualified"]: d for d in ordered}
        events = sorted(
            [(c["idx"], 0, c) for c in calls] + [(r["idx"], 1, r) for r in requests]
            + [(o["idx"], 2, o) for o in opens]
            + [(c["idx"], 3, c) for c in consts],
            key=lambda x: (x[0], x[1]),
        )
        by_start = sorted(ordered, key=lambda d: (d["start"], -d["end"]))
        p = 0
        active = []
        for _, _, item in events:
            while p < len(by_start) and by_start[p]["start"] <= item["idx"]:
                active.append(by_start[p])
                p += 1
            while active and active[-1]["end"] < item["idx"]:
                active.pop()
            item["owner"] = active[-1]["qualified"] if active else ""
        self.calls = calls
        self.requests = requests
        self.opens = opens

    def _export_functions(self):
        calls_by_owner = {}
        for c in self.calls:
            owner = c.get("owner", "")
            callee = c["callee"]
            if not c.get("member", False) and "." not in callee:
                # 形参/局部变量同名的裸调用是回调或局部引用，不是全局函数
                meta = self.def_meta.get(owner) if hasattr(self, "def_meta") else None
                if meta and (callee in meta.get("params", ())
                             or callee in meta.get("locals", ())):
                    continue
            calls_by_owner.setdefault(owner, []).append(
                {"callee": callee, "kind": c["kind"],
                 "member": c.get("member", False), "line": c["line"]})
        # 回调实参只在「本文件确有同名函数声明」时保留；形参/局部变量同名的是局部引用
        declared = {d["name"] for d in self.def_meta.values()
                    if d.get("name") and d["name"] != "__top_level__"}
        callbacks_by_owner = {}
        for c in self.calls:
            if not c.get("callbacks"):
                continue
            owner = c.get("owner", "")
            meta = self.def_meta.get(owner) or {}
            seen = set()
            for cb in c["callbacks"]:
                name = cb["name"]
                if name not in declared:
                    continue
                if name in meta.get("params", ()) or name in meta.get("locals", ()):
                    continue
                pair = (name, c["callee"])
                if pair in seen:
                    continue
                seen.add(pair)
                callbacks_by_owner.setdefault(owner, []).append(
                    {"name": name, "via": c["callee"], "line": cb["line"]})
        req_by_owner = {}
        for r in self.requests:
            req_by_owner.setdefault(r.get("owner", ""), []).append({
                "method": r["method"], "url_terms": r["url_terms"],
                "url_expr": r["url_expr"], "param_keys": r["param_keys"],
                "line": r["line"], "wrapper": r["wrapper"],
            })
        open_by_owner = {}
        for o in self.opens:
            open_by_owner.setdefault(o.get("owner", ""), []).append({
                "url_terms": o["url_terms"], "url_expr": o["url_expr"],
                "opener": o["opener"], "line": o["line"],
            })
        out = []
        for d in self.def_meta.values() if hasattr(self, "def_meta") else []:
            qual = d["qualified"]
            out.append({
                "id": f"{self.file}::{qual}",
                "qualified": qual,
                "name": d["name"],
                "kind": d["kind"],
                "parent": d.get("parent", ""),
                "line": d["line"],
                "calls": calls_by_owner.get(qual, []),
                "callbacks": callbacks_by_owner.get(qual, []),
                "requests": req_by_owner.get(qual, []),
                "opens": open_by_owner.get(qual, []),
            })
        return out

    # ── JS 字符串里的动态元素 ───────────────────────────────────
    def _scan_inline_elements(self):
        for kind, value, line in self.tokens:
            if kind not in ("str", "tpl") or ("on" not in value and "javascript:" not in value):
                continue
            handlers = []
            for m in _INLINE_ON_RE.finditer(value):
                handlers.append(("on" + m.group(1), m.group(2) if m.group(2) is not None else m.group(3)))
            for m in _JAVASCRIPT_HREF_RE.finditer(value):
                handlers.append(("click", (m.group(1) if m.group(1) is not None else m.group(2)).strip()))
            data_opts = _DATA_OPTIONS_ONCLICK_RE.search(value)
            if data_opts:
                handlers.append(("click", data_opts.group(1)))
            for event, handler in handlers:
                handler = (handler or "").strip()
                if not handler:
                    continue
                label_m = _INLINE_LABEL_RE.search(value)
                label = label_m.group(1) if label_m else ""
                self.inline_elements.append({
                    "tag": "a", "label": label, "event": event,
                    "handler": handler, "line": line, "source": "js_string",
                })


def scan_text(rel_path: str, text: str):
    return _Scanner(rel_path).scan(text)


def _scan_one(args):
    path_str, rel = args
    path = Path(path_str)
    try:
        if path.stat().st_size > MAX_JS_FILE_MB * 1024 * 1024:
            return {"file": rel, "skipped": "oversize"}
        text = read_text(path)
        if is_probably_minified(text, path.name):
            return {"file": rel, "skipped": "minified"}
        return scan_text(rel, text)
    except Exception as exc:  # 单文件失败不阻断全量构建
        return {"file": rel, "error": f"{type(exc).__name__}: {exc}"}


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    files = [(str(p), rel) for p, rel in iter_front_files(JS_EXTS)]
    print(f"扫描 {len(files)} 个 JS 文件...")
    results = []
    workers = max(1, min(8, (__import__("os").cpu_count() or 4)))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for idx, rec in enumerate(pool.map(_scan_one, files, chunksize=16), 1):
            results.append(rec)
            if idx % 1000 == 0:
                print(f"  {idx}/{len(files)}")
    results.sort(key=lambda r: r.get("file", ""))
    tmp = JS_INDEX_FILE.with_suffix(".jsonl.tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        for rec in results:
            f.write(json.dumps(rec, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            f.write("\n")
    tmp.replace(JS_INDEX_FILE)
    ok = sum(1 for r in results if "error" not in r and "skipped" not in r)
    skipped = sum(1 for r in results if "skipped" in r)
    errors = sum(1 for r in results if "error" in r)
    print(f"完成: {ok} 个文件, {skipped} 跳过, {errors} 失败 → {JS_INDEX_FILE}")


if __name__ == "__main__":
    main()
