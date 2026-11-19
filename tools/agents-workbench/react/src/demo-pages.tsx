import { useEffect, useState } from "react";
import { ArrowRight, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readCatalog, readGuides, useResource, type Catalog } from "./api";
import { DemoActions } from "./demo-actions";
import { DemoConfig } from "./demo-config";
import { activeConnection, alias, demoName, demoState, demoTask, libraries, projects, save, type DemoProject } from "./demo-model";
import { DemoScope, DemoScopeDialog, ScopeActions } from "./demo-scope";
import { GuideList, GuideReader, searchGuides } from "./manual";
import { OverviewHero } from "./overview-hero";
import { filterPlugins, pluginName } from "../../prototype/plugin-directory.mjs";
import { href, type DemoId, type Navigation } from "./routes";
import { Details, Empty, GridTable, Notice, PageHeading, Panel, ReadState, SearchField, selectClass, Status } from "./ui";

export type OpenDemo = (view: string, target?: string) => void;

const clientNames = ["Codex", "Claude Code", "OpenCode", "CodeBuddy", "WorkBuddy", "Hermes", "其他客户端"];
const scopeLinks = {
  home: ["install", "update"], clients: ["hosts"], connections: ["iris", "web", "bos", "embedding", "mcp"],
  knowledge: ["sources", "embedding", "vectors"], tasks: ["recovery", "backup"],
};

function DemoHome({ id, project, nav, open, redraw, newTask }: {
  id: DemoId; project: DemoProject; nav: Navigation; open: OpenDemo; redraw: () => void; newTask: (title: string, type?: string) => void;
}) {
  if (!project.installed) return <Wizard id={id} project={project} open={open} redraw={redraw} newTask={newTask} />;
  const latest = project.tasks.find(task => task.status !== "已完成");
  const items = [
    ["管理能力", "按需要接入能力与依赖", "plugins"],
    ["查看连接", "确认当前开发库与连接状态", "connections"],
    ["编辑配置", "按工程或模块保存配置", "config"],
  ] as const;
  return <>
    <OverviewHero title="项目总览" description={latest ? `${latest.title} · ${latest.status}` : "查看演示工程的当前状态和可用能力。"}
      actions={<><Button onClick={() => latest ? nav.go("tasks", { view: "task", target: latest.id }) : open("start")}>{latest ? "继续任务" : "开始开发"}</Button>
        <Button variant="outline" onClick={() => open("check")}>检查当前状态</Button></>} />
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Panel title="常用入口" hint={`${project.client} · ${project.mode === "offline" ? "离线开发" : "连接开发"}`}>
        <ul className="divide-y">{items.map(([label, description, page]) => <li key={page}>
          <a className="flex items-center justify-between gap-2 rounded-sm py-2.5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" href={href(page, id)}>
            <span><strong className="text-sm font-medium">{label}</strong><span className="mt-1 block text-sm text-muted-foreground">{description}</span></span>
            <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" />
          </a>
        </li>)}</ul>
      </Panel>
      <Panel title="当前工程" hint={projects[id].parent ? "共享框架由 Root 维护，当前模块配置独立。" : "更新前可核对影响范围。"}
        actions={<Button variant="outline" onClick={() => open("update")}>预览更新</Button>}>
        <GridTable label="当前工程" headers={["能力", "演示状态"]} rows={[
          ["IRIS 开发", project.plugins.iris ? "已启用 · 当前工程配置" : "待接入"],
          [project.client, project.clients[project.client] || "未接入"],
          ["框架版本", project.updated ? "已更新到演示目标版本" : "演示基线 · Node 24.22.3"],
        ]} />
      </Panel>
      <Panel title="最近任务" className="xl:col-span-2"
        actions={<Button asChild size="sm" variant="ghost"><a href={href("tasks", id)}>查看全部</a></Button>}>
        {project.tasks.length ? <GridTable label="最近任务" headers={["任务", "类型", "状态"]}
          rows={project.tasks.slice(0, 3).map(item => [item.title, item.type, item.status])} /> : <p className="text-sm text-muted-foreground">还没有操作记录。</p>}
      </Panel>
    </div>
    <div className="mt-4"><ScopeActions ids={scopeLinks.home} nav={nav} /></div>
  </>;
}

function Wizard({ id, project, open, redraw, newTask }: {
  id: DemoId; project: DemoProject; open: OpenDemo; redraw: () => void; newTask: (title: string, type?: string) => void;
}) {
  const steps = ["环境检查", "用途与客户端", "部署摘要", "必要配置", "接续与验证"];
  const phase = Math.max(0, Math.min(4, project.wizard));
  const connection = activeConnection(project);
  function setStep(value: number) { project.wizard = value; save(); redraw(); }
  return <>
    <OverviewHero title="接入当前工程" description="从已有演示工程开始，直至生成 Agent 接续任务。" />
    <ol className="mb-4 flex flex-wrap gap-2 text-sm">
      {steps.map((step, index) => <li key={step} aria-current={index === phase ? "step" : undefined}
        className={`rounded-md border px-3 py-1.5 ${index === phase ? "bg-secondary font-medium" : "text-muted-foreground"}`}>{index + 1} {step}</li>)}
    </ol>
    <Panel title={steps[phase]} className="max-w-3xl">
      {phase === 0 && <div className="space-y-3">
        <p className="text-sm text-muted-foreground">保留已有 AGENTS.md、源码与编辑器配置。</p>
        <Notice>{project.environment ? "演示环境已准备" : "待准备 Node 24.22.3 / Git"}</Notice>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => open("environment")}>查看安装指引</Button>
          {project.environment ? <Button onClick={() => setStep(1)}>选择用途</Button>
            : <Button onClick={() => { project.environment = true; save(); redraw(); }}>模拟已安装并重新检查</Button>}</div>
      </div>}
      {phase === 1 && <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        project.purpose = String(fields.get("purpose")); project.client = String(fields.get("client")); setStep(2);
      }}>
        <label className="grid gap-2 text-sm">这次准备做什么？
          <select className={selectClass} name="purpose" defaultValue={project.purpose}>{["IRIS 开发", "界面改造", "BOS 需求协作"].map(value => <option key={value}>{value}</option>)}</select>
        </label>
        <label className="grid gap-2 text-sm">使用的 Agent 客户端
          <select className={selectClass} name="client" defaultValue={project.client}>{["Codex", "Claude Code", "其他客户端"].map(value => <option key={value}>{value}</option>)}</select>
        </label>
        <Button type="submit">查看部署摘要</Button>
      </form>}
      {phase === 2 && <div className="space-y-4">
        <p>为 {demoName(id)} 接入 {project.purpose ?? "IRIS 开发"}</p>
        <GridTable label="部署摘要" headers={["项目", "处理方式"]} rows={[
          ["来源", "演示能力包"], ["保留", "已有 AGENTS.md、源码、MCP 自定义字段"], ["客户端", project.client],
        ]} />
        <Button onClick={() => open("deploy")}>模拟部署并继续</Button>
      </div>}
      {phase === 3 && <form className="grid gap-4 sm:grid-cols-2" onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const projectName = String(fields.get("name")).trim(), host = String(fields.get("host")).trim();
        if (!projectName || !host) {
          const field = event.currentTarget.elements.namedItem(projectName ? "host" : "name") as HTMLInputElement;
          field.setCustomValidity("请填写非空白的演示值。"); field.reportValidity(); return;
        }
        project.name = projectName; project.mode = String(fields.get("mode"));
        Object.assign(connection, { host, port: Number(fields.get("port")) }); setStep(4);
      }}>
        <label className="grid gap-2 text-sm">项目显示名称<Input name="name" required defaultValue={demoName(id)} onInput={event => event.currentTarget.setCustomValidity("")} /></label>
        <label className="grid gap-2 text-sm">开发方式
          <select name="mode" className={selectClass} defaultValue={project.mode}><option value="connected">连接开发</option><option value="offline">离线开发</option></select>
        </label>
        <label className="grid gap-2 text-sm">演示连接地址<Input name="host" required defaultValue={connection.host} onInput={event => event.currentTarget.setCustomValidity("")} /></label>
        <label className="grid gap-2 text-sm">Web 端口<Input name="port" type="number" required min={1} max={65535} defaultValue={connection.port} /></label>
        <Button type="submit" className="w-fit sm:col-span-2">保存演示配置并继续</Button>
      </form>}
      {phase === 4 && <div className="space-y-4">
        <p className="text-sm text-muted-foreground">本地步骤已就绪，工程事实需要 Agent 判断。</p>
        <Button onClick={() => {
          project.installed = true; project.plugins.iris = true; project.clients[project.client] = "入口已生成";
          save(); newTask("补全首次接入的工程事实");
        }}>创建初始化接续任务</Button>
      </div>}
      {(phase === 1 || phase === 2) && <Button variant="ghost" size="sm" className="mt-3" onClick={() => setStep(phase - 1)}>上一步</Button>}
    </Panel>
  </>;
}

function DemoPlugins({ project, nav, catalog, open }: { project: DemoProject; nav: Navigation; catalog: Catalog; open: OpenDemo }) {
  const q = nav.route.params.get("q") ?? "";
  const group = nav.route.params.get("group") ?? "all";
  const business = catalog.plugins.filter(plugin => !catalog.basePlugins.includes(plugin.name));
  const groupFilter = catalog.groups.find(item => item.id === group);
  const visible = filterPlugins(business, q).filter(plugin => !groupFilter || groupFilter.plugins.includes(plugin.name));
  return <>
    <PageHeading title="能力与插件" description="源仓清单提供版本和依赖。启用和安装状态来自当前演示工程。" />
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-72"><SearchField label="搜索插件" value={q} onChange={value => nav.replace({ q: value })} /></div>
      <select className={selectClass} aria-label="插件分类" value={groupFilter?.id ?? "all"} onChange={event => nav.replace({ group: event.target.value })}>
        <option value="all">全部业务能力</option>{catalog.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <span role="status" className="ml-auto text-sm text-muted-foreground">显示 {visible.length} 项</span>
    </div>
    {visible.length ? <GridTable label="演示插件目录" headers={["能力", "状态", "版本", "操作"]} rows={visible.map(plugin => {
      const key = alias(plugin.name);
      const enabled = project.plugins[key], installed = project.available?.includes(key);
      return [
        <Details title={<span>{pluginName(plugin)}<small className="block text-xs text-muted-foreground">{plugin.name}</small></span>}>
          <p className="text-muted-foreground">{plugin.description}</p>
        </Details>,
        <Status emphasis={enabled}>{enabled ? "已启用" : installed ? "已安装待配置" : "未安装"}</Status>,
        <span className="whitespace-nowrap tabular-nums">{plugin.version}</span>,
        <div className="flex flex-wrap gap-1"><Button variant="outline" size="sm" onClick={() => open("plugin", plugin.name)}>{enabled ? "停用" : installed ? "继续配置" : "接入此能力"}</Button>
          <Button variant="ghost" size="sm" onClick={() => open("dependency", plugin.name)}>依赖与来源</Button></div>,
      ];
    })} /> : <Empty title="没有匹配的插件"><Button variant="outline" onClick={() => nav.replace({ q: undefined, group: undefined })}>清除筛选</Button></Empty>}
    <div className="mt-4 space-y-1">
      <Details title={`框架内置 · ${catalog.basePlugins.length} 项（固定保留）`}>
        <ul className="list-disc pl-5 text-sm">{catalog.plugins.filter(plugin => catalog.basePlugins.includes(plugin.name)).map(plugin =>
          <li key={plugin.name}>{pluginName(plugin)} · {plugin.version}</li>)}</ul>
      </Details>
      {catalog.unavailable.length > 0 && <Details title={`暂不可用目录 · ${catalog.unavailable.length} 项`}>
        <ul className="list-disc pl-5 text-sm">{catalog.unavailable.map(name => <li key={name}>{name} · 缺少插件清单</li>)}</ul>
      </Details>}
    </div>
  </>;
}

function DemoClients({ project, nav, open, redraw, newTask }: {
  project: DemoProject; nav: Navigation; open: OpenDemo; redraw: () => void; newTask: (title: string, type?: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  return <>
    <PageHeading title="Agent 客户端" description="模拟生成工程入口、核对宿主发现和任务接续。" />
    {feedback && <div className="mb-4"><Notice>{feedback}</Notice></div>}
    <GridTable label="演示 Agent 客户端" headers={["客户端", "调用方式", "工程状态", "操作"]}
      rows={clientNames.map((name, index) => [
        <strong>{name}</strong>, index === 0 ? "模拟任务调用" : index === 1 ? "打开与提示词" : "提示词接续",
        project.clients[name] || "尚未生成工程入口",
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" onClick={() => {
            project.clients[name] = "入口已生成，宿主待发现"; project.client = name;
            save(); redraw(); setFeedback("模拟入口已生成。");
          }}>适配工程入口</Button>
          <Button variant="outline" size="sm" onClick={() => {
            if (!project.clients[name]) { setFeedback("请先适配工程入口。"); return; }
            project.clients[name] = "模拟宿主已发现，调用待验证"; save(); redraw(); setFeedback("");
          }}>检查发现</Button>
          <Button variant="ghost" size="sm" onClick={() => { project.client = name; save(); newTask("核对工程配置与开发准备"); }}>开始任务</Button>
        </div>,
      ])} />
    <Panel className="mt-4" title="用户级设置" hint="作用域可能覆盖多个工程。"
      actions={<Button variant="outline" onClick={() => open("user-scope")}>查看影响</Button>} />
    <div className="mt-4"><ScopeActions ids={scopeLinks.clients} nav={nav} /></div>
  </>;
}

function DemoConnections({ id, project, nav, open, redraw }: {
  id: DemoId; project: DemoProject; nav: Navigation; open: OpenDemo; redraw: () => void;
}) {
  const connection = activeConnection(project);
  const library = libraries[project.activeLibrary];
  return <>
    <PageHeading title="MCP 与连接" description="查看所选开发库、凭据意图和模拟连接状态。"
      actions={<Button asChild variant="outline"><a href={href("config", id)}>修改连接</a></Button>} />
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      <Panel title={`当前开发库 · ${library}`} hint={projects[id].parent ? "当前模块" : "当前工程"}>
        <GridTable label="连接档案" headers={["字段", "状态"]} rows={[
          ["地址", `${connection.host}:${connection.port}`],
          ["凭据", <div className="flex flex-wrap items-center gap-2">{connection.secret ? "已设置（虚构）" : "未设置"}
            <Button variant="outline" size="sm" onClick={() => open("secret")}>凭据操作</Button></div>],
          ["连接验证", project.tested ? "模拟已连到" + library : project.needsReconnect ? "客户端待重连核验" : "未测试"],
        ]} />
        <Button className="mt-3" onClick={() => {
          project.tested = true; project.needsReconnect = false;
          demoTask(id, "检查演示连接", "工具执行", "已完成"); redraw();
        }}>模拟连接检查</Button>
      </Panel>
      <Panel title="MCP 服务" hint="工具发现与认证分别核对。">
        <GridTable label="演示 MCP 服务" headers={["服务", "状态"]} rows={[
          ["iris-agentic-dev", "引用 " + library], ["程序存在性", "模拟文件检查通过"], ["宿主加载", "待验证"],
        ]} />
        <Button asChild className="mt-3" variant="outline"><a href={href("clients", id)}>前往客户端</a></Button>
      </Panel>
    </div>
    <div className="mt-4"><ScopeActions ids={scopeLinks.connections} nav={nav} /></div>
  </>;
}

function DemoKnowledge({ id, project, nav, open }: { id: DemoId; project: DemoProject; nav: Navigation; open: OpenDemo }) {
  const guides = useResource(readGuides);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<string>();
  const filtered = searched === undefined ? guides.data : searchGuides(guides.data ?? [], searched);
  return <>
    <PageHeading title="知识与向量" description="先检索本地资料，再核对演示索引的构建状态。" />
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      <Panel title={id === "root" ? "共享知识" : "当前工程资料"}>
        <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setSearched(query); }}>
          <div className="min-w-0 flex-1"><SearchField label="知识检索" placeholder="搜索连接、插件或接入方法" value={query} onChange={setQuery} /></div>
          <Button type="submit" variant="outline">检索</Button>
          {searched !== undefined && <Button type="button" variant="ghost" onClick={() => { setQuery(""); setSearched(undefined); }}>查看全部</Button>}
        </form>
        {filtered ? <GuideList guides={filtered} nav={nav} /> : <ReadState label="正在读取资料…" error={guides.error} retry={guides.retry} />}
      </Panel>
      <Panel title="向量索引" hint="演示资料 · 模拟提供方">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <strong className="text-xl tabular-nums">{project.vector}%</strong>
          <Status>{project.vector === 100 ? "模拟索引完整" : project.vector ? "已中断，可续建" : "尚未构建"}</Status>
        </div>
        <progress className="w-full accent-primary" max={100} value={project.vector} aria-label="模拟索引进度" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => open("vector-preview")}>预览构建</Button>
          {project.vector > 0 && project.vector < 100 && <Button onClick={() => open("vector-resume")}>继续构建</Button>}
          {project.vector === 100 && <Button variant="outline" onClick={() => open("vector-export")}>查看导出摘要</Button>}
        </div>
      </Panel>
    </div>
    <div className="mt-4"><ScopeActions ids={scopeLinks.knowledge} nav={nav} /></div>
  </>;
}

function DemoManual({ nav, newTask }: { nav: Navigation; newTask: (title: string) => void }) {
  const guides = useResource(readGuides);
  return guides.data ? <GuideReader nav={nav} guides={guides.data} onHandoff={newTask} /> : <>
    <PageHeading title="使用手册" description="查看本机运行包中的原文。" />
    <ReadState label="正在读取手册目录…" error={guides.error} retry={guides.retry} />
  </>;
}

function DemoTasks({ project, open, nav }: { project: DemoProject; open: OpenDemo; nav: Navigation }) {
  return <>
    <PageHeading title="任务与恢复" description="查看演示任务、交接和读回结果。"
      actions={<Button onClick={() => open("start")}>新建演示任务</Button>} />
    {project.tasks.length ? <GridTable label="演示任务" headers={["任务", "执行方式", "状态", "操作"]}
      rows={project.tasks.map(item => [
        <span><strong className="font-medium">{item.title}</strong><small className="block text-muted-foreground">{item.id.slice(0, 8)}</small></span>,
        item.type, <Status emphasis={item.status === "已完成"}>{item.status}</Status>,
        <Button variant="outline" size="sm" onClick={() => open("task", item.id)}>查看与接续</Button>,
      ])} /> : <Empty title="暂无任务">开始开发或配置能力后，任务会出现在这里。</Empty>}
    <div className="mt-4"><ScopeActions ids={scopeLinks.tasks} nav={nav} /></div>
  </>;
}

function DemoModules({ open }: { open: OpenDemo }) {
  return <>
    <PageHeading title="模块" description="更新共享框架，分别检查各模块的刷新结果。"
      actions={<Button onClick={() => open("update")}>预览共享更新</Button>} />
    <GridTable label="共享工作区模块" headers={["模块", "工程位置", "刷新状态", "操作"]} rows={(["dental", "nursing"] as const).map(id => [
      <strong>{demoName(id)}</strong>, <code>{projects[id].path}</code>,
      <Status emphasis={demoState(id).updated}>{demoState(id).updated ? "已刷新" : "待统一更新"}</Status>,
      <Button asChild variant="outline" size="sm"><a href={href("home", id)} aria-label={`进入模块：${demoName(id)}`}>进入模块</a></Button>,
    ])} />
    <div className="mt-4"><Notice>共享更新执行一次。模块配置和失败重试各自处理。</Notice></div>
  </>;
}

export function DemoPages({ id, nav, onProject }: { id: DemoId; nav: Navigation; onProject: (name: string) => void }) {
  const project = demoState(id);
  const [, setRevision] = useState(0);
  const [feedback, setFeedback] = useState("");
  const redraw = () => setRevision(value => value + 1);
  const view = nav.route.params.get("view");
  const target = nav.route.params.get("target");
  const domain = nav.route.params.get("domain");
  const catalog = useResource(readCatalog, nav.route.page === "plugins" || view === "plugin" || view === "dependency");
  const displayName = demoName(id);
  useEffect(() => onProject(displayName), [displayName, onProject]);
  useEffect(() => setFeedback(""), [nav.route.page]);
  const open: OpenDemo = (view, target) => nav.replace({ view, target, domain: undefined });
  const close = () => nav.replace({ view: undefined, target: undefined, domain: undefined });

  function newTask(title: string, type?: string) {
    const item = demoTask(id, title, type || (project.client === "Codex" ? "Agent 执行" : "提示词交接"), "待接续");
    nav.go("tasks", { view: "task", target: item.id });
    redraw();
  }

  let content;
  switch (nav.route.page) {
    case "scope": content = <DemoScope nav={nav} />; break;
    case "config": content = <DemoConfig id={id} nav={nav} redraw={redraw} start={() => open("start")} diagnose={() => newTask("配置冲突分析")} />; break;
    case "clients": content = <DemoClients project={project} nav={nav} open={open} redraw={redraw} newTask={newTask} />; break;
    case "connections": content = <DemoConnections id={id} project={project} nav={nav} open={open} redraw={redraw} />; break;
    case "knowledge": content = <DemoKnowledge id={id} project={project} nav={nav} open={open} />; break;
    case "manual": content = <DemoManual nav={nav} newTask={newTask} />; break;
    case "tasks": content = <DemoTasks project={project} open={open} nav={nav} />; break;
    case "modules": content = <DemoModules open={open} />; break;
    case "plugins": content = catalog.data ? <DemoPlugins project={project} nav={nav} open={open} catalog={catalog.data} />
      : <><PageHeading title="能力与插件" description="读取本机插件清单。" /><ReadState label={catalog.error ? "无法读取插件目录" : "正在读取目录…"} error={catalog.error} retry={catalog.retry} /></>; break;
    default: content = <DemoHome id={id} project={project} nav={nav} open={open} redraw={redraw} newTask={newTask} />;
  }
  return <>{feedback && <div className="mb-4"><Notice><CircleCheck aria-hidden="true" className="mr-1 inline size-4" />{feedback}</Notice></div>}
    {content}
    {domain ? <DemoScopeDialog key={domain} id={domain} project={displayName} onClose={close} />
      : view && <DemoActions key={`${view}:${target}:${id}`} id={id} view={view} target={target} catalog={catalog.data}
        nav={nav} open={open} close={close} redraw={redraw} setFeedback={setFeedback} newTask={newTask} />}
  </>;
}
