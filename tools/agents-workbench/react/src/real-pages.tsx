import { useEffect, useState } from "react";
import { ArrowRight, Box, CircleCheck, CircleHelp, ClipboardCopy, FolderCog, Link2, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readGuides, readProject, useResource, type Domain, type ProjectSummary, type SettingsId } from "./api";
import { prepareAgentHandoff, type AgentHandoffSelection } from "./framework-api";
import { GuideList, GuideReader, searchGuides } from "./manual";
import { FrameworkPanel } from "./framework-panel";
import { KnowledgeBuildControls } from "./knowledge-build";
import { KnowledgeSearch } from "./knowledge-search";
import { OverviewHero } from "./overview-hero";
import { DiscoverIrisTools, VerifyConnection } from "./project-owner-actions";
import { PluginsPage } from "./plugins-page";
import { href, type Navigation, type Page } from "./routes";
import { SettingsDialog } from "./settings";
import { VectorIndexControls } from "./vector-index";
import { Details, Empty, GridTable, Notice, PageHeading, Panel, ReadState, SearchField, Status, textareaClass, WorkbenchDialog } from "./ui";

const capabilityGroups = [
  { title: "配置与连接", items: [
    ["工程信息与 IRIS", "预览并保存 IRIS、Web 与既有 SFTP 的跨文件变更。", "config"],
    ["BOS / 知识 Key", "查看共享范围、预览变更、保存并读回。", "connections"],
    ["MCP 服务", "查看注册字段、发现受管工具和核验连接。", "connections"],
  ] },
  { title: "能力与协作", items: [
    ["插件", "源仓目录、工程启用状态、依赖影响和安装接续。", "plugins"],
    ["Agent 客户端", "核对入口是否已生成，准备接入或任务请求。", "clients"],
    ["工程探索", "交给 Agent 核对代码与业务语义。", "tasks"],
  ] },
  { title: "维护与资料", items: [
    ["部署 / 更新 / 恢复", "查看执行与恢复边界，沿框架入口接续。", "tasks"],
    ["知识与向量", "检索本地业务资料和界面参考，查看向量索引。", "knowledge"],
    ["使用手册", "本机运行包内的框架手册原文。", "manual"],
  ] },
  { title: "工程生命周期", items: [
    ["首次接入 / 环境检查", "使用安装助手准备依赖。", "tasks"],
    ["Overlay Root / 模块", "体验共享更新与模块独立配置。", "config"],
    ["升级 / 诊断 / 冲突恢复", "按来源和原回执核对冲突。", "tasks"],
    ["SQLite / 备份 / EXE", "查看工作台现阶段能力和恢复入口。", "tasks"],
  ] },
] satisfies { title: string; items: [string, string, Page][] }[];

function DomainRows({ domains }: { domains: Domain[] }) {
  return <div>{domains.map(domain => <Details key={domain.source}
    title={<span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
      <span className="min-w-0"><strong className="font-medium">{domain.name}</strong>
        <span className="mt-0.5 block break-all text-xs text-muted-foreground">{domain.source}</span></span>
      <span className="flex flex-wrap gap-2"><Status>{domain.scope}</Status>
        <Status emphasis={domain.status === "已真实读取"}>{domain.status}</Status>
        <span className="text-xs leading-5 text-muted-foreground">{domain.fields.length} 字段</span></span>
    </span>}>
    {domain.fields.length ? <GridTable label={domain.name} headers={["字段", "状态", "说明"]}
      rows={domain.fields.map(field => [<code>{field.key}</code>, field.status, field.sensitive ? "凭据仅显示设置状态" : "只读识别"])} />
      : <p className="text-sm text-muted-foreground">{domain.issue ?? domain.status}</p>}
  </Details>)}</div>;
}

function Home({ project, refresh }: { project: ProjectSummary; refresh: () => void }) {
  const stats = [
    { title: "框架", primary: project.hasFramework ? "已发现 .agents" : "未发现 .agents", detail: "本地工程检查", icon: FolderCog },
    { title: "明确启用的插件", primary: project.pluginIssue ? "待核对" : project.plugins.filter(plugin => plugin.status === "enabled").length, detail: "来自当前工程 profile", icon: Box },
    { title: "配置来源", primary: project.domains.length, detail: "工程与共享个人来源", icon: Link2 },
  ];
  const entries = [
    { page: "connections" as const, label: "维护个人连接与 Key", detail: "预览 BOS 和知识提供方的共享影响", icon: Link2 },
    { page: "clients" as const, label: "确认客户端接入", detail: "核对入口生成与宿主发现", icon: Monitor },
  ];
  return <>
    <OverviewHero title="工程总览" description="查看当前工程读取结果，核对现有连接与配置来源。"
      actions={<><Button asChild><a href={href("config")}>核对工程配置</a></Button><Button variant="outline" onClick={refresh}>重新读取</Button></>} />
    <FrameworkPanel onChanged={refresh} />
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      {stats.map(({ title, primary, detail, icon: Icon }) => <section key={title} className="min-w-0 rounded-lg border bg-muted p-4">
        <h3 className="flex items-center gap-2 text-sm text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{title}</h3>
        <p className="mt-3 text-xl font-semibold tabular-nums wrap-anywhere">{primary}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </section>)}
    </div>
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[1.2fr_1fr]">
      <Panel title="接下来">
        <ul className="divide-y">
          {entries.map(({ page, label, detail, icon: Icon }) => <li key={page}>
            <a href={href(page)} className="flex items-center gap-3 rounded-sm px-1 py-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1"><strong className="text-sm font-medium">{label}</strong><span className="mt-1 block text-sm text-muted-foreground">{detail}</span></span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </a>
          </li>)}
        </ul>
      </Panel>
      <Panel title="工作台能力边界">
        <dl className="grid grid-cols-[auto_1fr] gap-3 text-sm">
          <dt className="text-muted-foreground">读取</dt><dd>配置字段、插件 profile、入口和回执</dd>
          <dt className="text-muted-foreground">保存</dt><dd>IRIS 工程连接、BOS 和知识个人配置</dd>
          <dt className="text-muted-foreground">离线框架</dt><dd>Windows standard 工程可在「框架安装与更新」窗口选择并预演离线能力包</dd>
          <dt className="text-muted-foreground">待接入</dt><dd>Overlay 共享更新</dd>
          <dt className="text-muted-foreground">Agent 接续</dt><dd>工程探索与自定义语义判断</dd>
        </dl>
        <Button asChild variant="outline" size="sm" className="mt-4"><a href={href("scope")}>查看完整目录</a></Button>
      </Panel>
    </div>
  </>;
}

function Configuration({ project, edit, handoff }: {
  project: ProjectSummary; edit: (id: SettingsId) => void; handoff: (name: string) => void;
}) {
  const issue = project.configIssue ?? project.domains.find(domain => domain.name === "开发方式")?.issue;
  return <>
    <PageHeading title="工程配置" description="先核对已有来源，再预览需要同步的工程修改。"
      actions={<Button onClick={() => edit("project")}>{issue ? "核对工程配置" : "编辑工程连接"}</Button>} />
    <div className="space-y-4">
      {issue && <Notice error>{issue}</Notice>}
      <Panel title="工程来源" hint={issue ? "可查看已读取的连接和各配置来源。" : "IRIS 同步集中配置、VS Code、MCP、TOML 和受管后端。Web 路径可编辑，SFTP 支持既有入口。"}>
        <DomainRows domains={project.domains.filter(domain => domain.scope === "当前工程")} />
      </Panel>
      <Panel title="领域配置">
        <GridTable label="领域配置" headers={["文件", "识别结果", "操作"]}
          rows={project.profiles.map(profile => [
            <code>{profile.name}</code>, profile.exists ? "存在，语义待核对" : "未发现",
            <Button variant="outline" size="sm" onClick={() => handoff(profile.name)}>核对请求</Button>,
          ])} />
      </Panel>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><a href={href("connections")}>个人共享配置</a></Button>
        <Button asChild variant="ghost"><a href={href("config", "clinic")}>配置交互演示（虚构数据）</a></Button>
      </div>
    </div>
  </>;
}

function useAgentHandoff() {
  const [request, setRequest] = useState<{ name: string; prompt: string }>();
  const [pending, setPending] = useState<AgentHandoffSelection>();
  const [error, setError] = useState("");
  async function prepare(selection: AgentHandoffSelection) {
    setPending(selection); setError("");
    try { setRequest(await prepareAgentHandoff(selection)); }
    catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "binding-changed" ? "工程目录身份已改变，请从启动器重新绑定。" :
        code === "handoff-context-invalid" ? "工程上下文需要核对，请先检查工作区声明。" : "无法准备 Agent 请求，请重新检查工程入口后重试。");
    } finally { setPending(undefined); }
  }
  return { request, pending, error, prepare, close: () => setRequest(undefined) };
}

function Clients({ project, refresh }: { project: ProjectSummary; refresh: () => void }) {
  const { request, pending, error, prepare, close } = useAgentHandoff();
  return <>
    <PageHeading title="Agent 客户端" description="检查项目入口，并将当前工程的接入请求复制到对应客户端。"
      actions={<Button variant="outline" onClick={refresh}>重新检查</Button>} />
    {error && <Notice>{error}</Notice>}
    <GridTable label="Agent 客户端" headers={["客户端", "已发现的工程入口", "状态", "操作"]}
      rows={project.clients.map(client => [
        <strong className="font-medium">{client.name}</strong>,
        client.entries.length ? <ul>{client.entries.map(entry => <li key={entry}><code>{entry}</code></li>)}</ul> : "未发现项目级入口",
        <div className="grid justify-items-start gap-1"><Status emphasis={!!client.entries.length}>{client.entries.length ? "入口已发现" : "未发现入口"}</Status>
          <small className="text-muted-foreground">{client.status}</small></div>,
        <Button variant="outline" size="sm" disabled={!!pending} onClick={() => prepare({ host: client.id })}>
          {pending && "host" in pending && pending.host === client.id ? "正在准备…" : "准备接入请求"}
        </Button>,
      ])} />
    <Panel title="接入检查顺序" className="mt-4">
      <ol className="grid list-decimal gap-3 pl-5 text-sm text-muted-foreground md:grid-cols-2">
        <li>确认工程入口与宿主</li><li>按框架脚本适配规则、Skills、Agents</li>
        <li>重载宿主并检查发现</li><li>完成真实往返后确认调用可用</li>
      </ol>
    </Panel>
    {request && <HandoffDialog title={`核对 ${request.name} 接入`} prompt={request.prompt} onClose={close} />}
  </>;
}

function Connections({ project, edit, handoff }: { project: ProjectSummary; handoff:(name:string)=>void; edit: (id: SettingsId) => void }) {
  const issue = project.configIssue ?? project.domains.find(domain => domain.name === "开发方式")?.issue;
  const sources = [
    { id: "bos", env: "BOS_MCP_CONFIG", title: "BOS", hint: "需求查询和开发日志", action: "编辑连接与凭据" },
    { id: "knowledge", env: "KNOWLEDGE_RAG_CONFIG", title: "知识提供方", hint: "公司网关和 OpenAI", action: "编辑提供方与 Key" },
  ] as const;
  return <>
    <PageHeading title="MCP 与连接" description="维护个人连接档案，核对工程服务和注册来源。" />
    <div className="space-y-4">
      <Panel title="个人连接档案" hint="保存前核对共享影响。">
        <div className="grid gap-4 md:grid-cols-2">
          {sources.map(source => <section className="min-w-0 rounded-md border bg-background p-4" key={source.id}>
            <div className="flex flex-wrap justify-between gap-2"><h4 className="font-medium">{source.title}</h4>
              <Status>{project.domains.find(domain => domain.source === source.env)?.status ?? "来源未知"}</Status></div>
            <p className="mt-1 text-sm text-muted-foreground">{source.hint}</p>
            <p className="mt-2 break-all text-xs text-muted-foreground">{source.env}</p>
            <Button className="mt-4" variant="outline" onClick={() => edit(source.id)}>{source.action}</Button>
          </section>)}
        </div>
      </Panel>
      <Panel title="工程连接与 MCP" hint="分别核对注册字段、本机受管工具和所选开发库的连接。"
        actions={<Button asChild variant="outline" size="sm"><a href={href("config")}>查看工程配置</a></Button>}>
        {issue ? <Notice error>{issue}</Notice> : <div className="space-y-3">
          <VerifyConnection handoff={()=>handoff("在当前工程核验所选 IRIS 开发库，读取实际连接及命名空间并回查核验回执")} />
          {project.hasFramework && <DiscoverIrisTools handoff={()=>handoff("在当前工程核对 MCP 注册、启动程序和宿主实际发现的工具，保留自定义入口与禁用状态")} />}
        </div>}
        <DomainRows domains={project.domains.filter(domain => /MCP|IRIS/.test(domain.name) && domain.scope === "当前工程")} />
      </Panel>
    </div>
  </>;
}

function Knowledge({ project, nav, handoff }: { project: ProjectSummary; nav: Navigation; handoff: (name: string) => void }) {
  const guides = useResource(readGuides);
  const query = nav.route.params.get("q") ?? "";
  return <>
    <PageHeading title="知识与向量" description="搜索本地知识和手册，查看已发现的向量索引。"
      actions={<Button asChild variant="outline"><a href={href("connections", null, { edit: "knowledge" })}>模型与 Key</a></Button>} />
    <div className="mb-4"><KnowledgeSearch /></div>
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[1.1fr_1fr]">
      <Panel title="本地资料目录">
        <SearchField label="搜索资料标题" placeholder="搜索手册标题" value={query} onChange={q => nav.replace({ q })} />
        <div className="mt-3">{guides.data ? <GuideList guides={searchGuides(guides.data, query)} nav={nav} />
          : <ReadState label={guides.error ? "手册目录加载失败" : "正在读取资料…"} error={guides.error} retry={guides.retry} />}</div>
      </Panel>
      <Panel title="向量索引">
        <VectorIndexControls />
        <div className="mt-5 space-y-2">
          <h4 className="text-sm font-medium">本地构建缓存</h4>
          <GridTable label="本地构建缓存" headers={["文件", "识别结果"]} rows={project.indexes.map(index =>
            [<code>{index.name}</code>, index.exists ? `已发现 · ${Math.round((index.bytes ?? 0) / 1024)} KB` : "未发现索引文件"])} />
        </div>
        <div className="mt-5"><KnowledgeBuildControls /></div>
        <Button className="mt-4" variant="outline" onClick={() => handoff("知识索引核验与维护者导出")}>准备索引维护请求</Button>
      </Panel>
    </div>
  </>;
}

function CapabilityDirectory() {
  return <>
    <PageHeading title="能力目录" description="按目标找到工作台入口和 Agent 接续方式。" />
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
      {capabilityGroups.map(group => <Panel key={group.title} title={group.title}>
        <ul className="divide-y">{group.items.map(([title, detail, page]) => <li key={title}>
          <a className="flex items-center gap-3 rounded-sm px-1 py-2.5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            href={title.startsWith("Overlay") ? href("modules", "root") : href(page)}>
            <span className="min-w-0 flex-1"><strong className="text-sm font-medium">{title}</strong>
              <span className="mt-1 block text-sm text-muted-foreground">{detail}</span></span>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </a>
        </li>)}</ul>
      </Panel>)}
    </div>
  </>;
}

const receiptStatus: Record<string, string> = {
  applied: "已保存并读回", prepared: "写入未完成", "reverted-after-failure": "失败后已恢复",
  "reverted-after-interruption": "中断后已恢复", "rolled-back": "已回滚",
};
const localTime = (iso: string) => new Date(iso).toLocaleString("zh-CN", { hour12: false });

function Tasks({ project, activity, handoff, refresh }: {
  project: ProjectSummary; activity: string[]; handoff: (title: string) => void; refresh: () => void;
}) {
  const { request, pending, error, prepare, close } = useAgentHandoff();
  const receipts = project.receipts.slice().sort((a, b) => b.updated.localeCompare(a.updated));
  return <>
    <PageHeading title="任务与恢复" description="核对工程保存回执，或准备诊断与恢复请求。"
      actions={<><Button disabled={!!pending} onClick={() => prepare({ purpose: "project-check" })}>
        {pending ? "正在准备…" : "准备工程检查请求"}
      </Button><Button variant="outline" onClick={refresh}>重新读取</Button></>} />
    {error && <Notice error>{error}</Notice>}
    <div className="space-y-4">
      <Panel title="工程保存回执">
        {receipts.length ? <GridTable label="工程保存回执" headers={["回执", "状态", "涉及文件", "更新时间"]}
          rows={receipts.map(receipt => [
            <code>{receipt.id}</code>, <Status emphasis={receipt.state === "applied"}>{receiptStatus[receipt.state] ?? receipt.state}</Status>,
            receipt.files, localTime(receipt.updated),
          ])} /> : <p className="text-sm text-muted-foreground">还没有工程保存回执。</p>}
      </Panel>
      {activity.length ? <Panel title="本次会话">
        <ul className="divide-y">{activity.map((line, index) => <li className="flex items-center gap-2 py-2 text-sm" key={index}>
          <CircleCheck aria-hidden="true" className="size-4 text-muted-foreground" />{line}
        </li>)}</ul>
      </Panel> : <Empty title="本次打开后暂无新操作">
        <Button asChild variant="outline"><a href={href("connections")}>管理连接</a></Button>
      </Empty>}
      <Panel title="恢复边界" hint="来源变化时重新读取后编辑。数据库备份和跨机恢复待接入。"
        actions={<Button variant="outline" onClick={() => handoff("恢复诊断")}>恢复诊断请求</Button>} />
    </div>
    {request && <HandoffDialog title={request.name} prompt={request.prompt} onClose={close} />}
  </>;
}

export function HandoffDialog({ title, prompt, onClose }: { title: string; prompt: string; onClose: () => void }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setStatus("已复制，等待客户端执行。"); }
    catch { setStatus("剪贴板不可用，可选中文本手动复制。"); }
  }
  return <WorkbenchDialog title="接续到 Agent" description={title} onClose={onClose}
    actions={<Button onClick={copy}><ClipboardCopy aria-hidden="true" />复制请求</Button>}>
    <textarea className={textareaClass} aria-label="接续请求" value={prompt} rows={8} readOnly />
    {status && <Notice>{status}</Notice>}
  </WorkbenchDialog>;
}

function ManualPage({ nav, handoff }: { nav: Navigation; handoff: (title: string) => void }) {
  const guides = useResource(readGuides);
  return guides.data ? <GuideReader guides={guides.data} nav={nav} onHandoff={handoff} />
    : <><PageHeading title="使用手册" description="查看随工作台提供的本地手册。" />
      <ReadState label={guides.error ? "无法加载手册目录" : "正在读取手册目录…"} error={guides.error} retry={guides.retry} /></>;
}

export function RealPages({ nav, onProject }: { nav: Navigation; onProject: (name: string) => void }) {
  const project = useResource(readProject);
  if (!project.data) return <>
    <PageHeading title="工程工作台" description="从启动时绑定的工程读取配置和状态。" />
    <ReadState label={project.error ? "无法读取绑定工程" : "正在读取绑定工程…"} error={project.error} retry={project.retry} />
    {project.error && <Button asChild variant="outline" className="mt-4"><a href={href("scope", "clinic")}>打开本机演示</a></Button>}
  </>;
  return <RealContent project={project.data} nav={nav} onProject={onProject} refresh={project.refresh} />;
}

function RealContent({ project, nav, refresh, onProject }: {
  project: ProjectSummary; nav: Navigation; refresh: () => void; onProject: (name: string) => void;
}) {
  const [activity, setActivity] = useState<string[]>([]);
  const [handoff, setHandoff] = useState("");
  useEffect(() => onProject(project.name), [project.name, onProject]);
  useEffect(() => setHandoff(""), [nav.route.page]);
  function edit(id: SettingsId) { nav.replace({ edit: id }); }
  const editId = nav.route.params.get("edit");
  const validEditor = nav.route.page === "config" && editId === "project" || nav.route.page === "connections" && (editId === "bos" || editId === "knowledge");
  let content;
  switch (nav.route.page) {
    case "config": content = <Configuration project={project} edit={edit} handoff={setHandoff} />; break;
    case "clients": content = <Clients project={project} refresh={refresh} />; break;
    case "connections": content = <Connections project={project} edit={edit} handoff={setHandoff} />; break;
    case "knowledge": content = <Knowledge project={project} nav={nav} handoff={setHandoff} />; break;
    case "manual": content = <ManualPage nav={nav} handoff={setHandoff} />; break;
    case "scope": content = <CapabilityDirectory />; break;
    case "tasks": content = <Tasks project={project} activity={activity} handoff={setHandoff} refresh={refresh} />; break;
    case "plugins": content = <PluginsPage project={project} nav={nav} onHandoff={setHandoff} refresh={refresh} />; break;
    default: content = <Home project={project} refresh={refresh} />;
  }
  return <>{content}
    {validEditor && <SettingsDialog key={editId} id={editId as SettingsId} handoff={()=>{nav.replace({edit:undefined});setHandoff("核验当前工程所选 IRIS 开发库及命名空间，读回实际核验结果");}} onClose={() => nav.replace({ edit: undefined })}
      onSaved={id => { setActivity(lines => [id === "project" ? "工程配置已保存并读回" : "个人配置已保存并读回", ...lines]); refresh(); }} />}
    {editId && !validEditor && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
      <CircleHelp aria-hidden="true" className="size-4" />此页面没有对应配置编辑入口。
    </p>}
    {handoff && <HandoffDialog key={handoff} title={handoff} onClose={() => setHandoff("")}
      prompt={`工程：${project.name}\n目标：${handoff}\n先读取当前工程 AGENTS.md 与对应 owner 入口，核对来源、操作边界和影响。保护已有配置及凭据。涉及共享配置、远端写入或外发内容时，先与用户确认。完成后读回实际结果，列出待验证事项。`} />}
  </>;
}
