# IRIS Interface Profile

## Output

- outputRoot: auto
- keepMarkdownOutOfContext: true

`auto` 使用 extract-doc 的目录解析结果；显式路径仍通过 `--output-root` 原样传递。已有 profile 的自定义目录或 `docs/interface` 保持有效，不自动重写。

## Optional Converters

- preferScriptParsers: true
- allowMarkItDown: true
- allowDocConverter: true

## Handoff

- planSkill: iris-interface-dev-plan
- implementationSkill: iris-interface-build
- codingPlugin: coding-iris-plugin
- codingRules: iris-coding, iris-backend-coding, iris-frontend-coding
- deploymentSkill: iris-deploy

