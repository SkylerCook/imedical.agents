# 夜跑首次用量监督修复验证

taskKind: framework-maintenance

## 问题与修复

本轮实际启动样本中，线程已进入执行，首次 token 通知尚无计数但含额度信息；监督器将这一状态直接判作观测失败并中断。该样本说明首次用量可暂缺，不推断其发生频率或供应商交付时序保证。

无原生 Goal 的有界任务复用原预算预留、原始启动回执和存活 watcher 等待真实用量；归一化 ACK 丢弃宿主字段后，从严格绑定的原始回执取回 watcher 引用并验证 PID、控制通道 challenge 和硬截止。未知不写成 0，终态未知仍占用预算；已有真实终态记录且预留已结算时可恢复读数，不重复写 usage。

预留占满预算只停止领新；实际计数到达单任务预留上限时请求停止，后续读数暂缺仍以同 action/endpoint 的持久真实计数维持耗尽判断，直到确认终态。额度、监督或绑定失效继续收尾。没有新增用户配置、授权或状态库，不重置原预算。

## 已执行验证

- Windows、Node 24.14.1，设置 `CODEX_TEST_EXECUTABLE` 为已安装 Codex CLI 后运行 `node --test scripts/tests/night-client-supervisor.tests.js scripts/tests/night-client.tests.js scripts/tests/night-quota.tests.js scripts/tests/night-quota-weekly.tests.js scripts/tests/night-quota-dispatch.tests.js`：84 项通过，无跳过。
- 上述 CLI 用例使用隔离临时配置及回环模型，两端点 startup、ACK、终态及进程退出检查通过；没有连接外部模型或业务环境。
- 独立 Review 复跑监督器 34 项通过，未发现剩余阻断；另以实际 worker、ACK 归一化及原回执读取链验证 watcher 恢复，宿主 adapter 为替身。
- 项目文档链接专项通过；提交前校验复用已记录的 scoped 验证指纹，并检查精确暂存边界。

## 同步与局限

仅修改既有根脚本、专项测试与就近说明，不改变插件版本、安装入口或 sparse 路径。已部署工程按现有根能力更新及 Overlay 刷新取得，无新增配置或兼容清理步骤。维护摘要、README、backlog 与目录入口核对后仍适用，未扩展到并行工作台或离线部署改动。

macOS/Linux 未在本轮执行，不能以 Windows 结果宣称跨平台通过。真实业务任务须在部署态更新后恢复原 run 取证；本记录不代替业务实现、部署或浏览器验收。协议参考[官方 App Server 生命周期](https://learn.chatgpt.com/docs/app-server)。
