---
name: cure-form-deploy
description: 为 CA/CR 治疗表单生成部署包，执行 dry-run、受控事务写入、回读验证和回滚；涉及服务器模板发布时使用。
---

# Cure Form Deploy

1. 阅读 `rules/cure_form_deploy.md` 与 `references/cure-form-package-v1.md`。
2. `plan` 前确认规格已批准、`unresolved[]` 为空、MapType 为 CA/CR，并具有服务器期望版本与哈希；任何 `changes` 必须先通过 canonical `preview-run`，取得与当前 gate/runner、snapshot、changes、六类资源及 CSS 依赖清单哈希一致的 `preview-verification`。`expectedVersion=NEW` 时还必须通过部署前人工交互测试并传入 `--interaction-verification`。
   - 若公共模板已有批准版本，提供 `--approved-clones`，确认包内对应项已转为 `referenceOnly`，且 `commonTemplateReferences[]` 完整；禁止同版本公共模板按业务 Map 重复克隆。
3. `apply` 默认 dry-run；真实写入必须再次获得用户明确确认，并传 `--confirm-write --operator ... --reason ...`。
4. 静态资源上传编译委托 `coding-iris-plugin/iris-deploy`；模板业务事务只调用 `DHCDoc.Cure.AI.CureFormDeploy` 专用方法，不回退到旧部署类。
5. 写入后立即 `verify` 并回读版本、哈希、组成关系和资源。新开发表单以 `expectedVersion=NEW` 判定，直接创建正式模板，不使用灰度；随后生成绑定 package/operation ID 的部署后人工清单，完成保存、重开、回显、打印和 CR 运行时契约验证后才可宣告任务完成。
6. 现有模板改造才进入灰度收尾：单 Map 独占模板运行 `consolidate`，多 Map 共用公共模板运行 `consolidate-shared`。取得写入 operation ID 后再次 `verify` 并回读全部受影响 Map；正式 RowID 已生效、灰度引用数为 `0`、灰度模板及缓存均不存在时才可宣告完成。`cleanup` 仅用于已切换引用后的零引用孤儿模板，不替代正式 RowID 合并。
7. 用户亲自测试时可记录其明确的总体通过反馈；Agent 本地人工自测必须逐项记录。批量脚本化点击、输入或选择必须先申请用户明确确认，canonical v1 不接受自动交互凭证。
8. 验证失败时停止；只有用户明确要求时调用 `rollback`，并记录关联 operation ID。
