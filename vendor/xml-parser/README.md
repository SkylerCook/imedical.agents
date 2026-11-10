# 固定 XML 解析运行时

为 IRIS 版本清单及部署 XML 提供严格的 XML well-formedness 解析。此目录随现有 vendor sparse 范围分发，不生成 skill，也不要求项目执行 npm install。

- [saxes 6.0.0](https://github.com/lddubeau/saxes/tree/v6.0.0)，固定提交 `211fa0ebec9b628affc09219199639887174bfc3`，ISC 许可证。
- [xmlchars 2.2.0](https://github.com/lddubeau/xmlchars)，MIT 许可证；仅分发 saxes 实际引用的三个字符表。

归档的 SHA-512 integrity 与落盘 SHA-256 见 `upstream.json`。saxes 的三处 `xmlchars/...` require 改为本目录相对路径，并去掉三个循环标签后的行尾空格；其余运行时代码保持发行包字节。npm 发行包未含 saxes LICENSE，许可证取自固定 Git 提交，连同 xmlchars LICENSE 一并保留。

选择 saxes 是因为它校验 XML well-formedness，包括重复属性、实体及 CDATA；仍活跃的 sax-js 自述 strict 模式会接受部分不合法 XML，不能直接满足本入口。saxes 上游于 2025-12-31 归档，固定依赖的缺陷评估与更新由本仓维护；调用层限制输入字节、深度和条目数，拒绝 DTD，不加载外部实体或访问网络。不引入其构建链或开发依赖。

更新时先取固定候选和许可证，核对 integrity、上述局部补丁及全部文件摘要，再运行 XML 清单／部署包专项及跨平台矩阵。不能仅替换版本字段或假设上游通过等于本项目集成通过。
