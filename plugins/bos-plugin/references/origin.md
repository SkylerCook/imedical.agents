# 来源与维护

框架 bos-plugin 是正式且唯一的代码维护源；插件内技能继承 manifest 版本。用户级入口引用框架，项目通过既有框架更新流程获取已发布版本。

本轮合并授权自建来源 bos-demand-query 1.0.0，来源字节 SHA-256：

- SKILL.md: c9f29278c8abc67ea1772bf7caa39a9dd25c3cfe6d4ab106caf3638c12c94155
- scripts/bos-demand-query.js: c1d6dc36492e788c1217f191a58c241b13fab00ba879a933d05ff511aa1bd31c
- references/usage.md: 9679727c098f45eb0e9fb4e6d29275631df658d6558d825103396b85d56f4a3a
- tests/bos-demand-query.tests.js: 00438f983c6b9b7510c86c156518dbbd3a7ac168d8881b2143ec9327ae1efb53

保留查询模式、日期生成、过滤、排序、计数、SSE/stdio 与脱敏；框架适配为显式配置、私有配置初始化、TODO 门禁、插件相对引用及 manifest 版本。配置与真实账户样本未引入。

后续修改直接进入框架，通过插件回归、评审及版本发布。过渡期间旧维护源出现新变化时，比较固定版本、哈希、实现、测试与规则，定向合并并保留适配；不整目录覆盖，不反向同步，不让项目更新器读取个人机器。用户级引用见 [接入与迁移](adoption.md)。
