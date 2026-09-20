# 信创插件维护人反馈：既有发布记录阻塞

本材料仅供用户转交，未发送给维护人。用户已授权本轮 IRIS 相关插件优化，agent-context-kit 亦已确认；xc（信创）插件不归用户维护，维持只读。

## 对象与证据

对象：releases/plugin/imedicalxc-doctor-extend-engineer/1.0.2.md。该记录已在实施 HEAD d8f8b909922686dff9b2ba3ec8358c24553740d5 中存在，缺少 commit 字段；当前 validator 要求 Git object id。

复核命令：

```text
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate --repo-root .
```

输出 release-field-missing 与 release-commit-invalid，均指向上述记录。框架演进实现与新发布记录不能消除该历史问题。

## 请维护人处理

请 imedicalxc-doctor-extend-engineer 维护人与版本治理维护人确认合法的历史记录纠错方式。根规范要求已提交发布记录不可修改，不应直接补写历史文件或临时绕过 validator。当前尚无已批准的纠错机制；本轮不替信创插件作版本或记录变更。

## 范围与状态

本轮不修改 plugins/imedicalxc-* 或其历史 release。IRIS 插件的依赖兼容调整已按用户最新授权恢复为本轮实施范围，不再作为待 owner 批准事项。源仓未提交、推送或部署，整体版本门禁仍被此问题阻塞。
