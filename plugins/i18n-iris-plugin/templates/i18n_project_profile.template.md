# i18n 项目适配配置

本文件记录目标工程的 i18n 语义配置。MCP 连接信息以工程根目录 `.mcp.json` 为唯一事实来源，本文件不保存 host、端口、账号、密码等敏感连接配置。

## 基本策略

- 源语言：简体中文。
- 源文案 key：简体中文原文。
- 默认目标语言：`EN`。
- 可扩展目标语言：`FR` 等，具体语言目录以运行环境为准。
- 只翻译用户可见文本，不翻译业务编码、状态编码、类名、表名、字段名、URL、接口参数名或持久化标识。

## 语言目录

- 语言事实来源：`User.SSLanguage` / `^SS("LAN",langId)`。
- 页面级翻译使用 `langId`。
- 字典/表字段翻译使用语言代码。
- 常用兜底映射：
  - `EN -> 1`
  - `CH -> 20`
  - `FR -> 61`

## 前端 i18n 适配

- CSP 静态文案 helper：`#(..Get("中文"))#`。
- JavaScript 静态文案 helper：`$g("中文")`。
- JavaScript 占位符文案 helper：`$trans("中文{0}", value)`。
- UI 框架自动翻译文本不重复包裹 helper，但必须进入翻译表。

## HISUI 源码配置

- `HISUI_SRC`：`TODO: references/hisui/hisui-0.1.0`。
- 主源码文件：`${HISUI_SRC}/dist/js/jquery.hisui.js`。
- 如果目标工程不使用 HISUI，可删除本节，并不复制 `i18n-hisui-widget-index.md`。

## 后端 i18n 适配

- 页面级非字典提示 helper：`%Trans(text, SessionStr, args...)`。
- 显式页面码 helper：`%TransPage(pageCode, text, SessionStr, args...)`。
- 字典/表字段展示值 helper：`%TranslateTableFieldValue(tClassName, fieldName, fieldValue, languageId, qTrantable)`。
- 多入口后台接口必须追踪入口主页面；自动上下文不可靠时，使用显式页面码。

## 页面级翻译存储

- 默认存储：`^websys.TranslationD("PAGE", langId, pageCode, chineseSourceText)=targetText`。
- `pageCode` 使用入口主页面。
- 局部页面不作为页面级翻译归属。
- 回滚只允许按语言、页面、条目删除，严禁删除整个语言根节点。
- 迁移到其它工程时默认沿用本存储；仅当目标工程已有不同翻译存储机制时才覆盖本节。

## 页面翻译种子类

- 本地源码路径：`TODO: src/.../UploadPageTrans.cls`。
- ObjectScript 类名：`TODO: Package.UploadPageTrans.cls`。
- 单条写入方法：`SetPageTrans(languageCode,page,item,translation)`。
- 单条回滚方法：`KillPageTrans(languageCode,page,item)`。
- 增量批次方法命名：`Save{LANG}Translate{YYYYMMDDNN}()` / `Kill{LANG}Translate{YYYYMMDDNN}()`。
- 语言聚合方法命名：`Load{LANG}Translation()` / `Kill{LANG}Translation()`。
- 生成种子调用时使用全类名：`##class(<seedClass>).<method>(...)`。

## CSP 翻译同步配置

- 默认语言：`EN`。
- 默认行为：先输出差异报告；只有用户明确要求时才重写本地种子文件或部署到服务器。
- 备份目录：`docs/i18n-csp-trans-sync/backups/`。
- 页面组：
  - `TODO`：
    - `TODO.main.csp`
- 同步方法组：
  - `TODO`：`SaveENTODO()` / `KillENTODO()`。
- 聚合方法：
  - 加载：`LoadENTranslation()`。
  - 回滚：`KillENTranslation()`。

## 字典翻译适配

- 默认存储表：`BDP_Translation`。
- 类名字段：`BTTableName`。
- 属性字段：`BTFieldName`。
- 语言字段：`BTLanguages`。
- 源展示值字段：`BTFieldDesc`。
- 目标展示值字段：`BTTransDesc`。
- SQL 默认由用户审核后手动执行；自动化只做只读验证，除非用户明确要求写入。
- 迁移到其它工程时默认沿用本存储表结构；仅当目标工程已有不同字典翻译存储机制时才覆盖本节。

## MCP 能力需求

执行涉及服务器的 i18n 任务时，先读取工程根目录 `.mcp.json`：

- IRIS 命令执行能力：用于读取/写入 global、运行 ObjectScript。
- IRIS 文档编译能力：用于编译 ObjectScript 类。
- IRIS 类方法执行能力：用于加载/回滚翻译种子。
- IRIS SQL 查询能力：用于字典数据提取和只读验证。
- SFTP 上传能力：用于部署本地源码文件。

## 当前业务边界

- 当前工程主线：`TODO`。
- i18n 或需求变更优先限制在相关业务模块内。
- 本地协作资料是否进入 Git：`TODO`。
