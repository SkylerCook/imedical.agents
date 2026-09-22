# IRIS 按需编码辅助

本参考只补充默认方法，不新增权限或硬门禁。assisted 或命中困难时只读相关段落。

## 定位与小步验证

输入：需求现象和已知入口。先读目标源码及一个直接调用方，列出已证实事实与缺口；信息不足时补查对应调用链，不从零散导出推断全工程。输出：可验证的改动范围。每次修改后检查目标行为及直接回归，失败时先解释证据，再选择修复。

## ObjectScript

正确后条件示例：`continue:(cond1)&&(cond2)`；错误示例：`continue:(cond1) && (cond2)`。修改已有类只改需求涉及位置；参数缺失需防止 `<UNDEFINED>`。签名不确定时走 iris-mcp-lookup，不猜 API，不因查语法就扩大到远程执行。细节见 cls-coding-format.md 与 iris_coding_backend.md。

## HISUI 与编码

先看页面已使用的控件和实际加载资源，API 不明再查 hisui-widget-index.md 和对应源码。触碰文件修改前后检测实际字节；UTF-8 正常时无需展开编码报告，异常沿领域门禁停止，不自动转码。

## i18n

先判定文本是否由 UI 框架自动翻译；例如 datagrid 列头 title 不机械套 helper。动态值作为占位符参数，key 保持稳定字面量。错误示例：`$g(variable + "文案")`。使用项目 profile 的 helper，按 i18n 规则运行静态检查；不因简单文案改动创建完整 workflow。
