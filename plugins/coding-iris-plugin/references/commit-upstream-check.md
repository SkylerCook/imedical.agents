# 全局 upstream 检查去重

需求提交工具仍对每个 upstream 执行 pull --ff-only，拉取失败、HEAD 前进或文件快照变化均停止。本轮所有门禁通过后，仅对对应 commit 使用 git -c hooks.requireUpToDate=false commit。此配置仅在该进程及钩子子进程生效，不写入 global/local 配置。project 无 upstream 时仍按原流程提交，不设置该开关。

该开关复用显式 opt-in 的全局 upstream 检查约定。Git 钩子仍执行；凭据扫描、预算检查等其他检查不变，不使用 --no-verify，不修改 core.hooksPath，不调整超时预算。手动提交仍使用原有配置。

## 适用与同步

先通过 git config --show-origin --show-scope --get-all core.hooksPath 与 git rev-parse --git-path hooks/pre-commit 核对实际生效钩子，不依据 .git/hooks 文件存在判断生效。只有读取 hooks.requireUpToDate 的钩子支持本去重；不识别该配置的钩子保持原行为，不自动改写或替换。

实现、测试与本文随既有 plugins 路径分发，无安装器改动、无钩子模板、无需改全局配置。已有工程更新 coding-iris-plugin 即可；未发布版本可按授权定点对比同步。同步完成不等于框架已提交、发布或其他工程已更新。

## 验证

node --test plugins/coding-iris-plugin/scripts/iris-tools/tests/commit-upstream-check.test.js

模拟执行覆盖成功后仅 commit 设置开关、pull 失败、HEAD 漂移、快照变化阻断及 local-only 不设置开关。测试不执行真实提交或联网。跨平台代码不依赖 shell；Windows 已验证，macOS/Linux 仍待对应环境执行。
