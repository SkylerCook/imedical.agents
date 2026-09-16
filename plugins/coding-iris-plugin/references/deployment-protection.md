# Git 主线与部署保护

前后端上传共用 deploy-guard.js。服务器内容只进入用户私有状态目录和临时部署产物，不能复制回源码或暂存区。Git 提交工具不读取这些内容。

## 建立会话

在需求修改前执行 `node deploy-guard.js init <GitRoot> <需求号>`：工作区须干净、有 upstream，pull --ff-only 成功后固定基线。已有修改必须由用户确认修改前提交，执行 `init <GitRoot> <需求号> <base-ref> --confirm-baseline`。不得自行把 HEAD 当成修改前版本。

执行部署时自动 fetch；upstream 有未集成更新则停止。用户完成集成并确认后执行 `rebase <GitRoot> <需求号> <新基线> --confirm`。该操作保留首次合并记录及部署快照。

## 部署入口

- 前端：`node deploy-frontend.js --project-root <workspace> --source-root <frontend> --demand <id> --files <project-relative-files...> --execute`，SSH 信任参数沿用。
- 后端：`node compile.js --project-root <workspace> --demand <id> --files <project-relative.cls|mac|inc...> --execute`。
- 一个批次限一个 GitRoot。后端文件顺序为调用方已核实的依赖编译顺序。
- 后端使用既有 Atelier 连接配置及编译能力，源码接口为 doc；未知导出格式停止。宏和 include 必须有可确认的 ROUTINE 声明。
- 原 compile.js 位置参数上传被阻止；缺少需求会话不能回退旧上传路径。
- 无 --execute 不连接服务器。部署之前仍须已有明确用户授权。

服务器等于本地时跳过；等于基线时上传本地；首次其它差异执行三方文本合并。后续以最近成功本地快照和部署产物应用增量。首次合并后远端再次变化停止。每文件上传前再次读取，上传后回读；这不是远端原子条件写入，不能阻止其它账号并发覆盖。

全批合并检查完成后才写入。UTF-8、NUL、冲突标记、JS 语法检查内置；检查不代替调用方的业务验证。Storage 差异、远端删除、新增碰撞及无法确定的后端格式进入人工处理。不得用 --decision 绕过 Storage 或语法检查。

## 人工处理

返回 needs-user-input 时，Agent 必须使用当前可用的 Question 工具；工具不可用则简短文字提问。列明 reason、文件、基线和 localHash/remoteHash，查看本地私有会话保存的证据，说明选项影响；不得自动生成授权决定。

用户明确授权本次重新合并或覆盖后，可创建私有 JSON：`{"action":"merge|overwrite","token":"响应中的 token"}`，通过 --decision 传入。token 绑定需求、环境、文件、基线、本地和服务器内容，版本改变即失效。碰撞、删除若选择覆盖须明确告知会恢复/替换远端文件。默认选项是暂停协调。

写入中断、回读或编译失败保留 failed-or-unknown，并持续阻止后续执行。先人工核对服务器，再对新返回 token 明确授权 `{"action":"resume","token":"..."}` 才能恢复。resume 不自动解决冲突或再次覆盖，仍会按文件检查。

## 状态与清理

记录位于用户主目录 .iris-deploy-state，路径由本地仓库与需求哈希隔离，环境进一步哈希隔离。快照不含连接密码，但含源码，应仅供当前用户访问。缺失/损坏记录停止，不从现有服务器重建；已有记录不能通过重复 init 重置。

会话锁仅保护本机同需求并发。进程中断留下锁时，应确认没有存活部署进程，再由用户授权清理锁，不能自动抢锁。

需求结束执行 `close <GitRoot> <需求号> unused --confirm` 清理正文快照并保留哈希审计。关闭后不得自动重开。部署临时目录在 finally 清理。

Git 提交只依据业务工作区；合并服务器内容后的运行结果应标记为混合产物验证，不代表纯 Git 版本已验收。无后台监控、自动回滚和远端锁。

## 验证

`node --test plugins/coding-iris-plugin/scripts/iris-tools/tests/deploy-guard.test.cjs` 使用临时 Git 仓库与模拟远端。真实服务验证仅限另行授权的独立测试文件/类，不自动上传业务文件。

后端更新携带导出结果 ts 的 IF-NONE-MATCH 条件，不设置 ignoreConflict；实现依据 [InterSystems VS Code ObjectScript 客户端](https://github.com/intersystems-community/vscode-objectscript/blob/master/src/api/index.ts)。前端采用上传前哈希复核及原子替换；两者仍不能阻止随后发生的其它工具写入。
