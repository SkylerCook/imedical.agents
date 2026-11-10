# Cure Form Profile

- CapabilityManifest: .agents/capability.json
- CapabilityRoot: auto
- WorkRoot: auto
- DocsRoot: docs
- DevelopmentRoot: auto
- DefaultEnvironment: development
- NamespaceSource: local MCP/server profile
- AllowedFormTypes: CA, CR
- RequireDryRun: true
- RequireWriteConfirmation: true
- CommonTemplateStrategy: versioned-clone
- ResponsiveDeploymentStrategy: versioned-clone
- PreviewVendorRoot: .agents/vendor/hisui
- PreviewHisuiCss: .agents/vendor/hisui/dist/css/hisui.pure.min.css
- PreviewJqueryJs: .agents/vendor/hisui/dist/js/jquery-1.11.3.min.js
- PreviewHisuiJs: .agents/vendor/hisui/dist/js/jquery.hisui.min.js
- PreviewHisuiLocaleJs: .agents/vendor/hisui/dist/js/locale/hisui-lang-zh_CN.js
- PreviewAsscomCss: <required>
- PreviewAdaptationCss: <required>
- PreviewBrowserCommand:
- CommonMigrationConfig: <required>

WorkRoot 的 auto 选择由[目录与恢复契约](../references/project-directories.md)定义。已有项目显式值不自动迁移。
