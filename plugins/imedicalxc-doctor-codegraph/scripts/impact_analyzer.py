#!/usr/bin/env python3
"""
影响范围分析器

给定任意工作区方法，梳理其完整影响范围：
  1. 工作区内部正向调用链（BFS）
  2. Feign 边界 → Maven 入站调用链（对方 Controller → 本组 Feign）
  3. 可选：反向追踪调用者

数据来源：impact_db.json + penetration_db.json（由 build_impact_db.py / build_penetration_db.py 生成）

用法:
    python impact_analyzer.py <方法名>
    python impact_analyzer.py <方法名> --depth 5
    python impact_analyzer.py <方法名> --service ipnur
    python impact_analyzer.py <方法名> --reverse
    python impact_analyzer.py <方法名> --json output.json
    python impact_analyzer.py <方法名> --no-maven

方法名匹配规则:
    saveExamApply                    → 模糊匹配方法名
    ExamQueryAbstract.saveExamApply  → 匹配 Class.method
    com.mediway.his.xxx.Class.method → 全限定名匹配
"""

import argparse
import json
import sys
from collections import defaultdict, deque
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
from config import OUTPUT_DIR, get_module_for_service, get_method_description, get_feign_interface_desc


# ═══════════════════════════════════════════════════════════════
#  工具函数
# ═══════════════════════════════════════════════════════════════

def get_class_method(method_id: str) -> str:
    """com.mediway.his.xxx.ClassName.method → ClassName.method"""
    parts = method_id.split(".")
    if len(parts) >= 2:
        return f"{parts[-2]}.{parts[-1]}"
    return method_id


def get_service(method_id: str) -> str:
    """com.mediway.his.SERVICE.xxx → SERVICE"""
    parts = method_id.split(".")
    if len(parts) >= 4 and parts[0] == "com" and parts[1] == "mediway" and parts[2] == "his":
        return parts[3]
    return "unknown"


def format_partial_path(path: list) -> str:
    """[最深上游, ..., 调用方] → 'A.m ← B.n ← C.k'（左被右调用）"""
    return " ← ".join(get_class_method(node) for node in path)


def short_class(method_id: str) -> str:
    """com.mediway.his.xxx.ClassName.method → ClassName"""
    parts = method_id.split(".")
    return parts[-2] if len(parts) >= 2 else method_id


# ═══════════════════════════════════════════════════════════════
#  数据库加载 & 索引构建
# ═══════════════════════════════════════════════════════════════

class ImpactDB:
    """影响分析数据库，封装加载和索引逻辑"""

    def __init__(self, db_path: Path = None):
        if db_path is None:
            db_path = OUTPUT_DIR / "impact_db.json"
        if not db_path.exists():
            print(f"[ERROR] 数据库不存在: {db_path}")
            print("请先运行: python build_impact_db.py")
            sys.exit(1)

        with open(db_path, "r", encoding="utf-8") as f:
            db = json.load(f)

        # ── 工作区索引 ──
        self.ws_forward = defaultdict(set)   # stripped_id → {stripped_targets}
        self.ws_reverse = defaultdict(set)   # stripped_id → {stripped_callers}
        self.ws_feign_edges = []             # [{s, t, fi}]
        self.ws_nodes = db.get("ws_nodes", {})

        # BLH 覆写索引: 方法名 → [(类名去 Abstract, 方法ID, 服务)]
        self.blh_method_index = defaultdict(list)
        for nid in self.ws_nodes:
            cm = get_class_method(nid)
            if "." not in cm:
                continue
            cls, method = cm.rsplit(".", 1)
            if "Abstract" not in cls:
                continue
            base = cls[:-len("Abstract")] if cls.endswith("Abstract") else cls
            self.blh_method_index[method].append((base, nid, get_service(nid)))

        # 类继承索引：按 extends 链（含无方法的中间类）还原实现族；
        # implements 也入索引：调用方面向接口，实现类方法需要能反查接口声明
        self.class_children = defaultdict(set)
        self.class_ancestors = {}
        self.class_interfaces = {}
        self._hierarchy_loaded = False
        for nid, info in self.ws_nodes.items():
            cls = nid.rsplit(".", 1)[0]
            ancestors = list(info.get("ancestors") or ())
            parent = info.get("parent") or ""
            if parent and parent not in ancestors:
                ancestors.append(parent)
            interfaces = list(info.get("interfaces") or ())
            self.class_ancestors.setdefault(cls, ancestors)
            self.class_interfaces.setdefault(cls, interfaces)
            for anc in ancestors:
                self.class_children[anc].add(cls)
                self._hierarchy_loaded = True
            for iface in interfaces:
                self.class_children[iface].add(cls)
                self._hierarchy_loaded = True

        for e in db.get("ws_edges", []):
            s, t, ct, fi = e["s"], e["t"], e["ct"], e.get("fi", "")
            self.ws_forward[s].add(t)
            self.ws_reverse[t].add(s)
            if ct == "feign":
                self.ws_feign_edges.append({"s": s, "t": t, "fi": fi})

        # ── Feign 接口信息 ──
        self.feign_info = db.get("feign_interfaces", {})

        # ── Maven 索引 ──
        # 仅保留 Feign 直调边作为 penetration_db.json 缺失时的兜底
        self.feign_mvn_callers = defaultdict(list)

        # ── 服务边界 ──
        self.boundary = db.get("service_boundary", {})

        # ── 反向边界索引: Feign全名 → Controller全名列表 ──
        self.feign_to_controllers = defaultdict(set)
        for ctrl, feign in self.boundary.items():
            self.feign_to_controllers[feign].add(ctrl)

        # ── Feign 调用方索引: Feign接口短名.方法名 → [(caller, service, source)] ──
        self.feign_ws_callers = defaultdict(list)
        for e in db.get("ws_edges", []):
            if e.get("ct") == "feign":
                self.feign_ws_callers[e["t"]].append({
                    "caller": e["s"],
                    "service": get_service(e["s"]),
                    "source": "workspace",
                })

        self.feign_mvn_callers = defaultdict(list)
        for e in db.get("maven_edges", []):
            t = e["t"]
            if "Client" in t and ("feign" in t.lower() or ".api." in t):
                self.feign_mvn_callers[t].append({
                    "caller": e["s"],
                    "service": e.get("svc", get_service(e["s"])),
                    "source": "maven_biz",
                })

        # ── 穿透数据库（第二部分：Maven 调用方 → 本工作区 Feign）──
        self.pen_inbound_by_iface = defaultdict(list)
        penetration_path = OUTPUT_DIR / "penetration_db.json"
        if penetration_path.exists():
            with open(penetration_path, "r", encoding="utf-8") as f:
                penetration = json.load(f)
            for chain in penetration.get("inbound_feign", {}).get("chains", []):
                interface = chain["feign"].rsplit(".", 1)[0]
                self.pen_inbound_by_iface[interface].append(chain)

        # ── 加载完整 Feign 接口定义（含 HTTP 路径）──
        self.feign_full = {}
        feign_json = OUTPUT_DIR / "feign_interfaces.json"
        if feign_json.exists():
            with open(feign_json, "r", encoding="utf-8") as f:
                fdata = json.load(f)
            for iface in fdata.get("interfaces", []):
                full_name = iface.get("full_name", "")
                self.feign_full[full_name] = {
                    "service": iface.get("service_name", ""),
                    "path": iface.get("service_path", ""),
                    "methods": {
                        m["name"]: {"http": m.get("http_method", ""), "path": m.get("path", "")}
                        for m in iface.get("methods", [])
                    },
                }

    # ── 搜索 ────────────────────────────────────────────────────

    def search(self, name: str, service: str = None) -> list:
        """模糊搜索方法，返回匹配的工作区节点列表"""
        results = []
        name_lower = name.lower()

        has_dot = "." in name and "(" not in name

        for nid, info in self.ws_nodes.items():
            cm = get_class_method(nid)
            # 去掉参数和返回类型: Class.method(params)RetType → Class.method
            cm_clean = cm.split("(")[0]
            method_name = cm_clean.split(".")[-1] if "." in cm_clean else cm_clean
            class_name = cm_clean.split(".")[-2] if "." in cm_clean else ""

            if has_dot:
                # Class.method 或全限定名匹配
                if name_lower in cm_clean.lower() or name_lower in nid.lower():
                    if service is None or info.get("service") == service:
                        results.append((nid, info))
            else:
                # 纯方法名匹配
                if method_name.lower() == name_lower:
                    if service is None or info.get("service") == service:
                        results.append((nid, info))

        # 按相关性排序：精确方法名匹配 > Class.method 包含 > 其他
        def sort_key(item):
            nid, info = item
            cm = get_class_method(nid).split("(")[0]
            method_name = cm.split(".")[-1]
            if method_name.lower() == name_lower:
                return (0, nid)
            if name_lower in cm.lower():
                return (1, nid)
            return (2, nid)

        results.sort(key=sort_key)
        return results[:50]

    # ── 工作区正向 BFS ──────────────────────────────────────────

    def trace_ws_forward(self, entry: str, max_depth: int = 10) -> dict:
        """从 entry 正向 BFS，返回可达节点、Feign 边界 crossing。

        BLH 抽象方法由子类覆盖实现，静态图上没有 抽象方法 → 覆写 的边；
        BFS 每遇到 Abstract 方法都把覆写实现一并展开，避免抽象入口漏算影响。
        """
        visited = {entry}
        queue = deque([(entry, 0)])
        depth_map = {entry: 0}
        feign_crossings = []
        blh_overrides = []

        def add_override(cur: str, depth: int):
            for ov in self._find_impl_family(cur):
                if ov not in blh_overrides:
                    blh_overrides.append(ov)
                if ov not in visited:
                    visited.add(ov)
                    depth_map[ov] = min(depth_map.get(ov, depth), depth)
                    queue.append((ov, depth))

        add_override(entry, 0)

        while queue:
            cur, d = queue.popleft()
            if d >= max_depth:
                continue

            add_override(cur, d)

            targets = set(self.ws_forward.get(cur, set()))
            targets.update(self._find_impl_family(cur))
            # 排序后展开：set 迭代顺序随进程哈希种子变化，会让 BFS 深度归属与
            # crossings 顺序在重跑间漂移，进而改变取证产物
            for tgt in sorted(targets):
                if tgt not in visited:
                    visited.add(tgt)
                    depth_map[tgt] = d + 1
                    queue.append((tgt, d + 1))

                # 检测 Feign 边界
                for fe in self.ws_feign_edges:
                    if fe["s"] == cur and fe["t"] == tgt:
                        feign_crossings.append({
                            "caller": cur,
                            "feign_target": tgt,
                            "feign_interface": fe["fi"],
                            "depth": d + 1,
                        })

        return {
            "reachable": visited,
            "depth_map": depth_map,
            "feign_crossings": feign_crossings,
            "blh_overrides": blh_overrides,
        }

    # ── 工作区反向 BFS ──────────────────────────────────────────

    def _find_override_descendants(self, entry: str) -> list:
        """沿 extends 链查找同名覆写子类的方法（仅取已入图的节点）"""
        if entry not in self.ws_nodes:
            return []
        entry_cm = get_class_method(entry)
        if "." not in entry_cm:
            return []
        method_name = entry_cm.rsplit(".", 1)[1]

        overrides = []
        seen = {entry.rsplit(".", 1)[0]}
        queue = deque(seen)
        while queue:
            cur = queue.popleft()
            for child in sorted(self.class_children.get(cur, ())):
                if child in seen:
                    continue
                seen.add(child)
                child_nid = f"{child}.{method_name}"
                if child_nid in self.ws_nodes:
                    overrides.append(child_nid)
                queue.append(child)
        return overrides

    def _find_impl_family(self, entry: str) -> list:
        """entry 的同名实现方法：优先继承链，索引缺继承字段时回退旧口径"""
        if self._hierarchy_loaded:
            return self._find_override_descendants(entry)
        return self._find_blh_overrides(entry)

    def _find_declaration_family(self, entry: str) -> list:
        """entry 的同名声明方法：沿 extends / implements 上溯。

        静态图把「调用方 → 接口/父类方法」记在声明上，实现类或覆写方法自身
        没有入边；只向下找实现族会让改动 Impl/Override 的提交取不到入口。
        框架基类（hos/database、MyBatis-Plus、JDK）不展开，避免把通用
        BaseService 的全部调用方算成入口。
        """
        if entry not in self.ws_nodes:
            return []
        entry_cls = entry.rsplit(".", 1)[0]
        method_name = entry.rsplit(".", 1)[-1]

        skip_prefix = ("com.mediway.hos.", "com.baomidou.", "java.", "javax.", "org.")
        declarations = []
        seen = {entry_cls}
        queue = deque([entry_cls])
        while queue:
            cur = queue.popleft()
            candidates = list(self.class_ancestors.get(cur, ())) + list(self.class_interfaces.get(cur, ()))
            for anc in sorted(candidates):
                if anc in seen or anc.startswith(skip_prefix):
                    continue
                seen.add(anc)
                queue.append(anc)
                nid = f"{anc}.{method_name}"
                if nid in self.ws_nodes:
                    declarations.append(nid)
        return declarations

    def _find_blh_family(self, entry: str) -> list:
        """
        同一业务的实现族（含 entry 自身）。

        主口径：沿 extends 链的同名覆写子类。BLH 子类通常不写方法，静态图把
        调用解析到 Abstract，因此族 = Abstract + 覆写它的子类。
        兜底：同服务 + 同名方法 + 图上已有直连边（兼容命名不同且无继承关系的
        父子实现，如 OpregBrokerAbstract 与 OpregistBrokerAbstract）。
        """
        family = [entry]
        for nid in self._find_declaration_family(entry):
            if nid not in family:
                family.append(nid)
        for nid in self._find_impl_family(entry):
            if nid not in family:
                family.append(nid)

        entry_cm = get_class_method(entry)
        if "." not in entry_cm:
            return family
        class_name, method_name = entry_cm.rsplit(".", 1)
        if "Abstract" not in class_name:
            return family

        entry_svc = get_service(entry)
        linked = self.ws_forward.get(entry, set()) | self.ws_reverse.get(entry, set())
        for _, nid, nid_svc in self.blh_method_index.get(method_name, []):
            if nid in family or nid_svc != entry_svc:
                continue
            if nid in linked:
                family.append(nid)
        return family

    def trace_ws_reverse(self, entry: str, max_depth: int = 10) -> dict:
        """从 entry 反向 BFS，返回所有调用者（入口按 BLH 实现族展开）"""
        family = self._find_blh_family(entry)
        visited = set(family)
        queue = deque((e, 0) for e in family)
        depth_map = {e: 0 for e in family}

        while queue:
            cur, d = queue.popleft()
            for declaration in self._find_declaration_family(cur):
                if declaration not in visited:
                    visited.add(declaration)
                    depth_map[declaration] = d
                    queue.append((declaration, d))
            if d >= max_depth:
                continue
            for caller in self.ws_reverse.get(cur, set()):
                if caller not in visited:
                    visited.add(caller)
                    depth_map[caller] = d + 1
                    queue.append((caller, d + 1))

        visited.difference_update(family)
        return {"callers": visited, "depth_map": depth_map, "family": family[1:]}

    def inbound_maven_callers(self, feign_crossings: list) -> list:
        """从 penetration_db 取 Feign 边界对应的 Maven 入站调用方（去重）。"""
        callers = []
        seen = set()
        for fc in feign_crossings:
            iface = fc.get("feign_interface", "")
            if not iface:
                continue
            for c in self.find_feign_external_callers(iface)["maven_biz"]:
                key = (c["service"], c["caller"])
                if key in seen:
                    continue
                seen.add(key)
                entry = dict(c)
                entry["feign_interface"] = iface
                entry["feign_short"] = iface.split(".")[-1]
                callers.append(entry)
        return callers

        return chains

    # ── 影响分析: 反向追踪到 Controller ──────────────────────────

    def _find_blh_overrides(self, entry: str) -> list:
        """
        旧索引兼容口径：按「类名去 Abstract 后互为后缀」找跨服务同名实现
        （如 InsertOeOrdItem vs IpCareInsertOeOrdItem）。

        仅当 impact_db 未带继承字段时作为兜底；正常索引走
        _find_override_descendants 的 extends 链，不会把全工程同名 Abstract
        误并进同一实现族。
        """
        entry_cm = get_class_method(entry)
        method_name = entry_cm.split(".")[-1] if "." in entry_cm else entry_cm
        class_name = entry_cm.split(".")[-2] if "." in entry_cm else ""
        entry_svc = get_service(entry)

        if "Abstract" not in class_name:
            return []

        entry_base = class_name[:-len("Abstract")] if class_name.endswith("Abstract") else class_name
        overrides = []
        for nid_base, nid, nid_svc in self.blh_method_index.get(method_name, []):
            if nid == entry or nid_svc == entry_svc:
                continue
            if not (nid_base.endswith(entry_base) or entry_base.endswith(nid_base)):
                continue
            overrides.append(nid)

        return overrides

    def trace_upstream_to_controllers(self, entry: str, max_depth: int = 15) -> list:
        """
        从 entry 反向 BFS，追踪到所有 Controller 端点。
        支持 BLH 继承：如果 entry 在 Abstract 类中，也追踪子类覆写方法。
        如果反向追踪无法到达 Controller（BLH 反射调用），使用启发式匹配。
        返回: [{"controller": 方法ID, "depth": N, "endpoints": [...]}, ...]
        """
        entries = self._find_blh_family(entry)

        visited = set(entries)
        queue = deque([(e, 0) for e in entries])
        controllers = []

        while queue:
            cur, d = queue.popleft()
            for declaration in self._find_declaration_family(cur):
                if declaration not in visited:
                    visited.add(declaration)
                    queue.append((declaration, d))
            if d >= max_depth:
                continue
            if "Controller" in cur:
                controllers.append({
                    "controller": cur,
                    "depth": d,
                    "endpoints": self.ws_nodes.get(cur, {}).get("endpoints", []),
                })
                continue
            for caller in sorted(self.ws_reverse.get(cur, set())):
                if caller not in visited:
                    visited.add(caller)
                    queue.append((caller, d + 1))

        # 如果反向追踪未找到 Controller，使用启发式匹配
        if not controllers:
            entry_svc = get_service(entry)
            entry_cm = get_class_method(entry)
            entry_method = entry_cm.split(".")[-1] if "." in entry_cm else entry_cm
            entry_class = entry_cm.split(".")[-2] if "." in entry_cm else ""

            # 收集相关服务（本服务 + BLH 覆写所在服务）
            related_svcs = {entry_svc}
            for ovr in entries:
                related_svcs.add(get_service(ovr))

            # 从类名提取业务关键词（如 InsertOeOrdItemAbstract → OeOrdItem）
            class_keywords = []
            for part in entry_class.replace("Abstract", "").replace("BLH", "").split("_"):
                if len(part) > 3:
                    class_keywords.append(part.lower())
            # 也从包路径提取（如 saveOeOrdItem → oeorditem）
            pkg_parts = entry.split(".")
            for pp in pkg_parts:
                if pp.startswith("save") or pp.startswith("insert"):
                    continue
                if len(pp) > 3 and pp.lower() not in ("blh", "ord", "com", "mediway", "his"):
                    class_keywords.append(pp.lower())

            # 查找方法名关键词
            method_keywords = []
            if "Insert" in entry_class or "Save" in entry_class:
                method_keywords.extend(["save", "insert"])
            elif "Update" in entry_class:
                method_keywords.append("update")
            elif "Delete" in entry_class:
                method_keywords.append("delete")
            elif "Query" in entry_class or "Get" in entry_class:
                method_keywords.extend(["get", "query", "find"])
            else:
                method_keywords.append(entry_method.lower())

            for nid in self.ws_nodes:
                if "Controller" not in nid:
                    continue
                nid_svc = get_service(nid)
                if nid_svc not in related_svcs:
                    continue
                nid_cm = get_class_method(nid)
                nid_method = nid_cm.split(".")[-1].lower()
                nid_class = nid_cm.split(".")[-2].lower() if "." in nid_cm else ""

                # 方法名匹配
                method_match = any(kw in nid_method for kw in method_keywords)
                if not method_match:
                    continue

                # 类名匹配（至少一个业务关键词出现在 Controller 类名中）
                if class_keywords:
                    class_match = any(ckw in nid_class for ckw in class_keywords if len(ckw) > 4)
                    if not class_match:
                        continue

                # 过滤 DTO/VO 误匹配
                if any(s in nid for s in ("DTO", "VO", "Model", "Entity")):
                    continue

                controllers.append({
                    "controller": nid,
                    "depth": -1,
                    "heuristic": True,
                    "endpoints": self.ws_nodes.get(nid, {}).get("endpoints", []),
                })

        # 去重（按 controller ID，保留第一个出现的）
        unique = {}
        for c in controllers:
            cid = c["controller"]
            if cid not in unique:
                unique[cid] = c
        return list(unique.values())

    def get_controller_feign_info(self, controller_id: str) -> dict:
        """
        给定 Controller 方法 ID，查找其对应的 Feign 接口和 HTTP 路径。
        返回: {"feign_interface": str, "feign_method": str, "http_path": str,
               "http_method": str, "service": str, "controller_class": str}
        """
        controller_class = controller_id.rsplit(".", 1)[0] if "." in controller_id else controller_id

        feign_iface = self.boundary.get(controller_class, "")
        if not feign_iface:
            for ctrl_key, feign_val in self.boundary.items():
                if ctrl_key.endswith(controller_class.split(".")[-1]):
                    feign_iface = feign_val
                    break

        if not feign_iface:
            return {"feign_interface": "", "controller_class": controller_class}

        method_name = controller_id.rsplit(".", 1)[-1] if "." in controller_id else ""
        method_name = method_name.split("(")[0]

        feign_info = self.feign_full.get(feign_iface, {})
        feign_path_prefix = feign_info.get("path", "")
        feign_methods = feign_info.get("methods", {})

        http_path = ""
        http_method = ""
        feign_method_name = ""

        if method_name in feign_methods:
            m = feign_methods[method_name]
            http_method = m.get("http", "POST")
            mpath = m.get("path", "")
            http_path = f"{feign_path_prefix}/{mpath}" if feign_path_prefix else mpath
            feign_method_name = method_name
        else:
            for fm_name, fm_info in feign_methods.items():
                if fm_name.lower() == method_name.lower():
                    http_method = fm_info.get("http", "POST")
                    mpath = fm_info.get("path", "")
                    http_path = f"{feign_path_prefix}/{mpath}" if feign_path_prefix else mpath
                    feign_method_name = fm_name
                    break

        return {
            "feign_interface": feign_iface,
            "feign_interface_short": feign_iface.split(".")[-1],
            "feign_method": feign_method_name,
            "http_path": http_path,
            "http_method": http_method,
            "service": feign_info.get("service", ""),
            "controller_class": controller_class,
        }

    def find_feign_external_callers(self, feign_full_name: str, method_name: str = "") -> dict:
        """
        查找调用指定 Feign 接口方法的所有外部调用方（workspace + maven biz）。
        返回: {"workspace": [{"caller": str, "service": str}], "maven_biz": [{"caller": str, "service": str}]}
        """
        result = {"workspace": [], "maven_biz": []}

        for edge_key, callers in self.feign_ws_callers.items():
            if feign_full_name in edge_key:
                if method_name and method_name not in edge_key:
                    continue
                for c in callers:
                    if not any(r["caller"] == c["caller"] for r in result["workspace"]):
                        result["workspace"].append(c)

        for chain in self.pen_inbound_by_iface.get(feign_full_name, []):
            if method_name and chain["feign"].rsplit(".", 1)[-1] != method_name:
                continue
            entry = {
                "caller": chain["caller"],
                "service": chain["service"],
                "root_type": chain.get("root_type", ""),
                "controller": chain.get("controller", ""),
                "paths": chain.get("paths", []),
                "partial_paths": chain.get("partial_paths", []),
            }
            if not any(r["caller"] == entry["caller"] for r in result["maven_biz"]):
                result["maven_biz"].append(entry)

        if not self.pen_inbound_by_iface:
            for edge_key, callers in self.feign_mvn_callers.items():
                if feign_full_name in edge_key:
                    if method_name and method_name not in edge_key:
                        continue
                    for c in callers:
                        if not any(r["caller"] == c["caller"] for r in result["maven_biz"]):
                            result["maven_biz"].append(c)

        return result


# ═══════════════════════════════════════════════════════════════
#  报告输出
# ═══════════════════════════════════════════════════════════════

def print_header(title: str):
    print()
    print("=" * 70)
    print(title)
    print("=" * 70)


def print_impact_report(db: ImpactDB, entry_id: str, args):
    """生成并打印完整影响分析报告"""

    entry_info = db.ws_nodes.get(entry_id, {})
    entry_cm = get_class_method(entry_id)
    entry_svc = entry_info.get("service", get_service(entry_id))

    print_header(f"影响范围分析: {entry_cm}")
    print(f"  全限定名: {entry_id}")
    print(f"  所属服务: {entry_svc}")
    if entry_info.get("file_path"):
        print(f"  源文件:   {entry_info['file_path']}")

    # ── 1. 工作区正向影响 ────────────────────────────────────────
    ws = db.trace_ws_forward(entry_id, max_depth=args.depth)
    ws_reachable = ws["reachable"] - {entry_id}
    feign_crossings = ws["feign_crossings"]

    # 按服务分组
    ws_by_svc = defaultdict(list)
    for m in ws_reachable:
        svc = get_service(m)
        ws_by_svc[svc].append(m)

    blh_overrides = ws.get("blh_overrides", [])
    override_set = set(blh_overrides)

    print_header(f"一、工作区内部影响 ({len(ws_reachable)} 个方法)")
    if blh_overrides:
        print(f"  BLH 覆写/并行实现 ({len(blh_overrides)} 个): "
              + ", ".join(f"{get_class_method(m)} [{get_service(m)}]" for m in blh_overrides))

    if not ws_reachable:
        print("  (无内部调用)")
    else:
        for svc in sorted(ws_by_svc, key=lambda s: -len(ws_by_svc[s])):
            methods = sorted(ws_by_svc[svc], key=get_class_method)
            print(f"\n  [{svc}] {len(methods)} 个方法:")
            for m in methods:
                d = ws["depth_map"].get(m, "?")
                tag = " [BLH覆写]" if m in override_set else ""
                print(f"    L{d}  {get_class_method(m)}{tag}")

    # ── 2. Feign 边界穿透 ────────────────────────────────────────
    if feign_crossings:
        print_header(f"二、Feign 边界穿透 ({len(feign_crossings)} 个调用)")
        for fc in feign_crossings:
            caller_cm = get_class_method(fc["caller"])
            feign_short = fc["feign_target"].split(".")[-1] if fc["feign_target"] else "?"
            iface_short = fc["feign_interface"].split(".")[-1] if fc["feign_interface"] else "?"
            print(f"  L{fc['depth']}  {caller_cm}  ──Feign──▶  {iface_short}.{feign_short}")
    else:
        print_header("二、Feign 边界穿透")
        print("  (未触达 Feign 边界)")

    # ── 3. Maven 入站调用方 ─────────────────────────────────────
    if args.no_maven:
        print_header("三、Maven 入站调用方 (已跳过)")
        return

    inbound = db.inbound_maven_callers(feign_crossings) if feign_crossings else []

    if inbound:
        mvn_by_svc = defaultdict(list)
        for c in inbound:
            mvn_by_svc[c["service"]].append(c)

        print_header(f"三、Maven 入站调用方 ({len(inbound)} 个调用点, {len(mvn_by_svc)} 个服务)")
        for svc in sorted(mvn_by_svc, key=lambda s: -len(mvn_by_svc[s])):
            items = sorted(mvn_by_svc[svc], key=lambda c: c["caller"])
            module = get_module_for_service(svc)
            print(f"\n  [{svc}] ({module}) {len(items)} 个调用点:")
            for c in items:
                caller_cm = get_class_method(c["caller"])
                print(f"    - {caller_cm}")
                print(f"      → {c['feign_short']}")
                if c.get("controller"):
                    print(f"      链路: {get_class_method(c['controller'])} → … → {caller_cm}")
                elif c.get("root_type") == "method":
                    print("      入口: 方法入口（无 Controller 上游）")
                    for pp in (c.get("partial_paths") or [])[:2]:
                        print(f"      上游: {format_partial_path(pp)}")
    else:
        print_header("三、Maven 入站调用方")
        print("  (未发现 Maven 侧调用本组 Feign 的入站链路)")

    # ── 4. 反向追踪（可选）──────────────────────────────────────
    if args.reverse:
        rev = db.trace_ws_reverse(entry_id, max_depth=args.depth)
        callers = rev["callers"]

        rev_by_svc = defaultdict(list)
        for m in callers:
            svc = get_service(m)
            rev_by_svc[svc].append(m)

        print_header(f"四、反向追踪 — 谁调用了此方法 ({len(callers)} 个调用者)")
        if rev.get("family"):
            print("  BLH 实现族（同一业务的其他实现，一并计入上游）: "
                  + ", ".join(get_class_method(m) for m in rev["family"]))
        for svc in sorted(rev_by_svc, key=lambda s: -len(rev_by_svc[s])):
            methods = sorted(rev_by_svc[svc], key=get_class_method)
            print(f"\n  [{svc}] {len(methods)} 个方法:")
            for m in methods:
                d = rev["depth_map"].get(m, "?")
                print(f"    L{d}  {get_class_method(m)}")


def print_impact_full_report(db: ImpactDB, entry_id: str, args):
    """
    生成完整变更影响分析报告（--impact 模式）:
      一、下游调用链（正向 BFS）
      二、上游追踪 → Controller 端点
      三、Controller → Feign 接口映射（含 HTTP 路径）
      四、Maven biz 外部调用方（按 Feign 分组）
      五、工作区跨服务调用方（按 Feign 分组）
      六、影响范围汇总
    """
    entry_info = db.ws_nodes.get(entry_id, {})
    entry_cm = get_class_method(entry_id)
    entry_svc = entry_info.get("service", get_service(entry_id))

    print_header(f"变更影响分析: {entry_cm}")
    print(f"  全限定名: {entry_id}")
    print(f"  所属服务: {entry_svc}")
    if entry_info.get("file_path"):
        print(f"  源文件:   {entry_info['file_path']}")

    # ── 1. 下游调用链 ────────────────────────────────────────────
    ws = db.trace_ws_forward(entry_id, max_depth=args.depth)
    ws_reachable = ws["reachable"] - {entry_id}
    feign_crossings = ws["feign_crossings"]

    ws_by_svc = defaultdict(list)
    for m in ws_reachable:
        ws_by_svc[get_service(m)].append(m)

    blh_overrides = ws.get("blh_overrides", [])
    override_set = set(blh_overrides)

    print_header(f"一、下游调用链 ({len(ws_reachable)} 个方法)")
    if blh_overrides:
        print(f"  BLH 覆写/并行实现 ({len(blh_overrides)} 个): "
              + ", ".join(f"{get_class_method(m)} [{get_service(m)}]" for m in blh_overrides))
    if not ws_reachable:
        print("  (无下游调用)")
    else:
        for svc in sorted(ws_by_svc, key=lambda s: -len(ws_by_svc[s])):
            methods = sorted(ws_by_svc[svc], key=get_class_method)
            print(f"\n  [{svc}] {len(methods)} 个方法:")
            for m in methods[:15]:
                d = ws["depth_map"].get(m, "?")
                tag = " [BLH覆写]" if m in override_set else ""
                print(f"    L{d}  {get_class_method(m)}{tag}")
            if len(methods) > 15:
                print(f"    ... 共 {len(methods)} 个")

    if feign_crossings:
        print(f"\n  Feign 边界穿透: {len(feign_crossings)} 个")
        for fc in feign_crossings[:5]:
            caller_cm = get_class_method(fc["caller"])
            feign_short = fc["feign_interface"].split(".")[-1] if fc["feign_interface"] else "?"
            print(f"    {caller_cm} ──▶ {feign_short}")

    # ── 2. 上游追踪到 Controller ─────────────────────────────────
    controllers = db.trace_upstream_to_controllers(entry_id, max_depth=args.depth)

    print_header(f"二、上游追踪 → Controller 端点 ({len(controllers)} 个)")
    if not controllers:
        print("  (未追踪到 Controller 端点)")
    else:
        seen_ctrl = set()
        for ctrl in sorted(controllers, key=lambda x: (x.get("heuristic", False), x["depth"])):
            ctrl_id = ctrl["controller"]
            ctrl_cm = get_class_method(ctrl_id)
            # 过滤 DTO/VO 误匹配
            if any(s in ctrl_cm for s in ("DTO", "VO", "Model", "Entity")):
                continue
            if ctrl_cm in seen_ctrl:
                continue
            seen_ctrl.add(ctrl_cm)
            ctrl_svc = get_service(ctrl_id)
            ctrl_type = "Feign" if "Client" in ctrl_id or "external" in ctrl_id else "内部"
            heuristic_tag = " [启发式]" if ctrl.get("heuristic") else ""
            depth_tag = f"L{ctrl['depth']}" if ctrl["depth"] >= 0 else "??"
            print(f"  {depth_tag}  [{ctrl_svc}] [{ctrl_type}] {ctrl_cm}{heuristic_tag}")
            for ep in ctrl.get("endpoints") or []:
                print(f"        {ep['http'] or 'ANY':<6} {ep['path']}")

    # ── 3. Controller → Feign 映射 ───────────────────────────────
    entry_is_feign = entry_info.get("is_feign", False) or "feign" in entry_id.lower()
    feign_mappings = []
    seen_feign = set()

    if entry_is_feign:
        # 入口本身是 Feign 接口：只映射入口接口，启发式 Controller 命中的同类接口不算
        entry_feign_class = entry_id.rsplit(".", 1)[0] if "." in entry_id else entry_id
        seen_feign.add(entry_feign_class)
        feign_mappings.append({
            "feign_interface": entry_feign_class,
            "feign_interface_short": entry_feign_class.split(".")[-1],
            "feign_method": get_class_method(entry_id).split(".")[-1],
            "service": db.feign_full.get(entry_feign_class, {}).get("service", ""),
            "controller_class": "",
        })
    else:
        for ctrl in controllers:
            info = db.get_controller_feign_info(ctrl["controller"])
            if info.get("feign_interface") and info["feign_interface"] not in seen_feign:
                seen_feign.add(info["feign_interface"])
                feign_mappings.append(info)

        # 下游调用链中实际触达的 Feign 边界（含入口方法自身的 Feign 调用）
        for fc in feign_crossings:
            iface = fc.get("feign_interface", "")
            if not iface or iface in seen_feign:
                continue
            seen_feign.add(iface)
            feign_mappings.append({
                "feign_interface": iface,
                "feign_interface_short": iface.split(".")[-1],
                "feign_method": (fc.get("feign_target") or "").rsplit(".", 1)[-1].split("(")[0],
                "service": db.feign_full.get(iface, {}).get("service", ""),
                "controller_class": "",
            })

    print_header(f"三、Controller → Feign 接口映射 ({len(feign_mappings)} 个)")
    if not feign_mappings:
        print("  (无 Feign 接口映射)")
    else:
        for fm in feign_mappings:
            feign_short = fm['feign_interface_short']
            feign_desc = get_feign_interface_desc(feign_short)
            desc_tag = f"  — {feign_desc}" if feign_desc else ""
            print(f"\n  Feign: {feign_short}{desc_tag}")
            print(f"    全限定名: {fm['feign_interface']}")
            if fm.get("http_path"):
                print(f"    HTTP: {fm['http_method']} {fm['http_path']}")
            if fm.get("service"):
                svc = fm["service"]
                if svc.startswith("${"):
                    svc = get_service(fm["feign_interface"])
                print(f"    目标服务: {svc}")
            if fm.get("controller_class"):
                print(f"    Controller: {fm['controller_class'].split('.')[-1]}")

    # ── 4 & 5. 外部调用方（Maven biz + 工作区跨服务）─────────────
    all_ws_callers = []
    all_mvn_callers = []

    for fm in feign_mappings:
        feign_name = fm["feign_interface"]
        method = fm.get("feign_method", "")
        ext = db.find_feign_external_callers(feign_name, method_name="")
        for c in ext["workspace"]:
            c["feign_interface"] = feign_name
            c["feign_short"] = fm["feign_interface_short"]
            all_ws_callers.append(c)
        for c in ext["maven_biz"]:
            c["feign_interface"] = feign_name
            c["feign_short"] = fm["feign_interface_short"]
            all_mvn_callers.append(c)

    # Maven biz 外部调用方
    mvn_by_svc = defaultdict(list)
    for c in all_mvn_callers:
        mvn_by_svc[c["service"]].append(c)

    print_header(f"四、Maven biz 外部调用方 ({len(all_mvn_callers)} 个)")
    if not all_mvn_callers:
        print("  (Maven biz 中未发现外部调用方)")
    else:
        for svc in sorted(mvn_by_svc, key=lambda s: -len(mvn_by_svc[s])):
            items = mvn_by_svc[svc]
            module = get_module_for_service(svc)
            print(f"\n  [{svc}] ({module}) {len(items)} 个调用:")
            for c in items:
                caller_cm = get_class_method(c["caller"])
                desc = get_method_description(c["caller"])
                desc_tag = f" — {desc}" if desc else ""
                feign_desc = get_feign_interface_desc(c["feign_short"])
                feign_desc_tag = f" ({feign_desc.split('｜')[0].strip()})" if feign_desc else ""
                print(f"    - {caller_cm}{desc_tag}")
                print(f"      → {c['feign_short']}{feign_desc_tag}")
                if c.get("controller"):
                    controller_cm = get_class_method(c["controller"])
                    print(f"      链路: {controller_cm} → … → {caller_cm}")
                elif c.get("root_type") == "method":
                    print("      入口: 方法入口（无 Controller 上游）")
                    for pp in (c.get("partial_paths") or [])[:2]:
                        print(f"      上游: {format_partial_path(pp)}")

    # 工作区跨服务调用方
    ws_caller_by_svc = defaultdict(list)
    for c in all_ws_callers:
        ws_caller_by_svc[c["service"]].append(c)

    print_header(f"五、工作区跨服务调用方 ({len(all_ws_callers)} 个)")
    if not all_ws_callers:
        print("  (工作区中未发现跨服务调用方)")
    else:
        for svc in sorted(ws_caller_by_svc, key=lambda s: -len(ws_caller_by_svc[s])):
            items = ws_caller_by_svc[svc]
            module = get_module_for_service(svc)
            print(f"\n  [{svc}] ({module}) {len(items)} 个调用:")
            for c in items:
                caller_cm = get_class_method(c["caller"])
                desc = get_method_description(c["caller"])
                desc_tag = f" — {desc}" if desc else ""
                print(f"    - {caller_cm}{desc_tag}")
                print(f"      → {c['feign_short']}")

    # ── 6. 汇总 ─────────────────────────────────────────────────
    total_services = set()
    for c in all_mvn_callers:
        total_services.add(c["service"])
    for c in all_ws_callers:
        total_services.add(c["service"])
    total_services.add(entry_svc)

    svc_with_modules = []
    for svc in sorted(total_services):
        module = get_module_for_service(svc)
        svc_with_modules.append(f"{svc}({module})")

    print_header("六、影响范围汇总")
    print(f"  下游方法:       {len(ws_reachable)} 个")
    print(f"  Controller:     {len(controllers)} 个")
    print(f"  Feign 接口:     {len(feign_mappings)} 个")
    print(f"  Maven 外部:     {len(all_mvn_callers)} 个调用")
    print(f"  工作区跨服务:   {len(all_ws_callers)} 个调用")
    print(f"  涉及服务:       {len(total_services)} 个")
    for item in svc_with_modules:
        print(f"    - {item}")


def export_json(db: ImpactDB, entry_id: str, args) -> dict:
    """生成 JSON 格式的影响报告"""
    entry_info = db.ws_nodes.get(entry_id, {})

    ws = db.trace_ws_forward(entry_id, max_depth=args.depth)
    ws_reachable = ws["reachable"] - {entry_id}
    feign_crossings = ws["feign_crossings"]

    inbound = db.inbound_maven_callers(feign_crossings) if (feign_crossings and not args.no_maven) else []
    maven_inbound = [
        {
            "service": c["service"],
            "module": get_module_for_service(c["service"]),
            "caller": get_class_method(c["caller"]),
            "feign_interface": c["feign_short"],
            "root_type": c.get("root_type", ""),
            "controller": get_class_method(c["controller"]) if c.get("controller") else "",
            "paths": c.get("paths", []),
            "partial_paths": [
                [get_class_method(node) for node in path]
                for path in (c.get("partial_paths") or [])
            ],
        }
        for c in inbound
    ]

    # 工作区按服务分组
    ws_by_svc = defaultdict(list)
    for m in ws_reachable:
        ws_by_svc[get_service(m)].append(m)

    # 反向
    rev_data = {}
    if args.reverse:
        rev = db.trace_ws_reverse(entry_id, max_depth=args.depth)
        rev_data = {
            "callers": [
                {"id": m, "class_method": get_class_method(m),
                 "service": get_service(m), "depth": rev["depth_map"].get(m)}
                for m in rev["callers"]
            ],
            "blh_family": [
                {"id": m, "class_method": get_class_method(m), "service": get_service(m)}
                for m in rev.get("family", [])
            ],
        }

    result = {
        "entry": {
            "id": entry_id,
            "class_method": get_class_method(entry_id),
            "service": entry_info.get("service", get_service(entry_id)),
            "file_path": entry_info.get("file_path", ""),
        },
        "workspace_impact": {
            "count": len(ws_reachable),
            "by_service": {
                svc: [
                    {"id": m, "class_method": get_class_method(m),
                     "depth": ws["depth_map"].get(m)}
                    for m in sorted(methods, key=get_class_method)
                ]
                for svc, methods in sorted(ws_by_svc.items(), key=lambda x: -len(x[1]))
            },
        },
        "feign_crossings": [
            {
                "caller": get_class_method(fc["caller"]),
                "feign_target": fc["feign_target"],
                "feign_interface": fc["feign_interface"],
                "depth": fc["depth"],
            }
            for fc in feign_crossings
        ],
        "maven_inbound_callers": {
            "count": len(maven_inbound),
            "callers": sorted(maven_inbound, key=lambda x: (x["service"], x["caller"])),
        },
        "blh_overrides": [
            {"id": m, "class_method": get_class_method(m), "service": get_service(m)}
            for m in ws.get("blh_overrides", [])
        ],
        **rev_data,
    }

    # --impact 模式：添加外部调用方信息
    if args.impact:
        # 构建 Feign 映射列表
        feign_mappings = []
        seen_feign = set()

        # 如果入口本身就是 Feign 接口，直接用它
        entry_is_feign = entry_info.get("is_feign", False) or "feign" in entry_id.lower()
        if entry_is_feign:
            entry_feign_class = entry_id.rsplit(".", 1)[0] if "." in entry_id else entry_id
            entry_feign_short = entry_feign_class.split(".")[-1]
            entry_method = get_class_method(entry_id).split(".")[-1]
            feign_mappings.append({
                "feign_interface": entry_feign_class,
                "feign_interface_short": entry_feign_short,
                "feign_method": entry_method,
            })
        else:
            # 从 Controller 追踪获取 Feign 映射
            controllers = db.trace_upstream_to_controllers(entry_id, max_depth=args.depth)
            for ctrl in controllers:
                info = db.get_controller_feign_info(ctrl["controller"])
                if info.get("feign_interface") and info["feign_interface"] not in seen_feign:
                    seen_feign.add(info["feign_interface"])
                    feign_mappings.append(info)
            # 下游调用链中实际触达的 Feign 边界（含入口方法自身的 Feign 调用）
            for fc in feign_crossings:
                iface = fc.get("feign_interface", "")
                if not iface or iface in seen_feign:
                    continue
                seen_feign.add(iface)
                feign_mappings.append({
                    "feign_interface": iface,
                    "feign_interface_short": iface.split(".")[-1],
                    "feign_method": (fc.get("feign_target") or "").rsplit(".", 1)[-1].split("(")[0],
                })

        # 上游 Controller 端点（含注解 URL），供前端链路反查
        result["upstream_controllers"] = [
            {
                "id": c["controller"],
                "class_method": get_class_method(c["controller"]),
                "depth": c["depth"],
                "heuristic": bool(c.get("heuristic")),
                "endpoints": c.get("endpoints") or [],
            }
            for c in controllers
        ]

        # 收集外部调用方
        all_ws_callers = []
        all_mvn_callers = []
        for fm in feign_mappings:
            feign_name = fm["feign_interface"]
            method = fm.get("feign_method", "")
            ext = db.find_feign_external_callers(feign_name, method_name="")
            for c in ext["workspace"]:
                c["feign_interface"] = feign_name
                c["feign_short"] = fm["feign_interface_short"]
                c["module"] = get_module_for_service(c["service"])
                all_ws_callers.append(c)
            for c in ext["maven_biz"]:
                c["feign_interface"] = feign_name
                c["feign_short"] = fm["feign_interface_short"]
                c["module"] = get_module_for_service(c["service"])
                all_mvn_callers.append(c)

        result["external_callers"] = {
            "maven_biz": {
                "count": len(all_mvn_callers),
                "callers": [
                    {
                        "caller": get_class_method(c["caller"]),
                        "controller": c.get("controller", ""),
                        "root_type": c.get("root_type", ""),
                        "service": c["service"],
                        "module": c["module"],
                        "feign_interface": c["feign_short"],
                        "feign_interface_desc": get_feign_interface_desc(c["feign_short"]),
                        "description": get_method_description(c["caller"]),
                    }
                    for c in all_mvn_callers
                ],
            },
            "workspace": {
                "count": len(all_ws_callers),
                "callers": [
                    {
                        "caller": get_class_method(c["caller"]),
                        "controller": c.get("controller", ""),
                        "root_type": c.get("root_type", ""),
                        "service": c["service"],
                        "module": c["module"],
                        "feign_interface": c["feign_short"],
                        "feign_interface_desc": get_feign_interface_desc(c["feign_short"]),
                        "description": get_method_description(c["caller"]),
                    }
                    for c in all_ws_callers
                ],
            },
        }

        # 汇总涉及的服务和模块
        total_services = set()
        for c in all_mvn_callers:
            total_services.add((c["service"], c["module"]))
        for c in all_ws_callers:
            total_services.add((c["service"], c["module"]))
        total_services.add((entry_info.get("service", get_service(entry_id)),
                           get_module_for_service(entry_info.get("service", get_service(entry_id)))))

        result["summary"] = {
            "downstream_methods": len(ws_reachable),
            "controllers": len(controllers) if not entry_is_feign else 0,
            "feign_interfaces": len(feign_mappings),
            "maven_external_callers": len(all_mvn_callers),
            "workspace_cross_service_callers": len(all_ws_callers),
            "services_involved": [
                {"service": svc, "module": mod}
                for svc, mod in sorted(total_services)
            ],
        }

    return result


# ═══════════════════════════════════════════════════════════════
#  主入口
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="影响范围分析器 — 给定方法名，梳理工作区调用链与 Maven 入站链路",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python impact_analyzer.py saveExamApply
  python impact_analyzer.py ExamQueryAbstract.saveExamApply --depth 5
  python impact_analyzer.py saveExamApply --service opcare
  python impact_analyzer.py saveExamApply --reverse
  python impact_analyzer.py saveExamApply --json result.json
  python impact_analyzer.py saveExamApply --no-maven
        """,
    )
    parser.add_argument("method", help="方法名 (支持模糊匹配: name / Class.method / 全限定名)")
    parser.add_argument("--depth", "-d", type=int, default=10, help="最大追踪深度 (默认 10)")
    parser.add_argument("--service", "-s", help="限定工作区服务 (如 opcare, ipcare, aggcare)")
    parser.add_argument("--reverse", "-r", action="store_true", help="同时反向追踪调用者")
    parser.add_argument("--json", "-j", metavar="FILE", help="导出 JSON 结果到文件")
    parser.add_argument("--no-maven", action="store_true", help="跳过 Maven 入站调用链")
    parser.add_argument("--impact", "-i", action="store_true",
                        help="完整变更影响分析模式（含上游追踪到 Controller、Feign 映射、外部调用方）")
    parser.add_argument("--select", type=int, default=0,
                        help="多个匹配时直接选第 N 个 (从 1 开始)，跳过交互")

    args = parser.parse_args()

    # 加载数据库
    db = ImpactDB()

    # 搜索入口方法
    matches = db.search(args.method, service=args.service)

    if not matches:
        print(f"[ERROR] 未找到匹配的方法: '{args.method}'")
        if args.service:
            print(f"  (已限定服务: {args.service})")
        print("\n提示: 尝试更短的关键词，如方法名或类名")
        sys.exit(1)

    # 选择入口
    if len(matches) == 1 or args.select > 0:
        idx = args.select - 1 if args.select > 0 else 0
        if idx >= len(matches):
            idx = 0
        entry_id, entry_info = matches[idx]
    else:
        print(f"\n找到 {len(matches)} 个匹配方法:\n")
        for i, (nid, info) in enumerate(matches, 1):
            svc = info.get("service", get_service(nid))
            feign_tag = " [Feign]" if info.get("is_feign") else ""
            print(f"  {i:3d}. [{svc}] {get_class_method(nid)}{feign_tag}")
            if i >= 20 and len(matches) > 20:
                print(f"  ... 还有 {len(matches) - 20} 个 (使用 --select N 指定)")
                break
        print()

        while True:
            try:
                choice = input(f"选择入口方法 [1-{min(len(matches), 20)}] (回车=1): ").strip()
                if not choice:
                    idx = 0
                    break
                idx = int(choice) - 1
                if 0 <= idx < len(matches):
                    break
                print(f"  请输入 1 到 {min(len(matches), 20)} 之间的数字")
            except (ValueError, EOFError):
                idx = 0
                break

        entry_id, entry_info = matches[idx]

    # 执行分析
    if args.impact:
        print_impact_full_report(db, entry_id, args)
    else:
        print_impact_report(db, entry_id, args)

    # JSON 导出
    if args.json:
        report = export_json(db, entry_id, args)
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\n[OK] JSON 结果已导出到: {args.json}")


if __name__ == "__main__":
    main()
