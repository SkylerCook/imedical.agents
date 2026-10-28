# 人工独立工具

这里的工具面向人工使用，运行不依赖 Agent、skill 或 `.agents`。工具源与使用说明放在同一目录，可单独拷贝；不随业务项目能力包安装/更新分发。

| 工具 | 使用说明 | 交付包（本机生成） |
|---|---|---|
| IRIS 内网源码导出 | [iris-code-export](iris-code-export/README.md) | `dist/iris-code-export.zip` |

导出包只包含 `README.md`、`export-iris-code.ps1`、`files.example.txt`，不包含 XML 编辑器、框架文件、测试、连接配置或现场源码。XML 带回后由 AI 修改的流程继续归 coding 插件。

维护者从仓库根重建 ZIP（PowerShell）：

```powershell
New-Item -ItemType Directory -Path tools/dist -Force | Out-Null
Compress-Archive -LiteralPath tools/iris-code-export/README.md, tools/iris-code-export/export-iris-code.ps1, tools/iris-code-export/files.example.txt -DestinationPath tools/dist/iris-code-export.zip -Force
```

只长期保留一份工具源码和一个 ZIP。`tools/dist/` 只放正式压缩包，由 Git 忽略；打包、解压验证均使用任务专属临时目录，完成后立即清理，不在 dist 保留解压副本。

需要带现场连接示例时，在任务临时目录中复制三个文件，仅在临时 README 的 `local-atelier-example` 标记处填入已获授权的本机示例，打包至 dist，核对 ZIP 后删除临时目录。真实服务器地址只留在本机 ZIP 中，账号密码始终不写入文件；共享源 README 保留通用格式。独立测试直接解压 ZIP，与源脚本/清单及 README 模板核对，不依赖打包暂存副本。
