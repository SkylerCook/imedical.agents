#!/usr/bin/env python3
"""服务端配置注入场景登记表。

医生站页面的操作元素不都在 HTML/JS 里：按钮栏、右键菜单、执行单按钮等由
服务端配置表下发。不同模块组的下发形式不同（接口、请求参数名、命中字段、
分组字段都不一样），这里按场景登记每个配置源与它的前端识别方式。

字段含义：
    id            场景标识，写入链路库 element.handler_source = "config:<id>"
    binding       前端如何把配置挂到页面：code_in_request / menu_type_in_request / page_code
    detect        前端 URL 表达式中出现即判定为该场景的接口片段
    code_keys     请求 payload 中承载分组键的字段名（按优先级）
    call_bindings 不走接口、由页面初始化数据下发的场景：本地渲染函数 + 分组映射
    dynamic_groups 请求参数里的分组键是运行时变量时，是否把该场景全部配置挂到页面
    merge         是否并入链路（False 表示只登记配置数据，不生成操作元素）
    tables        依赖的配置表
    sql           导出 SQL，列别名统一为 grp/code/name/handler/display_handler/url/active/hosp_dr/seq/extra
    handler_fields 可能承载点击处理函数的列
    url_field     承载页面跳转地址的列（不是 HTTP 接口）
"""

SCENARIOS = [
    {
        "id": "doc_btnbar",
        "label": "医生站按钮栏（marybtnbar / getBtnCfgData）",
        "binding": "code_in_request",
        "detect": ["getBtnCfgData", "getCardRegBtnCfgData"],
        "code_keys": ["code", "barCode", "bar_code", "url"],
        "tables": ["cf_doc_config_btnbar", "cf_doc_config_btnbar_item"],
        "handler_fields": ["handler"],
        "url_field": "url",
        "sql": """
SELECT b.code AS grp,
       i.code AS code,
       COALESCE(NULLIF(i.name, ''), NULLIF(i.tooltip, ''), i.code) AS name,
       i.click_handler AS handler,
       NULL AS display_handler,
       i.url AS url,
       i.active_flag AS active,
       b.hosp_dr AS hosp_dr,
       i.sequece AS seq,
       i.express AS extra
FROM {schema}.cf_doc_config_btnbar b
JOIN {schema}.cf_doc_config_btnbar_item i ON i.btnbar_dr = b.id
WHERE COALESCE(b.active_flag, '1') = '1'
ORDER BY b.code, i.sequece, i.code
""".strip(),
    },
    {
        "id": "oe_view_right_menu",
        "label": "医嘱列表右键菜单（按 menu_type 下发）",
        "binding": "menu_type_in_request",
        "detect": [],
        # 菜单随页面初始化数据下发（ServerObj.orderRightMenuJson 等），
        # 前端唯一可静态识别的是渲染函数及其医嘱类型实参
        "call_bindings": [{
            "name": "showGridRightMenu",
            "arg": 3,
            "map": {
                "Ord": ["DOCPRNOrder", "DOCSOSOrder", "NURPRNOrder", "NURSOSOrder"],
                "OrdExec": ["NURPRNExec", "NURSOSExec"],
            },
        }],
        "code_keys": ["menuType", "menu_type"],
        "tables": ["cf_oe_ord_item_view_right_menu"],
        "handler_fields": ["handler"],
        "url_field": "",
        "sql": """
SELECT menu_type AS grp,
       code,
       text AS name,
       handler,
       display_handler,
       NULL AS url,
       CASE WHEN active_flag THEN '1' ELSE '0' END AS active,
       hosp_dr,
       0 AS seq,
       role_dr AS extra
FROM {schema}.cf_oe_ord_item_view_right_menu
ORDER BY menu_type, code
""".strip(),
    },
    {
        "id": "oe_view_menu",
        "label": "医嘱列表菜单（按 menu_type 下发，无院区/角色维度）",
        "binding": "menu_type_in_request",
        "detect": [],
        "call_bindings": [{
            "name": "showGridRightMenu",
            "arg": 3,
            "map": {
                "Ord": ["DOCPRNOrder", "DOCSOSOrder", "NURPRNOrder", "NURSOSOrder"],
                "OrdExec": ["NURPRNExec", "NURSOSExec"],
            },
        }],
        "code_keys": ["menuType", "menu_type"],
        "tables": ["cf_oe_ord_item_view_menu"],
        "handler_fields": ["handler"],
        "url_field": "",
        "sql": """
SELECT menu_type AS grp,
       code,
       text AS name,
       handler,
       display_handler,
       NULL AS url,
       '1' AS active,
       NULL AS hosp_dr,
       0 AS seq,
       NULL AS extra
FROM {schema}.cf_oe_ord_item_view_menu
ORDER BY menu_type, code
""".strip(),
    },
    {
        "id": "nurse_exec_button",
        "label": "护理执行单按钮（按单据 nss_code 下发）",
        "binding": "sheet_scope",
        # 执行页按 sheetCode 取按钮，参数是运行时变量 → 该页面承载全部单据按钮
        "detect": ["nurseexecution/biz/getSheetButtons",
                   "nurseexecution/cfg/getSheetButtonColumn"],
        "dynamic_groups": True,
        "code_keys": ["code", "sheetCode", "bcCode", "bc_code"],
        "tables": ["cf_nr_nurseexecute_buttoncolumn", "cf_nr_nurseexecute_sheetset",
                   "cf_nr_nurseexecute_buttonconfig"],
        "handler_fields": ["handler"],
        "url_field": "",
        "sql": """
SELECT s.nss_code AS grp,
       c.bc_code AS code,
       c.bc_name AS name,
       c.bc_function AS handler,
       NULL AS display_handler,
       NULL AS url,
       CASE WHEN COALESCE(c.del_flag, 0) = 0 AND COALESCE(b.del_flag, 0) = 0
            THEN '1' ELSE '0' END AS active,
       c.bc_hosp_dr AS hosp_dr,
       b.ebc_serialid AS seq,
       b.ebc_type AS extra
FROM {schema}.cf_nr_nurseexecute_buttoncolumn b
JOIN {schema}.cf_nr_nurseexecute_sheetset s ON s.id = b.ebc_nurheet_parref
JOIN {schema}.cf_nr_nurseexecute_buttonconfig c ON c.id::text = b.ebc_item
WHERE b.ebc_type = 'B'
ORDER BY s.nss_code, b.ebc_serialid, c.bc_code
""".strip(),
    },
    {
        "id": "page_config",
        "label": "通用页面 CRUD 配置（cf_dic_pageconfig）",
        "binding": "page_code",
        # getConfigByCode 在字典/产品配置里大量重名，不能作为识别特征；
        # 该表只存 datagrid 地址与 CRUD 开关，没有点击 handler，故只登记不并链
        "detect": [],
        "merge": False,
        "code_keys": ["pageCode", "page_code", "code"],
        "tables": ["cf_dic_pageconfig"],
        "handler_fields": [],
        "url_field": "datagrid_url",
        "sql": """
SELECT code AS grp,
       code,
       displayname AS name,
       NULL AS handler,
       NULL AS display_handler,
       datagrid_url AS url,
       CASE WHEN activity THEN '1' ELSE '0' END AS active,
       NULL AS hosp_dr,
       seqno AS seq,
       concat_ws(',',
           CASE WHEN enable_add THEN 'add' END,
           CASE WHEN enable_edit THEN 'edit' END,
           CASE WHEN enable_delete THEN 'delete' END,
           CASE WHEN enable_push THEN 'push' END) AS extra
FROM {schema}.cf_dic_pageconfig
ORDER BY code
""".strip(),
    },
]

SCENARIO_BY_ID = {s["id"]: s for s in SCENARIOS}

# 前端接口片段 → 场景。长片段优先，避免 getBtnCfgData 误命中 getAllBtnCfgData。
DETECT_ENDPOINTS = sorted(
    [(frag, s["id"]) for s in SCENARIOS for frag in s["detect"]],
    key=lambda item: (-len(item[0]), item[0]),
)

# 由本地渲染函数 + 类型实参识别（页面初始化数据下发，没有配置接口）
CALL_BINDINGS = [(binding["name"], s["id"], binding)
                 for s in SCENARIOS for binding in s.get("call_bindings", [])]

# 参数里的分组键是运行时变量时，整页承载该场景全部配置
DYNAMIC_SCENARIOS = {s["id"] for s in SCENARIOS if s.get("dynamic_groups")}

# 只登记配置数据、不并入链路的场景
NO_MERGE_SCENARIOS = {s["id"] for s in SCENARIOS if s.get("merge") is False}

_ACTIVE_TRUE = {"1", "true", "t", "y", "yes"}
_ACTIVE_FALSE = {"0", "false", "f", "n", "no", ""}


def sql_for(scenario, schema="sm_his"):
    return scenario["sql"].format(schema=schema)


def as_text(value):
    return "" if value is None else str(value).strip()


def is_active(value):
    if value is None:
        return True
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in _ACTIVE_FALSE:
        return text == ""
    return text in _ACTIVE_TRUE or text not in _ACTIVE_FALSE


def match_endpoint(url_text):
    """返回 URL 表达式命中的场景 id；未命中返回空串。"""
    if not url_text:
        return ""
    for frag, scenario_id in DETECT_ENDPOINTS:
        if frag.lower() in url_text.lower():
            return scenario_id
    return ""


def normalize_row(scenario, row):
    grp = as_text(row.get("grp"))
    code = as_text(row.get("code"))
    if not grp or not code:
        return None
    handler = ""
    for field in scenario.get("handler_fields", []):
        handler = as_text(row.get(field))
        if handler:
            break
    rec = {
        "scenario": scenario["id"],
        "grp": grp,
        "code": code,
        "name": as_text(row.get("name")) or code,
        "handler": handler,
        "display_handler": as_text(row.get("display_handler")),
        "url": as_text(row.get(scenario.get("url_field") or "url")),
        "active": is_active(row.get("active")),
        "hosp_dr": as_text(row.get("hosp_dr")),
        "seq": row.get("seq"),
        "extra": as_text(row.get("extra")),
        "variants": 1,
    }
    return rec


def _merge_key(rec):
    return rec["scenario"], rec["grp"], rec["code"]


def _prefer(new, old):
    """同一 (场景, 分组, 按钮) 多院区重复行：保留信息更完整的一条。"""
    score_new = (bool(new["handler"]), bool(new["url"]), new["active"], -len(new["hosp_dr"]))
    score_old = (bool(old["handler"]), bool(old["url"]), old["active"], -len(old["hosp_dr"]))
    keep, drop = (new, old) if score_new > score_old else (old, new)
    keep["variants"] = old["variants"] + new["variants"]
    if new["hosp_dr"] and new["hosp_dr"] != keep["hosp_dr"]:
        drs = {d for d in (old["hosp_dr"], new["hosp_dr"]) if d}
        keep["hosp_dr"] = ",".join(sorted(drs))
    return keep


def normalize_rows(scenario, rows):
    merged = {}
    for row in rows:
        rec = normalize_row(scenario, row)
        if not rec:
            continue
        key = _merge_key(rec)
        merged[key] = _prefer(rec, merged[key]) if key in merged else rec
    return sorted(merged.values(), key=lambda r: (r["grp"], r["seq"] if isinstance(r["seq"], (int, float)) else 0,
                                                  r["code"]))
