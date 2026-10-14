# HISUI 资产升级

本入口服务能力包源仓 HISUI 维护，随 vendor 目录可见；业务任务只读取快照，不从业务副本执行上游升级。版本与范围见 [README.md](README.md)、[upstream.json](upstream.json)。

用户要求检查或升级 HISUI 时：

1. 在能力包源仓读取根 AGENTS.md 和维护记忆。检查 vendor 工作区，保留其它会话改动；快照存在本地修改时先处理归属。执行 `node maintenance/hisui-build/update-hisui-vendor.js check`，已最新且完整性通过时结束。
2. 阅读返回的上游 compare 链接，核对 JS、CSS、主题、locale 与图标影响。上游没有 Release，选择完整 commit，不以 package.json 的静态版本号比较。打包目录用于对照构建和分发边界，主 JS 的新旧分别核实；Git 外分发输入按 distribution-assets.json 固定摘要，不把整包宣称为同一提交构建。
3. 按源仓 `maintenance/hisui-build/README.md` 在本任务临时目录准备锁定依赖。使用 `update --commit <完整SHA> --tools-dir <工具目录>`；已有干净上游 checkout 可用 `--source-dir`，脚本核对 HEAD、拒绝 dirty 输入，完成构建和校验后替换受管快照。网络、输入、构建或校验失败必须停止；已有资产保留或回滚。
4. 执行离线 `verify` 与 HISUI 专项回归。核对控件/样式参考是否仍与实现一致，按插件版本治理处理实际参考改动。API 名与类型、getValue helper、数据表编辑、主题资源分开核对；不得加入应用层 shim 掩盖差异。
5. 同步根 README、docs/update-agents.md、维护摘要/日志；未完成的平台或真实 HIS 验证进入已有 backlog。清理本任务临时目录。提交、推送与业务工程同步沿用当前任务的明确授权。

完成条件：upstream.json 的提交和构建来源明确；完整文件清单及哈希、主 JS/压缩 JS 与源码索引校验通过；关键控件回归有本机证据；实际 HIS 的未知差异明确说明。只读月检仅执行步骤 1–2，有变化时提醒并给出范围，不触发资产写入。
