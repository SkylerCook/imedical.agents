# 工程与环境检查

输入为目标工程与任务，不假设当前目录就是待修改仓库。

1. 读取项目 AGENTS 和 Git 状态，确认模块、标准/定制归属及已有变更。复用现有项目说明，不另建同内容 profile。
2. 检查 settings、模块构建文件、Gradle Wrapper 及项目约定，识别 Java/Kotlin、UI 架构、JDK/Gradle/AGP/SDK 和本地依赖来源；本机配置只读取必要字段。版本来自目标项目，不固定为样本工程版本。
3. 区分声明的工具链和实际命令所用工具链；按需核对 Java 与 Wrapper 输出。Wrapper 可能下载分发包、Gradle 可能解析依赖，先核对本地缓存与项目离线约定，不静默安装或升级。
4. 确认模块、flavor、build type、applicationId/suffix 和任务名。优先现有构建脚本及项目文档，不把其他工程的 assembleDebug 命令直接套入。
5. 输出确认的工程、变体、工具链、可用验证入口与阻碍；设备探测仅在任务需要时按日志取证执行。

当前由 Agent 复用现有命令执行，无专用预检脚本。后续如重复操作证据充分，再抽取 Node 内置模块实现的薄工具；需要 Windows/macOS/Linux 验证后才声明跨平台支持。
