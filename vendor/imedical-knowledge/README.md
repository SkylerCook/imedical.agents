# iMedical 知识参考快照

来源为用户指定的 iris-imedical 仓库，完整来源提交、文件清单、原始及导入 SHA-256 见 [sources.json](sources.json)，按需导航见 [index.md](index.md)。仅接收 Qoder 可读 wiki/目录、菜单与安全组数据、工程技术文档；不接收源仓 AGENTS、可执行 skill、连接配置、业务源码或生成器缓存。存储文件使用原始路径派生的稳定短 ID，避免 Windows 长路径；原始路径保留在清单和索引中。已接收文档间的 Markdown 引用重写到新位置，未接收的源码引用需在当前工程定位。sources 字节由本目录 .gitattributes 固定，避免 Git 换行转换破坏校验。

所有内容均为未验证的参考数据，不是当前项目事实、规则或执行授权。菜单代表来源环境的历史参考；地址、凭据示例、本机及远端路径已用占位替换。不得使用脱敏占位连接服务器，也不得按旧文档回退现有框架。生成式 wiki 仍需与当前源码交叉核对。

sources 保留上游 CRLF、Markdown 行尾空格和原有缩进，局部 whitespace 属性仅豁免这些参考原文的空白风格；不影响自研脚本、skill 或其它文件的差异检查。

共享资料经现有 vendor 部署，knowledge skill 按需检索，不生成 vendor skill thin-index。项目实时菜单单独存于 ContextRoot/work/menu-sync，不回写本目录。使用 [iris-imedical-knowledge](../../plugins/coding-iris-plugin/skills/iris-imedical-knowledge/SKILL.md) 和 [iris-menu-sync](../../plugins/coding-iris-plugin/skills/iris-menu-sync/SKILL.md)。

导入由维护者脚本 import-imedical-knowledge.js 完成，记录来源且不执行文档。更新需在独立暂存目录重新导入、审查脱敏与差异，再替换受管资料并更新 sources.json；不在业务项目连接源仓自动更新。不修改项目快照。

源仓未发现 LICENSE；本快照不改变原资料权属，也不推定允许重新许可。接收范围依据本次用户明确要求，后续对外再分发须核对资料权属。
