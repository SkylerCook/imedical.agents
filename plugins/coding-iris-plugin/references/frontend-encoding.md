# 前端源码与服务器编码

## 现场判断与配置维护

CSP 的 HTTP `charset` 描述响应编码，输出可由 `%response.CharSet` 转换。源码编码应以 Atelier 原字节和项目约定独立核实。例如响应声明 GB18030、probe 同时给出 GB2312/GBK/GB18030 时，三者都是字节兼容候选，具体目标仍需开发人员确认。响应声明和估算字节数均不足以唯一确定源码编码。[InterSystems 官方说明](https://docs.intersystems.com/irislatest/csp/documatic/%25CSP.Documatic.cls?CLASSNAME=%25CSP.Response&LIBRARY=%25SYS)

选择目标前核对所选范围的 probe 候选和文本语义。只有 GB18030 候选的文件需要进一步核实其字符及服务器实际约定，直接选择 GBK 可能无法转换。先按已确认目标执行 convert 检查不可表示字符，遇到例外使用下述路径覆盖配置。候选不自动改变项目配置，历史误解码仍需可靠原文核对。

profile 读取兼容 CRLF、LF 和单 CR。confirm 按主要 CRLF/LF 风格写入并修复单 CR，字段匹配仅消费行内空白；已确认配置的迁移检查保持原文件字节。普通更新复用并合并受管 Pending 区块，保留人工说明及已有值。

## 首次确认与修改前检查

标版使用 UTF-8。按需导出项目首次修改 CSP、JS、CSS、HTML、HTM 前，先核对实际目标、服务器原始文件或静态资源字节、项目约定及开发人员说明，再请开发人员确认目标编码。正常项目确认一次，随后按配置运行。

确认前只做只读调查和 staging 导出。`source-sync plan` 和修改前检查会阻止未确认项目进入前端源码处理。直接使用编辑器、外部 IDE 或任意文件写入不在脚本的机器拦截范围，Agent 必须先执行检查。

从当前工作区调用以下入口，`<files...>` 包括准备修改或新增的前端文件。

```text
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/frontend-encoding-cli.js check --project-root . --files <files...>
```

首次取得开发人员确认后，保存项目级约定。以下示例表示本地 UTF-8、服务器 GBK，实际值沿确认结果填写。

```text
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/frontend-encoding-cli.js confirm --project-root . --source utf8 --target gbk --confirm
```

命令只更新现有 `iris_project_profile.md` 的编码字段，同时保存非敏感目标指纹。目标变化会使原确认失效。已有确认、目标及范围一致时直接执行，无需反复询问。

## 配置契约

```markdown
- 前端源码编码：utf8
- 前端服务器编码：gbk
- 前端服务器编码确认：confirmed
- 前端服务器编码确认环境：由 confirm 自动写入
```

支持 `utf8`、严格 `gb2312`、`gbk` 和 `gb18030`。旧 `前端编码模式` 作为本地编码兼容输入，`project-utf8` 对应 UTF-8，`standard-gb2312` 沿历史 CP936 行为对应 GBK。已有按需项目的 `utf8` 字段不能作为服务器确认依据。更新器保留显式配置，扫描本地字节只报告差异。

同一项目默认统一配置。确有例外时，在同一个 profile 中写路径覆盖表，路径相对 WorkspaceRoot，最长路径优先，准确文件优先于父目录。

| 前端范围 | 源码编码 | 服务器编码 | 确认状态 |
|---|---|---|---|
| `src/web/special.js` | utf8 | gb18030 | confirmed |

仅在开发人员确认该例外后写入。覆盖项沿同一目标指纹，未知范围使用已确认的项目默认值。

## 导出与证据

前端服务器编码已确认时，export 通过 Atelier binary 读取原字节，按服务器编码解码，再按本地源码编码写入，保留末尾换行。显式 staging 使用同一已确认解码配置并输出 UTF-8。回执 serverSha256 表示服务器原字节摘要，本地 sha256 表示本地输出摘要；不同编码的摘要可不同。原始通道不可用时报告 frontend-raw-read-unavailable。服务器确认缺失时保留文本 staging 调查路径，其内容为 Atelier 文本表示，不能用于证明服务器字节一致。按需项目修改对象继续走 source-sync。

导出回执 `encoding`／`localEncoding` 表示本地输出，`serverEncoding` 表示配置的目标，`serverEncodingConfirmed` 表示确认状态。`representation` 与 `hashRepresentation` 明确内容来源及摘要对象。Atelier JSON 的 UTF-8、单个响应 charset 或 GB 解码成功均不足以证明物理文件编码。

`probe --project-root . --files <files...>` 复用 Atelier 会话读取目标前端原字节，报告候选、文件映射及目标指纹。`inspect --files <raw-files...>` 分析已经取得的原始文件。两者均不自动确认。ASCII 无法区分这些编码，GB2312 文本通常同时兼容 GBK 和 GB18030。CSP 的 HTTP 响应是运行结果，源码应通过文档接口读取。静态资源的 Web 地址、端口、重定向和路径必须与目标工程匹配。

## 部署硬校验

普通、guarded、source-sync 及移植发布共用配置与转换实现。上传前严格按源码编码解码，按服务器编码生成产物并回解比对，发布摘要分别绑定源码和实际上传字节。Atelier 上传产物落入当前发布任务或 ContextRoot/work/iris-deploy 的独立任务目录，成功后清理，失败时由回执给出保留位置。配置漂移使旧计划失效。

不可表示字符返回文件、行列和码点，阻止上传。UTF-8 文件头 BOM 在转为 GB 系列产物时作为编码标记去除，本地文件保留。换行保持原样。疑似损坏文本先调查，禁止用替换字符或批量重编码掩盖问题。

既有缺省前端通道保持 SFTP，新项目根据实际可用能力显式选择 Atelier，显式 `web.frontendTransport: sftp` 保留。Atelier 优先请求 binary 原字节。已确认 UTF-8 的既有通道在服务器只返回文本时继续沿文本读写并报告 text-readback，GB 系列目标使用 `enc: true` 的 base64 产物，继续使用时间戳并发保护。GB 系列目标缺少可保证目标字节的通道时在写入前停止，报告 `frontend-target-encoding-channel-unavailable`，不自动切换连接。SFTP 同样上传转换产物并核对目标字节。

CSP、JS、CSS、HTML、HTM 沿同一编码契约，CSP 上传后编译，再回读核对。CSP 页面 charset 声明按项目实际运行约定检查。文件上传、原字节回读、编译和页面验收分别报告。

协议选择参考上游 `getDoc(forceBinary)` 与 `putDoc(enc)` 接口。本地模拟验证覆盖转换和协议，真实 IRIS／Caché 版本必须在授权工程完成最小文件的上传、回读及 CSP 编译试点。[上游实现](https://github.com/intersystems-community/vscode-objectscript/blob/master/src/api/index.ts)
