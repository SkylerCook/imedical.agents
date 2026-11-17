// Product surfaces from docs/agents-workbench-plan.md. No execution or secret storage.
export const domains = [
 ['identity','工程身份与接管','工程','工程名称|开发方式:连接开发,离线开发|接入方式:只读识别,按域接管|配置域:工程信息,IRIS,BOS,知识提供方','AGENTS.md / .agents/config/','识别已有文件 → 查看来源 → 按域接管 → 回读；首次导入不改写等价文件'],
 ['iris','IRIS 开发连接','当前工程','环境别名|协议:http,https|主机|端口|命名空间|用户名|密码!|TLS 验证:开启,关闭|开发方式:connected,offline','project-env.json / .mcp.json / 受管 backend','核对多来源 → 修改 → 预览消费者 → 应用 → CLI 回读；来源冲突先解决'],
 ['web','Web 与 SFTP','当前工程','Web basePath|CSP basePath|Broker path|Cookie!|SFTP:停用,启用|主机|端口|用户名|密码!|本地目录|远端目录|忽略规则','project-env.json → .mcp.json','复用连接 → 核对传输范围 → 保存配置；保存不触发上传'],
 ['bos','BOS 个人连接','共享个人配置','查询 connection|access_key!|X-Gateway-Upstream-BOS-MCP-TOKEN!|cuser|cgroup|日志 connection|日志 token!|linkProject|timeout','BOS_MCP_CONFIG → personal-config.js','查询与日志凭据分开；保存影响引用同一个人配置的所有工程，返回工程后重新检查'],
 ['embedding','知识提供方与 Key','共享个人配置','默认提供方:company,openai|模型|维度|baseUrl|method:POST,GET|appId|appKey!|apiKey!','KNOWLEDGE_RAG_CONFIG → knowledge-embedding.js','保留现有 Key → 修改提供方 → 预览索引兼容性；模型或维度变化保留旧库并标记不匹配'],
 ['profiles','领域插件配置','当前工程','配置域:工程上下文,治疗表单,需求交付,i18n,远端策略,目录治理|处理方式:保留自定义内容,交给 Agent 补全','各 owner profile / schema','无可靠 schema 的字段保持只读；生成带来源的定向请求，不整体重写 Markdown'],
 ['mcp','MCP 注册与迁移','工程／宿主','服务名称|传输:stdio,HTTP|程序路径|参数|环境变量引用|服务状态:启用,禁用|管理方式:保留现有,受管 IRIS','工程 .mcp.json / owner migration','配置存在 → 程序存在 → 单独确认工具发现 → 正常关闭；认证与业务能力分别验证'],
 ['hosts','客户端适配','工程／用户','客户端:Codex,Claude Code,OpenCode,CodeBuddy,WorkBuddy,Hermes,其他客户端|适配内容:Rules,Skills,Agents,MCP|作用域:当前工程,当前用户|交接:提示词复制,打开客户端,调用接口待验证','sync-runtime-skills.js / sync-runtime-agents.js','生成入口 → 宿主发现 → 调用实测；没有验证接口时使用提示词，不冒充已派发'],
 ['install','首次接入与环境','当前工程','来源:在线能力仓,本地能力包|工程状态:已有业务文件无框架,已有框架,自定义布局|用途:IRIS 开发,界面开发,BOS 协作|客户端:Codex,Claude Code,其他','ai-dev-offline / install-agents.ps1','环境检查 → 安装助手 → 重新检查 → 保留已有文件 → 部署 → 配置 → Agent 补全 → 结果读回'],
 ['update','框架更新与离线包','工程／共享 Root','操作:本地检查,联网获取并预演,本地包导入|更新范围:当前能力根,共享能力根及成员|包 revision|包摘要','update-agents.ps1 / plugin-deploy.js','本地 Check / NoPull → 来源与影响 → 更新一次 → 各模块刷新；dirty/分叉停止，不 reset'],
 ['sources','知识来源与检索','工程／共享','范围:当前工程资料,共享知识|关键词|来源目录|整理方式:只读浏览,Agent 整理请求','knowledge-query.js / 已登记来源','默认本地搜索 → 来源与行号 → 打开原文；不扫描全盘，不将正文复制到工作台数据库'],
 ['vectors','向量生命周期','共享能力／工程','操作:选装索引,构建预览,续建,导出,移除索引|提供方:company,openai|模型|维度|允许外发目录','knowledge-index / owner build cache','预览外发范围 → 单独授权 → 构建 → 中断续建 → complete 检查 → 导出；不删除原资料'],
 ['recovery','草稿、冲突与条件恢复','当前配置域','场景:外部单方修改,不同字段合并,同字段冲突,写文件后DB未提交,未知远端写|处理:重新读取,保留草稿,生成诊断请求','配置基线 / owner 回执','对比原值、草稿和当前来源；同字段冲突仅暂停此域，未知外部写不自动重放'],
 ['backup','备份、迁移与移除','本机工作台','操作:一致性备份,恢复预览,非凭据导出,工程移动重新绑定,移除工作台入口|恢复目标:当前用户当前机器,其他机器或用户','仓外 SQLite / DPAPI / owner 恢复记录','备份 → integrity_check → 恢复预览 → 关闭连接 → 恢复读回；跨用户密文不保证可解密，移除保留框架'],
];

export function installScope({esc,btn,modal,currentName}) {
 let selected;
 const open = key => {
  selected=domains.find(d=>d[0]===key); if(!selected)return;
  const [id,title,scope,fields,source,flow]=selected;
  const controls=fields.split('|').map((spec,i)=>{
   const [label,choices]=spec.split(':'),secret=label.endsWith('!'),name=`scope-${i}`;
   return `<div class="field"><label for="${name}">${esc(label.replace(/!$/,''))}</label>${secret?`<select id="${name}"><option>保留现有值</option><option>替换（正式接通后输入）</option><option>显式清除</option></select><small>原型不收集真实凭据，当前设置状态尚未读取。</small>`:choices?`<select id="${name}">${choices.split(',').map(c=>`<option>${esc(c)}</option>`).join('')}</select>`:`<input id="${name}" placeholder="交互预览，请勿填写真实配置" autocomplete="off">`}</div>`;
  }).join('');
  modal(esc(title),`<p class="note">${esc(currentName())} · ${esc(scope)} · 交互预览，未连接真实读写适配器</p>${scope.includes('共享')?'<p class="note warn">共享影响：所有引用此个人来源的工程可能受影响。正式保存时需显示引用范围，由你确认。</p>':''}<div class="scope-fields">${controls}</div><details><summary>来源与执行边界</summary><p>${esc(source)}</p><p>${esc(flow)}</p></details>`,btn('预览影响',`scope-preview:${id}`,true));
 };
 document.addEventListener('click',async e=>{
  const a=e.target.closest('[data-action]')?.dataset.action||'';
  if(a.startsWith('scope-open:'))open(a.split(':')[1]);
  if(a.startsWith('scope-preview:')&&selected){
   const values=[...document.querySelectorAll('#dialog input,#dialog select')].map(el=>`${el.previousElementSibling.textContent}：${el.value||'未填写 / 保留'}`);
   const d=selected;
   modal('操作影响与下一步',`<p class="note">此为预览，不保存、不调用脚本、不写入浏览器存储。</p><h3>${esc(d[1])} · ${esc(d[2])}</h3><ul>${values.map(v=>`<li>${esc(v)}</li>`).join('')}</ul><p>${esc(d[5])}</p><p class="note warn">真实执行尚待接入 owner 适配器。可复制下方不含表单值的请求，在 Agent 中继续。</p><textarea readonly aria-label="计划能力交接请求">${esc(`工程：${currentName()}\n目标：${d[1]}\n来源：${d[4]}\n步骤：${d[5]}\n先读取当前工程与来源，不回显凭据；说明作用域和差异。未经用户确认不修改共享配置、不执行远端写入。完成后读回验证，报告未完成项。`)}</textarea>`,btn('复制接续请求','scope-copy',true));
  }
  if(a==='scope-copy'){try{await navigator.clipboard.writeText(document.querySelector('[aria-label="计划能力交接请求"]').value);e.target.textContent='已复制，执行后需返回检查'}catch{e.target.textContent='复制不可用，请选中文本手动复制'}}
 });
 return ()=>`<div class="page-heading"><div><h2>完整工作台能力</h2><p>按计划评审所有入口、字段与接续路径。真实适配进度与界面覆盖分开呈现。</p></div></div><section class="hero"><div><h2>配置有归属，操作有下一步</h2><p>从连接、凭据到部署恢复，选择一个目标查看表单及影响。当前新增面板均为交互预览。</p></div></section><div class="grid">${domains.map(([id,title,scope,fields,source])=>`<article class="card"><span class="task-type">${esc(scope)}</span><h3>${esc(title)}</h3><p>${esc(fields.split('|').map(f=>f.split(':')[0].replace('!','')).join(' · '))}</p><small>${esc(source)}</small><div class="actions">${btn('查看与配置',`scope-open:${id}`,true)}<span class="pill warn">交互预览</span></div></article>`).join('')}</div>`;
}
