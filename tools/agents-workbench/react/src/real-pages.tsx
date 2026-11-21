import { useEffect, useRef, useState } from "react";
import { ArrowRight, Box, CircleCheck, CircleHelp, ClipboardCopy, FolderCog, Link2, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readGuides, readProject, useResource, type Domain, type ProjectReceipt, type ProjectSummary, type SettingsId } from "./api";
import { exportProjectState, prepareAgentHandoff, recoverProjectConfiguration, type AgentHandoffSelection, type AgentTaskSelection, type ProjectRecoveryIntent } from "./framework-api";
import { GuideList, GuideReader, searchGuides } from "./manual";
import { FrameworkPanel } from "./framework-panel";
import { KnowledgeBuildControls } from "./knowledge-build";
import { KnowledgeSearch } from "./knowledge-search";
import { OverviewHero } from "./overview-hero";
import { DiscoverIrisTools, VerifyConnection } from "./project-owner-actions";
import { PluginsPage } from "./plugins-page";
import { href, type Navigation, type Page } from "./routes";
import { SettingsDialog } from "./settings";
import { ManagedConfiguration } from "./managed-configuration";
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
    ["部署与更新", "首装、检查当前框架，或复制更新提示词。", "home"],
    ["中断恢复", "查看工程保存回执并恢复可确认的部分写入。", "tasks"],
    ["知识与向量", "检索本地业务资料和界面参考，查看向量索引。", "knowledge"],
    ["使用手册", "本机运行包内的框架手册原文。", "manual"],
  ] },
  { title: "工程生命周期", items: [
    ["首次接入", "将基础框架安装到当前工程。", "home"],
    ["共享工作区", "查看共享能力根和已登记成员。", "home"],
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
  const { request, pending, error, prepare, close } = useAgentHandoff();
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
      actions={<Button asChild><a href={href("config")}>核对工程配置</a></Button>} />
    <FrameworkPanel onChanged={refresh} projectHandoff={<>
      <Button variant="outline" disabled={!!pending} onClick={() => prepare({ purpose: "project-check" })}>
        {pending ? "正在准备…" : "准备工程检查请求"}
      </Button>
      {error && <Notice error>{error}</Notice>}
    </>} />
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      {stats.map(({ title, primary, detail, icon: Icon }) => <section key={title} className="min-w-0 rounded-lg border bg-muted p-4">
        <h3 className="flex items-center gap-2 text-sm text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{title}</h3>
        <p className="mt-3 text-xl font-semibold tabular-nums wrap-anywhere">{primary}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </section>)}
    </div>
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
    {request && <HandoffDialog title={request.name} prompt={request.prompt} onClose={close} />}
  </>;
}

function Configuration({ project, edit, handoff, preparing }: {
  project: ProjectSummary; edit: (id: SettingsId) => void; handoff: (selection: AgentTaskSelection) => void; preparing: boolean;
}) {
  const issue = project.configIssue ?? project.domains.find(domain => domain.name === "开发方式")?.issue;
  return <>
    <PageHeading title="工程配置" description="先核对已有来源，再预览需要同步的工程修改。"
      actions={<Button onClick={() => edit("project")}>{issue ? "核对工程配置" : "编辑工程连接"}</Button>} />
    <div className="space-y-4">
      {issue && <Notice error>{issue}</Notice>}
      <ManagedConfiguration onReview={item => handoff({ purpose: "task", task: "config-review", item })} />
      <Panel title="工程来源" hint={issue ? "可查看已读取的连接和各配置来源。" : "IRIS 同步集中配置、VS Code、MCP、TOML 和受管后端。Web 路径可编辑，SFTP 支持既有入口。"}>
        <DomainRows domains={project.domains.filter(domain => domain.scope === "当前工程")} />
      </Panel>
      <Panel title="领域配置">
        <GridTable label="领域配置" headers={["文件", "识别结果", "操作"]}
          rows={project.profiles.map(profile => [
            <code>{profile.name}</code>, profile.exists ? "存在，语义待核对" : "未发现",
            <Button variant="outline" size="sm" disabled={preparing}
              onClick={() => handoff({ purpose: "task", task: "config-review", item: profile.name })}>核对请求</Button>,
          ])} />
      </Panel>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><a href={href("connections")}>个人共享配置</a></Button>
        <Button asChild variant="ghost"><a href={href("config", "clinic")}>配置交互演示（虚构数据）</a></Button>
      </div>
    </div>
  </>;
}

type HandoffState = { route: string; pending?: AgentHandoffSelection; request?: { name: string; prompt: string }; error?: string };
const handoffErrors: Record<string, string> = {
  "binding-changed": "工程目录身份已改变，请从启动器重新绑定。",
  "handoff-context-invalid": "工程上下文需要核对，请先检查工作区声明。",
  busy: "当前工程正在执行其他操作，请稍后重试。",
};

function useAgentHandoff() {
  const route = location.hash;
  const [state, setState] = useState<HandoffState>();
  const active = useRef<{ route: string; controller: AbortController } | undefined>(undefined);
  useEffect(() => {
    if (active.current && active.current.route !== route) {
      active.current.controller.abort();
      active.current = undefined;
    }
    setState(current => current?.route === route ? current : undefined);
  }, [route]);
  useEffect(() => () => active.current?.controller.abort(), []);

  async function prepare(selection: AgentHandoffSelection) {
    // An action can close a parent dialog and replace the hash before React renders.
    const route = location.hash;
    if (active.current?.route === route) return;
    active.current?.controller.abort();
    const controller = new AbortController();
    active.current = { route, controller };
    const isCurrent = () => !controller.signal.aborted && location.hash === route;
    setState({ route, pending: selection });
    try {
      const request = await prepareAgentHandoff(selection, controller.signal);
      if (isCurrent()) setState({ route, request });
    } catch (failure) {
      if (!isCurrent()) return;
      const code = failure instanceof Error ? failure.message : "";
      setState({ route, error: handoffErrors[code] ?? "无法准备 Agent 请求，请重新检查工程入口后重试。" });
    } finally {
      if (active.current?.controller === controller) active.current = undefined;
    }
  }
  return { ...(state?.route === route ? state : undefined), prepare, close: () => setState(undefined) };
}

function Clients({ project, refresh }: { project: ProjectSummary; refresh: () => void }) {
  const { request, pending, error, prepare, close } = useAgentHandoff();
  const entryLabels = { rules: "规则", skills: "Skills", agents: "原生 Agents", config: "配置" };
  return <>
    <PageHeading title="Agent 客户端" description="检查项目入口，并将当前工程的接入请求复制到对应客户端。"
      actions={<Button variant="outline" onClick={refresh}>重新检查</Button>} />
    {error && <Notice>{error}</Notice>}
    <GridTable label="Agent 客户端" headers={["客户端", "已发现的工程入口", "状态", "操作"]}
      rows={project.clients.map(client => [
        <strong className="font-medium">{client.name}</strong>,
        client.entries.length ? <ul className="space-y-1">{client.entries.map(entry => <li key={entry.path} className="wrap-anywhere">
          <span className="mr-2 text-xs text-muted-foreground">{entryLabels[entry.kind]}</span><code>{entry.path}</code>
          {entry.detail && <span className="ml-2 text-xs text-muted-foreground">{entry.detail}</span>}
        </li>)}</ul> : "未发现项目级入口",
        <small className="text-muted-foreground">{client.status}</small>,
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

function Connections({ project, edit, handoff }: { project: ProjectSummary; handoff: (selection: AgentTaskSelection) => void; edit: (id: SettingsId) => void }) {
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
          <VerifyConnection handoff={() => handoff({ purpose: "task", task: "iris-connection" })} />
          {project.hasFramework && <DiscoverIrisTools handoff={() => handoff({ purpose: "task", task: "iris-mcp" })} />}
        </div>}
        <DomainRows domains={project.domains.filter(domain => /MCP|IRIS/.test(domain.name) && domain.scope === "当前工程")} />
      </Panel>
    </div>
  </>;
}

function Knowledge({ project, nav, handoff, preparing, refresh }: {
  project: ProjectSummary; nav: Navigation; handoff: (selection: AgentTaskSelection) => void; preparing: boolean; refresh: () => void;
}) {
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
        <VectorIndexControls onReadback={refresh} />
        <div className="mt-5 space-y-2">
          <h4 className="text-sm font-medium">本地构建缓存</h4>
          <GridTable label="本地构建缓存" headers={["文件", "归属", "识别结果"]} rows={project.indexes.map(index => [
            <code>{index.name}</code>, index.shared ? "共享能力根" : "当前工程",
            index.status === "present" ? `已发现 · ${Math.round((index.bytes ?? 0) / 1024)} KB`
              : index.status === "unverified" ? "索引位置待核验" : "未发现索引文件",
          ])} />
        </div>
        <div className="mt-5"><KnowledgeBuildControls onReadback={refresh} /></div>
        <Button className="mt-4" variant="outline" disabled={preparing}
          onClick={() => handoff({ purpose: "task", task: "knowledge-index" })}>准备索引维护请求</Button>
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
  applied: "已保存并读回", "reverted-after-failure": "失败后已恢复",
  "reverted-after-interruption": "中断后已恢复", "rolled-back": "已回滚",
};
const taskError: Record<string, string> = {
  "project-recovery-not-available": "回执或文件状态已变化，请按重新读取的结果处理。",
  "project-recovery-conflict": "发现后续修改，请核对实际文件后再决定恢复方式。",
  "binding-changed": "工程目录身份已变化，请从启动器重新绑定。",
  "stale-observation": "工程状态已变化，请按重新读取的结果处理。",
  busy: "正在执行其他工程操作，请等当前操作结束后再试。",
};
const recoverySuccess: Record<ProjectRecoveryIntent, string> = {
  restore: "已恢复至本次保存前的配置。",
  verify: "已核验配置并补记保存结果。",
  rollback: "已撤销本次配置保存。",
};
const localTime = (iso: string) => new Date(iso).toLocaleString("zh-CN", { hour12: false });
type RecoveryConfirmation = ProjectReceipt & { recoveryToken: string };

function receiptSummary(receipt: ProjectReceipt) {
  if (receipt.state === "rolling-back") {
    if (receipt.recovery === "undo-available" && receipt.recoveryToken) return { label: "撤销中断，可继续" };
    const detail = receipt.recovery === "conflict" ? "发现后续修改，请先核对实际文件。" : "请核对实际文件，再决定是否继续。";
    return { label: "撤销待核对", detail };
  }
  if (receipt.state !== "prepared") return { label: receiptStatus[receipt.state] ?? "状态待核对" };
  if (receipt.recovery === "conflict") return { label: "有后续修改", detail: "请先核对变更，再决定如何恢复。" };
  if (receipt.recovery === "available" && receipt.recoveryToken) return { label: "写入待完成，可核对恢复" };
  if (receipt.recovery === "review-required" && receipt.recoveryToken) return { label: "配置已写入，可核验结果" };
  if (receipt.recovery === "unchanged") return { label: "与保存前一致", detail: "配置可继续使用。" };
  if (receipt.recovery === "unsupported") return { label: "需手动核对", detail: "请沿原配置工具核对这次保存的范围。" };
  return { label: "写入结果待核对", detail: "请先核对文件现状，再决定是否恢复。" };
}

function Tasks({ project, activity, refresh }: {
  project: ProjectSummary; activity: string[]; refresh: () => void;
}) {
  const { request, pending, error, prepare, close } = useAgentHandoff();
  const [selected, setSelected] = useState<RecoveryConfirmation>();
  const [recovering, setRecovering] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<{ message: string; error?: true }>();
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ message: string; error?: true }>();
  const undoSelected = selected?.recovery === "undo-available";
  const confirmAction = undoSelected ? "撤销" : "恢复";
  useEffect(refresh, [refresh]);
  const receipts = project.receipts.slice().sort((a, b) => b.updated.localeCompare(a.updated));
  const deployment = project.pluginDeployment;
  const reviewReceipt = receipts.find(receipt => {
    if (receipt.state === "rolling-back") return receipt.recovery !== "undo-available" || !receipt.recoveryToken;
    return receipt.state === "prepared" && receipt.recovery !== "unchanged" &&
      (!receipt.recoveryToken || (recoveryResult?.error && receipt.recovery === "review-required"));
  });
  const receiptId = reviewReceipt && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(reviewReceipt.id)
    ? reviewReceipt.id : undefined;
  const preparingRecovery = pending && "task" in pending && pending.task === "recovery-diagnosis";

  async function resolveReceipt(receipt: RecoveryConfirmation, intent: ProjectRecoveryIntent) {
    setRecovering(true);
    setRecoveryResult(undefined);
    try {
      await recoverProjectConfiguration(receipt.id, receipt.recoveryToken, intent);
      setRecoveryResult({ message: recoverySuccess[intent] });
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      const result = intent === "rollback" ? "撤销" : "保存";
      setRecoveryResult({ message: taskError[code] ?? `暂时无法确认${result}结果，请核对重新读取的回执。`, error: true });
    } finally {
      setRecovering(false);
      setSelected(undefined);
      refresh();
    }
  }

  async function downloadState() {
    setExporting(true);
    setExportResult(undefined);
    try {
      const report = await exportProjectState();
      const url = URL.createObjectURL(report);
      const link = document.createElement("a");
      link.href = url;
      link.download = "agents-workbench-state.json";
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setExportResult({ message: "已开始下载工程状态。" });
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      const message = Object.hasOwn(taskError, code) ? taskError[code] : "暂时无法导出工程状态，请重新读取后再试。";
      setExportResult({ message, error: true });
    } finally {
      setExporting(false);
    }
  }

  return <>
    <PageHeading title="任务与恢复" description="查看工程保存结果、待核对的配置和可用的恢复操作。"
      actions={<>
        <Button variant="outline" onClick={() => void downloadState()} disabled={recovering || exporting}>
          {exporting ? "正在导出…" : "导出工程状态"}
        </Button>
        <Button variant="outline" onClick={refresh} disabled={recovering || exporting}>重新读取</Button>
      </>} />
    <div className="space-y-4">
      {exportResult && <Notice error={exportResult.error}>{exportResult.message}</Notice>}
      {deployment && <Panel title="插件补装"
        hint={deployment.shared ? "共享框架的补装状态来自所属标准根。" : undefined}
        actions={<Button asChild variant="outline" size="sm"><a href={href(deployment.shared ? "home" : "plugins")}>
          {deployment.shared ? "前往工程总览" : "查看插件"}
        </a></Button>}>
        <p role="status" className="text-sm">
          {deployment.phase === "interrupted" ? "补装中断，请核对插件状态后接续。" : "上次记录停在补装途中，请核对实际状态。"}
          {deployment.revision && <> <code>{deployment.revision.slice(0, 12)}</code></>}
        </p>
      </Panel>}
      <Panel title="工程保存回执">
        {project.receiptIssue && <div className="mb-3"><Notice error>部分工程回执无法核对。</Notice></div>}
        {recoveryResult && <div className="mb-3"><Notice error={recoveryResult.error}>{recoveryResult.message}</Notice></div>}
        {receipts.length ? <GridTable label="工程保存回执" headers={["回执", "状态", "涉及文件", "更新时间"]}
          rows={receipts.map(receipt => {
            const { label, detail } = receiptSummary(receipt);
            const recoveryToken = receipt.recoveryToken;
            const canRestore = receipt.state === "prepared" && receipt.recovery === "available";
            const canUndo = (receipt.state === "applied" || receipt.state === "rolling-back") && receipt.recovery === "undo-available";
            const undoLabel = receipt.state === "rolling-back" ? "继续撤销" : "撤销本次保存";
            return [
              <code>{receipt.id}</code>,
              <div className="grid justify-items-start gap-1">
                <Status emphasis={receipt.state === "applied"}>{label}</Status>
                {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
                {(canRestore || canUndo) && recoveryToken &&
                  <Button variant="outline" size="sm" disabled={recovering || exporting || !!pending}
                    onClick={() => setSelected({ ...receipt, recoveryToken })}>{canUndo ? undoLabel : "恢复配置"}</Button>}
                {receipt.state === "prepared" && receipt.recovery === "review-required" && recoveryToken &&
                  <Button variant="outline" size="sm" disabled={recovering || exporting || !!pending}
                    onClick={() => void resolveReceipt({ ...receipt, recoveryToken }, "verify")}>核验保存结果</Button>}
              </div>,
              receipt.files, localTime(receipt.updated),
            ];
          })} /> : !project.receiptIssue && <p className="text-sm text-muted-foreground">还没有工程保存回执。</p>}
      </Panel>
      <Panel title="Agent 接续" hint="准备当前工程的核对请求，复制到此工程的 Agent 会话。"
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!pending || recovering} onClick={() => prepare({ purpose: "project-check" })}>
            {pending && !preparingRecovery ? "正在准备…" : "准备工程检查请求"}
          </Button>
          {(reviewReceipt || project.receiptIssue) && <Button disabled={recovering || !!pending}
            onClick={() => prepare({ purpose: "task", task: "recovery-diagnosis", ...(receiptId ? { item: receiptId } : {}) })}>
            {preparingRecovery ? "正在准备…" : "恢复诊断请求"}
          </Button>}
        </div>}>
        {error ? <Notice error>{error}</Notice> : undefined}
      </Panel>
      {activity.length > 0 && <Panel title="本窗口操作">
        <ul className="divide-y">{activity.map((line, index) => <li className="flex items-center gap-2 py-2 text-sm" key={index}>
          <CircleCheck aria-hidden="true" className="size-4 text-muted-foreground" />{line}
        </li>)}</ul>
      </Panel>}
    </div>
    {selected && <WorkbenchDialog title={undoSelected ? "撤销配置保存" : "恢复配置"} description={undoSelected
      ? "将这批已保存的配置恢复到保存前。发现后续修改时会停止撤销。"
      : "核对回执后，将这次保存留下的改动恢复到保存前。发现后续修改时会停止。"}
      onClose={() => setSelected(undefined)} busy={recovering}
      actions={<Button onClick={() => void resolveReceipt(selected, undoSelected ? "rollback" : "restore")} disabled={recovering}>
        {recovering ? `正在${confirmAction}…` : `确认${confirmAction}`}
      </Button>}>
      <p>{selected.restoreFiles !== undefined && `预计恢复 ${selected.restoreFiles} 个文件。`} 回执时间 {localTime(selected.updated)}</p>
      <code className="wrap-anywhere">{selected.id}</code>
    </WorkbenchDialog>}
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

function ManualPage({ nav, handoff, preparing }: { nav: Navigation; handoff: (selection: AgentTaskSelection) => void; preparing: boolean }) {
  const guides = useResource(readGuides);
  return guides.data ? <GuideReader guides={guides.data} nav={nav} handoffPending={preparing}
    onHandoff={(_, file) => handoff({ purpose: "task", task: "manual", item: file })} />
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
  const { request, pending, error, prepare, close } = useAgentHandoff();
  useEffect(() => onProject(project.name), [project.name, onProject]);
  function edit(id: SettingsId) { nav.replace({ edit: id }); }
  const editId = nav.route.params.get("edit");
  const validEditor = nav.route.page === "config" && editId === "project" || nav.route.page === "connections" && (editId === "bos" || editId === "knowledge");
  let content;
  switch (nav.route.page) {
    case "config": content = <Configuration project={project} edit={edit} handoff={prepare} preparing={!!pending} />; break;
    case "clients": content = <Clients project={project} refresh={refresh} />; break;
    case "connections": content = <Connections project={project} edit={edit} handoff={prepare} />; break;
    case "knowledge": content = <Knowledge project={project} nav={nav} handoff={prepare} preparing={!!pending} refresh={refresh} />; break;
    case "manual": content = <ManualPage nav={nav} handoff={prepare} preparing={!!pending} />; break;
    case "scope": content = <CapabilityDirectory />; break;
    case "tasks": content = <Tasks project={project} activity={activity} refresh={refresh} />; break;
    case "plugins": content = <PluginsPage project={project} nav={nav} refresh={refresh}
      onHandoff={item => prepare({ purpose: "task", task: "plugin-init", item })} />; break;
    default: content = <Home project={project} refresh={refresh} />;
  }
  return <>
    {(pending || error) && <div className="mb-4"><Notice error={!!error}>{error ?? "正在准备 Agent 请求…"}</Notice></div>}
    {content}
    {validEditor && <SettingsDialog key={editId} id={editId as SettingsId} handoff={() => {
      nav.replace({ edit: undefined });
      void prepare({ purpose: "task", task: "iris-connection" });
    }} onClose={() => nav.replace({ edit: undefined })}
      onSaved={id => { setActivity(lines => [id === "project" ? "工程配置已保存并读回" : "个人配置已保存并读回", ...lines]); refresh(); }} />}
    {editId && !validEditor && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
      <CircleHelp aria-hidden="true" className="size-4" />此页面没有对应配置编辑入口。
    </p>}
    {request && <HandoffDialog title={request.name} prompt={request.prompt} onClose={close} />}
  </>;
}
