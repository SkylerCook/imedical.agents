"""
慢接口日志分析工具
从 Graylog 导出的 JSON 文件中解析慢接口数据，按产品组分类汇总。
用法: python analyze_slow_api.py <json文件路径> [--markdown] [--top N] [--output-dir <目录>]

所属 Skill: imedicalxc-doctor-perf-analysis-engineer
映射来源: application-mapping.md
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# 产品组映射：模块前缀 → (产品组名, 显示名)
# 来源：application-mapping.md → 模块代码→产品组速查
PRODUCT_GROUP_MAP = {
    # 护理
    "ipnur": ("护理", "住院护理"),
    "emnur": ("护理", "急诊护理"),
    # 医生站
    "ipcare": ("医生站", "住院医生站"),
    "opcare": ("医生站", "门急诊医生站"),
    "hispa": ("医生站", "患者主索引"),
    # 计费医保
    "ipar": ("计费医保", "住院计费"),
    "insu": ("计费医保", "医保"),
    # 电子病历
    "ipemr": ("电子病历", "住院电子病历"),
    "ipnemr": ("电子病历", "护理电子病历"),
    "opemr": ("电子病历", "门诊电子病历"),
    # 药房药库（包路径为 com.mediway.his.ph.*）
    "ph": ("药房药库", "药房药库"),
    # 临床数据中心
    "aggregation": ("临床数据中心", "临床数据中心"),
    "lis": ("临床数据中心", "LIS"),
    # 会诊
    "cons": ("会诊", "会诊管理"),
    "requ": ("会诊", "会诊申请"),
    # 基础平台
    "ct": ("基础平台", "基础平台"),
    # HOS平台（包路径为 com.mediway.hos.*）
    "hos": ("HOS平台", "HOS平台"),
    # 电子病案管理
    "mrm": ("电子病案管理", "电子病案管理"),
    # 新产品（急诊相关）
    "emdt": ("新产品", "急诊医技"),
    "emtr": ("新产品", "急诊分诊"),
    "emcare": ("新产品", "急诊诊疗"),
}


def parse_interface(full_message: str) -> tuple[str, str] | None:
    """从 full_message 中提取接口全名和参数"""
    m = re.search(r"接口\[(.+?)\]", full_message)
    if not m:
        return None
    raw = m.group(1)
    if "(" in raw:
        name_part = raw[: raw.index("(")]
        param_part = raw[raw.index("("):]
    else:
        name_part = raw
        param_part = ""
    return name_part, param_part


def parse_duration(full_message: str) -> int:
    """从 full_message 中提取耗时（毫秒）"""
    m = re.search(r"耗时[：:]\s*(\d+)", full_message)
    return int(m.group(1)) if m else 0


def get_product_group(full_name: str) -> str:
    """根据接口全名推断产品组"""
    parts = full_name.split(".")
    for i, p in enumerate(parts):
        if p == "mediway" and i + 1 < len(parts):
            if i + 2 < len(parts) and parts[i + 1] == "his":
                module = parts[i + 2]
            else:
                module = parts[i + 1]
            for prefix, (group, _) in PRODUCT_GROUP_MAP.items():
                if module == prefix or module.startswith(prefix):
                    return group
            break
    return "其他"


def short_name(full_name: str) -> str:
    """提取简短方法名"""
    return full_name.split(".")[-1] if "." in full_name else full_name


def analyze(filepath: str) -> dict:
    """解析 Graylog JSON 结果，按接口聚合统计"""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    total = data.get("total_results", 0)
    messages = data.get("messages", [])

    stats = defaultdict(lambda: {
        "count": 0, "max_ms": 0, "max_traceId": "", "max_ts": "",
        "durations": [], "timestamps": []
    })

    for msg in messages:
        fm = msg.get("full_message", "")
        parsed = parse_interface(fm)
        if not parsed:
            continue
        full_name, _ = parsed
        ms = parse_duration(fm)

        s = stats[full_name]
        s["count"] += 1
        s["durations"].append(ms)
        s["timestamps"].append(msg.get("timestamp", ""))
        if ms > s["max_ms"]:
            s["max_ms"] = ms
            s["max_traceId"] = msg.get("traceId", "")
            s["max_ts"] = msg.get("timestamp", "")

    for full_name, s in stats.items():
        s["short"] = short_name(full_name)
        s["group"] = get_product_group(full_name)
        if s["durations"]:
            s["avg_ms"] = sum(s["durations"]) / len(s["durations"])

    sorted_items = sorted(stats.items(), key=lambda x: x[1]["max_ms"], reverse=True)

    return {
        "total": total,
        "sampled": len(messages),
        "unique_interfaces": len(stats),
        "interfaces": sorted_items,
    }


def print_text_report(result: dict, top: int = 50):
    """打印文本版报告"""
    print(f"总匹配: {result['total']} 条, 采样: {result['sampled']} 条, "
          f"唯一接口: {result['unique_interfaces']} 个")
    print()

    by_group = defaultdict(list)
    for name, s in result["interfaces"]:
        by_group[s["group"]].append((name, s))

    def severity(ms):
        if ms > 60000:
            return "[HIGH]"
        elif ms > 30000:
            return "[MID] "
        return "[LOW] "

    print("=" * 100)
    print(f"{'排名':<5} {'接口方法':<40} {'产品组':<12} {'次数':<6} {'最大耗时':<14} {'TraceId'}")
    print("=" * 100)

    for i, (name, s) in enumerate(result["interfaces"][:top]):
        sev = severity(s["max_ms"])
        secs = s["max_ms"] / 1000
        print(f"{i+1:<5} {s['short']:<40} {s['group']:<12} {s['count']:<6} "
              f"{secs:.1f}s ({sev})  {s['max_traceId']}")

    print()
    print("--- 按产品组统计 ---")
    for group in sorted(by_group.keys()):
        items = by_group[group]
        total_count = sum(s["count"] for _, s in items)
        worst = max(s["max_ms"] for _, s in items) / 1000
        print(f"  {group}: {len(items)} 个接口, {total_count} 次慢调用, 最慢 {worst:.1f}s")

    print()
    print("--- 严重度分布 ---")
    high = [s for _, s in result["interfaces"] if s["max_ms"] > 60000]
    mid = [s for _, s in result["interfaces"] if 30000 < s["max_ms"] <= 60000]
    low = [s for _, s in result["interfaces"] if s["max_ms"] <= 30000]
    print(f"  高严重度(>60s): {len(high)} 个")
    print(f"  中严重度(30-60s): {len(mid)} 个")
    print(f"  低严重度(15-30s): {len(low)} 个")


def print_markdown_report(result: dict, output_file: str | None = None):
    """打印 Markdown 版报告"""
    lines = []

    by_group = defaultdict(list)
    for name, s in result["interfaces"]:
        by_group[s["group"]].append((name, s))

    lines.append("# 慢接口分析报告")
    lines.append("")
    lines.append("## 基本信息")
    lines.append("")
    lines.append(f"- 总匹配数: {result['total']} 条")
    lines.append(f"- 采样数: {result['sampled']} 条")
    lines.append(f"- 唯一接口数: {result['unique_interfaces']} 个")
    lines.append("")

    lines.append("## 严重度排名 TOP 20")
    lines.append("")
    lines.append("| 排名 | 接口 | 产品组 | 次数 | 最大耗时 | TraceId |")
    lines.append("|------|------|--------|------|----------|---------|")
    for i, (name, s) in enumerate(result["interfaces"][:20]):
        secs = s["max_ms"] / 1000
        lines.append(f"| {i+1} | `{s['short']}` | {s['group']} | {s['count']} | {secs:.1f}s | `{s['max_traceId']}` |")
    lines.append("")

    for group in sorted(by_group.keys()):
        items = by_group[group]
        lines.append(f"## {group}")
        lines.append("")
        lines.append("| 接口 | 次数 | 最大耗时 | 最慢 TraceId |")
        lines.append("|------|------|----------|-------------|")
        for name, s in sorted(items, key=lambda x: x[1]["max_ms"], reverse=True):
            secs = s["max_ms"] / 1000
            lines.append(f"| `{s['short']}` | {s['count']} | {secs:.1f}s | `{s['max_traceId']}` |")
        lines.append("")

    md_content = "\n".join(lines)

    if output_file:
        Path(output_file).write_text(md_content, encoding="utf-8")
        print(f"报告已保存到: {output_file}")
    else:
        print(md_content)


def main():
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]

    if not args:
        print("用法: python analyze_slow_api.py <json文件路径> [--markdown] [--top N] [--output-dir <目录>]")
        sys.exit(1)

    filepath = args[0]
    top = 50
    output_dir = None
    for f in flags:
        if f.startswith("--top="):
            top = int(f.split("=")[1])
        if f.startswith("--output-dir="):
            output_dir = f.split("=", 1)[1]

    result = analyze(filepath)

    if "--markdown" in flags:
        out_dir = Path(output_dir) if output_dir else Path(".")
        if not output_dir:
            print(f"未指定输出目录，默认输出到当前目录: {out_dir.resolve()}")
            print("提示: 使用 --output-dir <目录> 指定输出路径")
        out_dir.mkdir(parents=True, exist_ok=True)
        out_name = Path(filepath).stem + "_分析报告.md"
        print_markdown_report(result, str(out_dir / out_name))
        print_text_report(result, top)
    else:
        print_text_report(result, top)


if __name__ == "__main__":
    main()
