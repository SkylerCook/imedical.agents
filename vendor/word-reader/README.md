# word-reader

Word 文档读取 skill，支持 `.docx` 和 `.doc` 格式，提取文本、表格、元数据等内容。

本目录为原始 skill 的 canonical 来源，按 `imedical.agents` 的 vendor 资产模式管理。业务工程通过插件 skill 直接引用本目录下的文件。

## 文件

- `SKILL.md`：skill 主文件
- `scripts/read_word.py`：Python 读取脚本
- `README.md`：使用说明
- `skill.json`：原始 skill 元数据
- `DEVELOPMENT.md`、`PUBLISHING.md`、`test.md`：开发与发布资料

## 使用方式

由引用方（如 `plugins/imedicalxc-doctor-extend-engineer/`）的 skill 按路径读取：

```text
.agents/vendor/word-reader/SKILL.md
.agents/vendor/word-reader/scripts/read_word.py
```

## 更新方式

直接修改本目录即可。引用方按 vendor 路径读取最新内容，无需额外的 wrapper 同步。

## 原始来源

本 skill 已从用户本地技能目录迁移到本仓库：

- 原位置：`C:\Users\tanxi\.claude\skills\word-reader`
- 现 canonical 位置：`vendor/word-reader/`
