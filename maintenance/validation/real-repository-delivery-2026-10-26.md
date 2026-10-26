# 实仓提交门禁与主子交付验证

2026-10-26，framework-maintenance；实施基点 `3b1c5bc368175d99fffa2318d514268e2dc0987e`。实施阶段只修改能力包源仓，未暂存、提交、推送、更新业务副本或操作真实 BOS；用户随后授权本批 c + p，按 README 双远端约定执行，实际结果以 Git 回执为准。真实 BOS 和业务副本操作不包含在本次授权内。

## 实现与来源

- 实仓条件由根共享 `scripts/lib/real-repository-commit.js` 计算，BOS 独立补录与验收状态流共用；既有 Git CLI 与 Node 内置库足以实现本次明确门禁，无新增第三方依赖或交付运行器。
- 选择绑定实仓 repo、完整 ref、40位 hash。linked worktree 路径、目标分支未包含提交、错误分支、非根目录及 detached checkout 均拒绝；共享对象库存在提交不等于集成完成。普通 submodule 与物理路径别名保留支持。
- BOS plan、submit 及导出的 submit 写入边界先验证实仓，最后重新读取提交并生成 payload；不接受裸 payload。配置读取期间目标改变也会在最终边界停止，失败不发请求。
- 共享代码 parent 引用主实仓提交逐项日志，一次共享 push；own 子项独立交付，none 跳过。整组状态按全部成员计算。共享 push 同时检查引用子项的精确 BOS 选择和成功码，旧成功标记不能替代回执。
- 版本为 demand-delivery-plugin 0.8.0、bos-plugin 0.17.0，均声明 breaking/migration。已有回执保留；新选择须补 ref 并指向实仓，不迁移凭据或重发历史日志。

## 本机行为验证

环境：Windows，Node.js 24.14.1，Git CLI，默认 PowerShell 7。所有 Git 写入均限任务隔离 fixture，HTTP 均为 mock；未连接真实日志接口。

| 验证集合 | 结果 | 核心证据 |
|---|---|---|
| BOS 采集与写入 | 12/12 | 单/跨仓聚合、精确提交选择、授权、HTTP/ResultCode、脱敏与零自动重试 |
| 最终状态流与主子回归 | 42/42 | 验收索引18、主子接口12、实仓专项12；后两次最终回归均通过 |
| 插件发现与恢复 | 11/11 | standard、Overlay、单共享目录、已启用入口可调用、迁移与缺依赖不误启用 |
| 分发与链接 | 2/2 | 新根共享库被 install/update sparse 规则覆盖，部署引用可达 |

上述去重后共67项。新实仓专项覆盖：修复分支已推送但未合实仓（BOS请求为零）、对象库共享陷阱、fast-forward/merge/cherry-pick/squash、错误 ref/hash/root、submodule/链接、混合 own/parent/none、无代码主项与独立代码子项、旧回执恢复、来源 claim 与最终实仓分离、伪成功/子项错 ref 回执、最终写入前目标漂移。

实际执行命令（长命令按原测试集合保留）：

```text
node --test --test-reporter=spec plugins/bos-plugin/tests/bos-code-update-log.tests.js plugins/bos-plugin/tests/bos-demand-log.tests.js plugins/demand-delivery-plugin/tests/acceptance-session.test.js scripts/tests/demand-hierarchy.tests.js
node --test --test-reporter=spec scripts/tests/real-repository-commit.tests.js plugins/demand-delivery-plugin/tests/acceptance-session.test.js scripts/tests/demand-hierarchy.tests.js
node --test --test-reporter=spec scripts/tests/bos-plugin.tests.js
node --test --test-reporter=spec --test-name-pattern="project links resolve|exact destinations" scripts/tests/documentation-layout.tests.js
```

## 版本审计与限制

worktree 版本校验识别本轮两个 breaking 升级；与 HEAD 对照，新增治理问题为0。完整审计仍报告既有 `imedicalxc-doctor-extend-engineer` 1.0.2、1.0.3、1.0.4 发布记录缺少/无效 commit，共6条诊断，基线与当前一致，未改写不可变历史记录。

```text
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate --repo-root . --base-ref HEAD --worktree --accept-breaking plugin:bos-plugin@0.17.0 --accept-breaking plugin:demand-delivery-plugin@0.8.0 --format json
```

Windows/macOS/Linux × Node 22/24 已接入既有 CI，尚未取得本轮远端矩阵结果；真实宿主按规则执行、真实 BOS 服务及业务副本升级效果仍待各自授权取证。本机隔离验证不代替这些结果。

测试使用任务临时目录并由 fixture 清理；正式证据以本记录、维护日志和本地验证指纹保存，不保留原始临时日志或测试仓库。
