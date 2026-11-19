# Cure Form Profile

当前工程的运行参数由 `ContextRoot/config/project.jsonc` 的 `pluginSettings.iris-cure-form-dev` 节维护。在工程根使用 `node <CapabilityRoot>/scripts/plugin-settings.js Read iris-cure-form-dev .` 读取。


- CapabilityManifest: .agents/capability.json
- CapabilityRoot: auto
- DocsRoot: docs
- DevelopmentRoot: auto
- DefaultEnvironment: development
- NamespaceSource: local MCP/server profile
- AllowedFormTypes: CA, CR
- RequireDryRun: true
- RequireWriteConfirmation: true
- CommonTemplateStrategy: versioned-clone

WorkRoot 的 auto 选择由[目录与恢复契约](../references/project-directories.md)定义。已有项目显式值不自动迁移。
