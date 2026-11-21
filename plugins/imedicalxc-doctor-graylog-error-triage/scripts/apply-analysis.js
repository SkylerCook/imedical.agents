'use strict';
// 把会话侧的分析结论写回待分析队列（一次性工具，跑完可删）

const fs = require('node:fs');
const path = require('node:path');

const QUEUE = path.join(__dirname, '..', 'config', 'pending-queue.json');

const ANALYSES = {
  '7d7122790afb447e': {
    rootCause: [
      '`SqlLimitInterceptor`（`hisbase-mediway/hisbase-db/src/main/java/com/mediway/his/base/db/filter/SqlLimitInterceptor.java:24-41`）在结果集 ≥ `mediway.his.maxRows`（默认 10000）时**只打 ERROR 日志，不抛异常、也不截断结果**，查询照常返回。',
      '',
      '本次触发的是 `oe_ord_item ta JOIN nr_ord_item tb` 的医嘱查询：`ta.adm_dr IN (数百个 ?)`，UNION「待处理 / 停止待处理」两个分支，外层再套一层 FROM 做字段扩展。参数列表塞了几百个住院号，JOIN + UNION 后放大到 142517 行。',
      '',
      '本质是**查询粒度错误**：按「一批患者 ID」批量拉全部医嘱明细，缺少患者维度或时间窗约束。',
    ].join('\n'),
    fix: [
      '1. 定位 Mapper：搜含 `oe_ord_item ta` + `nr_ord_item tb` 的 XML，确认 `adm_dr IN` 列表来源（疑似批量取患者医嘱列表的接口）',
      '2. SQL 加强制时间窗，例如 `AND ta.order_datetime >= #{startTime}`；或对 `adm_dr` 列表分批（每批 ≤ 50）',
      '3. 确需大批量时改为分页 + 流式处理，避免一次把 14 万行装入 List',
      '4. 该日志仅告警不阻断，修复前先观察是否伴随接口超时与 GC 抖动',
    ].join('\n'),
    verification: '修复后重跑巡检，确认 `sql查询结果行数` 告警不再出现（阈值 10000）；同时对比该接口 P99 耗时与堆内存曲线。',
  },
  'd2e49064e4090797': {
    rootCause: [
      '调用链：opreg 取消预约（`DealApptionmentAbstract.cancelAppointmentBiz:221 → stopOrdMulti:353`）→ Feign `UpdateOrderStatusClient.stopMulti`（`UpdateOrderStatusClientAbstract:35`）→ opcare `OpCareUpdateOrderStatusController.stopMulti` → `OpCareCheckOrdItemStopAbstract:97-118` 调 `opArOrdItemBLH.verifyStop` 做计费校验 → 计费返回 code=0「医嘱编号=147900已经结算」→ 包装成 `stop1003` → opreg 再包装成 `rpcException("调用【门诊诊疗】服务的停止医嘱接口异常:" + msg)`。',
      '',
      '根因是**业务状态冲突**：取消预约要停止关联医嘱，但该医嘱已收费结算，计费规则拒绝停止已结算医嘱。',
      '',
      '注意 `OpCareCheckOrdItemStopAbstract:99` 的 `if (!OperOrdItemStatusSourceEnum.AR.equals(operSource))` —— 只有计费/退费来源才跳过该校验，opreg 取消预约走医生站来源，因此必然被拦。',
    ].join('\n'),
    fix: [
      '1. 业务口径（优先）：取消预约前先判断关联医嘱是否已结算，已结算则引导走「退费 → 再取消预约」，前端给出明确提示而非抛服务异常',
      '2. 代码口径：`UpdateOrderStatusClientAbstract.stopMulti` 捕获 `HisBusinessException` 时区分「业务校验失败」（保留返回码与原文）与「服务不可达」，不要把业务提示统一包装成「调用服务异常」，否则真实原因被掩盖',
      '3. 不建议把 `operSource` 改成 AR 绕过校验——会造成费用与医嘱状态不一致',
    ].join('\n'),
    verification: '用同一条已结算医嘱重放取消预约，确认返回可读的业务提示而非 rpc 异常；再用未结算医嘱验证正常取消流程未被破坏。',
  },
};

function main() {
  if (!fs.existsSync(QUEUE)) {
    console.error('[ERROR] 队列文件不存在: ' + QUEUE);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  const entries = Array.isArray(data.entries) ? data.entries : [];
  let hit = 0;
  for (const e of entries) {
    const a = ANALYSES[e.errorHash];
    if (!a) continue;
    e.analysis = a;
    e.status = 'analyzed';
    e.analyzedAt = new Date().toISOString();
    hit += 1;
    console.log('[OK] 已写入分析: ' + e.errorHash + ' (' + e.ownerModule + ')');
  }
  for (const h of Object.keys(ANALYSES)) {
    if (!entries.some((e) => e.errorHash === h)) {
      console.warn('[WARN] 队列中找不到 errorHash=' + h + '，已跳过');
    }
  }
  fs.writeFileSync(QUEUE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('[OK] 写入 ' + hit + ' 条，队列: ' + QUEUE);
}

main();