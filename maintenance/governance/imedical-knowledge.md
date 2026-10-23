# 知识资产维护

从框架源仓根执行；业务使用见[知识接入](../../docs/guides/imedical-knowledge.md)。

## 更新来源资料

维护者从固定源提交的临时检出运行 `.agents/skills/agent-kit-maintenance/scripts/import-imedical-knowledge.js <source> <new-staging-target>`。检查来源、逐文件差异、脱敏和可读资料清单后更新 vendor，再验证清单 hash 与检索。该脚本不是业务部署内容，既有 vendor 目标不允许直接覆盖。源仓未提供 LICENSE，本次接收不改变资料权属。

## 验证

`node --test scripts/tests/iris-menu-refresh.tests.js` 验证已登记全量采集的物理分段解析、真实/虚拟 ID 冲突、动态启用组、分页、带校验和断点与恢复、方法/schema/来源漂移、异常删除/空组、并发锁和证据原子写入失败。该专项复用原 knowledge-menu-validation 三平台 Node22/24 CI；本机测试与真实来源试跑分别记录，不以 CI 配置代替跨平台结果。

`node --test scripts/tests/iris-knowledge-menu.tests.js` 覆盖完整/部分刷新、输入与基线漂移、失败保留、链接边界、检索、共享资料 hash、standard/Overlay 及 PS7/PS5.1 thin-index。Windows/macOS/Linux × Node22/24 的 CI 配置见 knowledge-menu-validation.yml；只声明矩阵不等于已执行。真实 MCP 采集、目标实例菜单范围和页面定位需独立验证，本轮不自动访问医院环境。
