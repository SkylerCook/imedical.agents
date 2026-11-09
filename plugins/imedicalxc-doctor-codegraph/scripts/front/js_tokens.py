"""零依赖 JS 词法切分：注释、字符串、模板串、正则字面量为原子 token。"""
import re

_TOKEN_RE = re.compile(
    r"""
      (?P<ws>\s+)
    | (?P<line_comment>//[^\n]*)
    | (?P<block_comment>/\*.*?\*/)
    | (?P<str>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')
    | (?P<tpl>`(?:\\.|[^`\\])*`)
    | (?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
    | (?P<id>[A-Za-z_$][A-Za-z0-9_$]*)
    | (?P<punc>[^\s])
    """,
    re.S | re.X,
)

KEYWORDS = {
    "if", "else", "for", "while", "do", "switch", "case", "default", "break",
    "continue", "return", "function", "var", "let", "const", "new", "delete",
    "typeof", "instanceof", "in", "of", "try", "catch", "finally", "throw",
    "yield", "await", "async", "class", "extends", "super", "this", "true",
    "false", "null", "undefined", "void", "with", "debugger", "export",
    "import", "from", "static", "get", "set",
}

_REGEX_PREV_PUNC = set("(,=:[!&|?{};+-*%<>~^")
_REGEX_PREV_WORDS = {
    "return", "typeof", "case", "in", "of", "new", "delete", "void",
    "instanceof", "do", "else", "yield", "await",
}

_UNESCAPE = {
    "n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f",
    "v": "\v", "0": "\0", "\\": "\\", "'": "'", '"': '"', "`": "`", "/": "/",
}


def string_value(raw: str) -> str:
    """把带引号的字符串字面量转成实际值（保留模板串 ${} 占位）。"""
    if len(raw) < 2:
        return raw
    body = raw[1:-1]
    out = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt == "u" and i + 5 < len(body):
                try:
                    out.append(chr(int(body[i + 2:i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
            if nxt == "x" and i + 3 < len(body):
                try:
                    out.append(chr(int(body[i + 2:i + 4], 16)))
                    i += 4
                    continue
                except ValueError:
                    pass
            out.append(_UNESCAPE.get(nxt, nxt))
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def tokenize(text: str):
    """返回 [(kind, value, line)]，kind ∈ id/str/tpl/num/punc/regex。

    正则字面量在词法阶段整体吞掉：`/\\'/g`、`/"/g` 这类正则里的引号/反斜杠
    若交给字符串规则处理，会吞掉后面整段代码并破坏括号配对（大文件从该行起丢失）。
    """
    tokens = []
    append = tokens.append
    line = 1
    pos = 0
    n = len(text)
    prev = None
    while pos < n:
        m = _TOKEN_RE.match(text, pos)
        if not m:
            pos += 1
            continue
        kind = m.lastgroup
        raw = m.group()
        start = pos
        pos = m.end()
        if kind in ("ws", "line_comment", "block_comment"):
            line += raw.count("\n")
            continue
        if kind == "punc" and raw == "/" and _regex_allowed(prev):
            end = _scan_regex(text, start)
            if end is not None:
                tok = ("regex", "", line)
                append(tok)
                prev = tok
                line += text.count("\n", start, end)
                pos = end
                continue
        if kind == "str" or kind == "tpl":
            tok = (kind, string_value(raw), line)
        elif kind == "id":
            tok = ("id", raw, line)
        elif kind == "num":
            tok = ("num", raw, line)
        else:
            tok = ("punc", raw, line)
        append(tok)
        prev = tok
        line += raw.count("\n")
    return tokens


def _scan_regex(text, start):
    """从 `/` 位置扫描正则字面量，返回结束位置；同一行内未闭合则返回 None。"""
    i = start + 1
    in_class = False
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch in "\r\n":
            return None
        if in_class:
            if ch == "]":
                in_class = False
        elif ch == "[":
            in_class = True
        elif ch == "/":
            i += 1
            while i < len(text) and text[i] in "gimsuy":
                i += 1
            return i
        i += 1
    return None


def _regex_allowed(prev) -> bool:
    if prev is None:
        return True
    kind, value, _ = prev
    if kind == "punc":
        return value in _REGEX_PREV_PUNC
    if kind == "id":
        return value in _REGEX_PREV_WORDS
    return False
