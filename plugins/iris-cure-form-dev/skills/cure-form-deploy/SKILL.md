---
name: cure-form-deploy
description: 为 CA/CR 治疗表单生成部署包，执行 dry-run、受控事务写入、回读验证和回滚；涉及服务器模板发布时使用。
---

# Cure Form Deploy

1. 阅读 `rules/cure_form_deploy.md` 与 `references/cure-form-package-v1.md`。
2. `plan` 前确认规格已批准、`unresolved[]` 为空、MapType 为 CA/CR，并具有服务器期望版本与哈希；任何 `changes` 必须先通过 canonical `preview-run`，取得与当前 gate/runner、snapshot、changes、六类资源及 CSS 依赖清单哈希一致的 `preview-verification`。
   - 若公共模板已有批准版本，提供 `--approved-clones`，确认包内对应项已转为 `referenceOnly`，且 `commonTemplateReferences[]` 完整；禁止同版本公共模板按业务 Map 重复克隆。
3. `apply` 默认 dry-run；真实写入必须再次获得用户明确确认，并传 `--confirm-write --operator ... --reason ...`。
4. 静态资源上传编译委托 `coding-iris-plugin/iris-deploy`；模板业务事务只调用 `web.DHCDocAPPBLDeploy` 专用方法。
5. 写入后立即 `verify` 并回读版本、哈希、组成关系和资源。
6. 验证失败时停止；只有用户明确要求时调用 `rollback`，并记录关联 operation ID。
