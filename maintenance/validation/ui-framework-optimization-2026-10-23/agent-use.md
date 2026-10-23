# 独立 Agent 使用与复审记录

以下为本批真实子 Agent 输出及主 Agent 读回复核摘要，均从无父对话历史的精简入口开始。样本量有限，不代表更多宿主/模型或真实工程的完整遵循效果。

## 规范决策试读（5组）

起点为 coding-iris-plugin/skills/iris-frontend-coding/SKILL.md。实际链路经过 rule/index/general → frontend UI门禁 → iris_ui → imedical_ui/imedical-ui → forms-and-actions、layout-and-navigation、style-differences、tables-and-feedback、source-catalog；实现问题继续读 HISUI widget/style参考和真实vendor源。Agent未读维护报告或tests。

| 场景 | 实际决定 | 观察与局限 |
|---|---|---|
| 标题与行操作图标 | 标题改用现有icon-panel-brand，保留icon-eye/icon-edit及handler/权限/Tooltip | 查到两族资源角色，仍将最终字体绘制留运行态核对 |
| 三类表格边框 | PURE普通启用白1px、PURE白底变体灰1px、IHOS普通描边禁用，不统一白边 | 初次试读时参考表还缺该对照，Agent回查原始JSON才得出完整结果；实现者随后补齐表与测试，此额外读取是本轮可检索缺口 |
| 字段与radio间距 | 普通字段10px与radio图形文字5px分开，复用原生class | 未统一覆盖所有label |
| 保存r6但fill禁用 | 删除错误白卡覆盖，不添加白底/统一r6 | 明确paint开关与存储参数不同 |
| 可配置选项/留白 | 取消数据截断，保留原生dialog内容滚动与尺寸owner；不删除原生外壳的必要overflow:hidden | 未给实际业务代码，右侧留白根因保持待核对；没有声称页面已修复 |

实际读取还包括 frontend-coding-format、execution-guidance、testing-protocol、HISUI CSS及jquery.hisui.js；未采用个人memory历史事实。完整原始输出留本次会话，不复制大段源码或日志。

## 独立实际修改（2个匿名输入）

另一名无父历史Agent从相同精简入口进入，仅获准修改两个任务临时文件，源仓只读。实际4行差异：

~~~diff
-const queryPanelOptions = { title: 'Query', iconCls: 'icon-search' };
+const queryPanelOptions = { title: 'Query', iconCls: 'icon-panel-brand' };
-  return items.slice(0, 3).map(item => ({ id: item.id, label: item.label, checked: item.id === selected }));
+  return items.map(item => ({ id: item.id, label: item.label, checked: item.id === selected }));
-.option-panel { height: 90px; overflow: hidden; padding-left: 15px; padding-right: 31px; }
+.option-panel { max-height: 90px; overflow: auto; padding-left: 15px; padding-right: 15px; }
-.option-panel .options { white-space: nowrap; }
+.option-panel .options { white-space: normal; }
~~~

90px上限与15px来自匿名输入现值，不作为公司默认。rowActions仍为icon-eye/view、icon-edit/edit。Agent实际读取上述门禁、公司图标/动态内容及实施自检指针，未新造框架规则或依赖。Node验证1→24→1数据完整、选中值、末项、严格ID比较和空数据；主Agent另行require读回校验，结果通过。CSS只做静态判断，图标/滚动实际绘制由匿名浏览器证据另证，不把此JS测试说成业务UI验收。临时输入按任务收尾清理，正式保留此diff。

## 反馈决策试读（12场景）

起点为 iris-ui/SKILL.md → verified-cases经验回归入口 → delivery-lifecycle/feedback skill → 共享经验准入与owner；未读maintenance报告/tests。

| 场景 | 实际决定 |
|---|---|
| 已验收、独立机制证据、明确源仓隔离自动补丁授权 | 完成去重/准入/源仓核对后可直接形成相关owner待审diff，不重复索权，不提交发布 |
| 同上但无写入授权 | 只读候选，不能写入 |
| acceptance-pending | 不进入正式feedback；明确要求观察时仅provisional |
| 只知改完好了，无复现/机制/边界 | 不合格，正常结束或补证据 |
| 同需求第三次返修且原计数1 | 计数保持1，不造独立命中 |
| 已有图标规范充分但漏执行 | 修业务实施，不重复规则 |
| 源仓未知/权限不足，仅安装副本 | 候选及缺口，不修副本冒充源仓 |
| framework-maintenance修改feedback本身 | 走维护生命周期，不触发或建议自反馈 |
| feedback available未enabled | 版本/入口/其它门禁满足可只读审查，写入仍须授权 |
| feedback disabled | 不进入，保留缺口，不自动启用 |
| feedback0.1.3 | 不满足0.2兼容区间，不进入新模式 |
| 页面具体虚线/说明首行对齐无复用证据 | 业务特例留项目，不升级公司规则 |

场景未提供具名参数时，Agent没有伪称完成精确去重或固定技术owner。读到的owner包括HISUI widget/index、iris-ui/layout-lifecycle、imedical-ui/forms及layout，通用视觉/布局机制/API归属一致。

## 独立最终复审

审查者只读diff，独立解析17个新增证据节点，核对类别/祖先/paint、UI门禁、版本与公开metrics摘要。发现iris-deploy入口和更新手册仍有固定逐项授权，主Agent已改为唯一契约指针并加入专项10/10复验；审查者随后复核关闭。

源码/实际使用中的真实漏项均保留：初次提炼未覆盖目标外框/普通面板/按钮场景/分类矩阵；初次jsdom用了lightblue而未正确设置iHOS身份；匿名夹具完成信号过早、宽度调用误用layout.resize第二参数。这些在交付前修正并复验，不由早期绿测试推断完整覆盖。

最终复审后确认主仓并行0.5.3已提交，主Agent先快照、三方核对19个上游文件，保留双方维护日志，再将隔离工作树基点更新至467cf3f；本次模板补丁改为0.5.4。所有已发布0.5.3文件保留，不将上游改动计作本任务diff；随后补做版本、项目链接与授权入口复验。
