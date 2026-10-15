# 夜跑合成浏览器验证环境

仅供源仓 CI，随项目部署的运行时不依赖此目录。Playwright 上游为 https://github.com/microsoft/playwright ，Apache-2.0；不改编或 vendoring 其源码。固定 playwright-core 1.62.1，完整性摘要取自已安装宿主运行时的 pnpm lock，npm ci 按锁校验。实际 CI 下载与三平台运行成功需分别取证。

CI 显式 npm ci、通过已安装的 playwright-core CLI 准备 Chromium，再运行合成测试。用户机器仅复用现有模块/浏览器；缺失时报准备要求，不执行安装。PLAYWRIGHT_RUNTIME_MODULE 显式指向模块，PLAYWRIGHT_EXECUTABLE 可指定本机已有 Chromium 系浏览器；结果记录实际版本，不将 Chrome 与 bundled Chromium 宣称为同一环境。

后端与 UI fixture 均仅监听 127.0.0.1，截图在任务临时目录内生成并由测试清理，不访问业务系统。
