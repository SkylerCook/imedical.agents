# 移动端开发

帮助请求先按[统一帮助](../../docs/guides/capability-help.md)展示用法并结束，不执行设备探测或启用。

本插件首版覆盖 Android 原生 Java/Kotlin 项目；其他移动技术栈先识别现有工具，再说明未覆盖部分，不套用 Android 设备命令。

- 接入：[mobile-dev-init](skills/mobile-dev-init/SKILL.md)。
- 开发与排障：[mobile-dev](skills/mobile-dev/SKILL.md)。
- 启用后的任务入口遵循[移动端工作流](rules/mobile_dev.md)，运行故障第一步主动取日志。

工程身份、定制归属、依赖版本、签名和连接配置以目标项目为准；本插件不保存业务私有事实。无子代理、无 skill 加载能力时，直接读取上述 Markdown 串行执行。

场景路由统一维护在 [mobile-dev](skills/mobile-dev/SKILL.md#按任务加载)：工程检查、页面、接口、WebView/PDA、功能移植与验证交付按需加载。首版为执行流程骨架，尚无专用检查脚本或真机验收结果。

- 项目建仓、现场旧工程纳管及现场 AI 交接：[mobile-project-repo](skills/mobile-project-repo/SKILL.md)。默认复用项目约定，建空仓不以未知历史为前置；建完必交付现场提交提示词。
