# 来源与迁移

来源为用户授权引入的自建 bos-demand-query 技能，登记版本 2026-10-13.4。下列 SHA-256 固定本次读取的来源字节，不包含个人配置或连接信息。

- SKILL.md: c1b6f4e0f2cfc6bccf063271ee185de69994d38ed9e94f68bd459da7a79498d0
- scripts/bos-demand-query.js: 6748fdb14b041c2d8cbd4cc3e8bdeb6487f3810478d62bd7421abdc7239c545e
- references/usage.md: f28e9a691f669c4644b1479d4210501d4c417754d5b23480f3f4595ce7a6baf1
- tests/bos-demand-query.tests.js: fcdfa06c923d9d047c119d70536ee69f571f6d3f045a64de150f8aa0f5324a96

保留原有查询、SSE/stdio 与脱敏实现。框架改动：显式配置取代代码相对配置路径，引用调整为插件布局，服务版本来自 manifest，删除个人账户验证样本，扩展配置及分发回归。原维护源本次未修改。协议依据与实现边界见 usage.md。
