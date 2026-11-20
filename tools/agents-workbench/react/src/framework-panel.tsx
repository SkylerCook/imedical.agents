import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { frameworkAction, offlineFrameworkAction, readFrameworkUpdateNote, type FrameworkUpdateNote, type OfflinePlan } from "./framework-api";
import { OverlayProjectLinks, type OverlayView } from "./overlay-update";
import { ReleaseUpdateControls } from "./release-update";
import { href } from "./routes";
import { Panel, textareaClass } from "./ui";
import { version } from "../package.json";

type Action = "refresh" | "check" | "install";
type Observation = { projectId: string; status: string; revision: string | null; observedAt: string | null; offline?: OfflinePlan | null; overlay?: OverlayView; workbenchUpdate?: boolean; workbenchRollback?: boolean; installed?: { sparseRules:boolean; profile:boolean; skillEntries:number } };
type Receipt = { action?: string; error?: string; diagnostic?: string; exitCode?: number; steps?: {step:string; exitCode:number; revision:string|null;diagnostic?:string}[];
  compatibility?: { publishedRevision: string; selectedRevision: string } };
const labels: Record<string,string> = {
  install:"安装基础框架", initialize:"生成工程入口", check:"检查工程", refresh:"重新读取",
  "offline-select":"选择并预演离线能力包", "offline-apply":"确认离线首装",
};
const reasons: Record<string,string> = {
  "unsupported-platform":"当前平台仅支持读取", "install-failed":"安装器未完成，请核对框架来源、版本及工程目录后重新读取",
  "revision-mismatch":"框架版本已变化，请重新读取", "stale-observation":"框架版本已变化，请重新读取",
  "custom-git-config":"当前 Git 使用自定义执行配置，请使用更新提示词核对",
  "inspection-failed":"读取或核验运行文件失败", "git-unavailable":"无法运行 Git 或读取框架对象",
  "deployment-busy":"其他操作持有部署锁，请结束后重试。",
  "unknown-tree":"当前框架或目标版本尚未验证", "runtime-modified":"运行文件与已验证版本有差异",
  "custom-upstream":"当前分支或上游为自定义配置", "fetch-failed":"无法获取框架来源，请检查 Git 和网络",
  "published-history-mismatch":"发布分支的已核验版本无法从当前版本安全快进，已保留当前工程。",
  "unsupported-project":"工程状态发生变化，请重新读取", "session-required":"请通过启动器重新打开工程",
  "binding-changed":"工程目录身份已改变，请重新绑定", "busy":"当前工程正在执行其他操作",
  "offline-local-file-required":"请选择本机磁盘上的发行记录和能力包",
  "offline-local-directory-required":"请选择本机磁盘上的能力包并重新预演",
  "offline-release-record-not-independent":"请将批准渠道单独发放的发行记录放到能力包解压目录外，再重新选择。",
  "offline-release-record-invalid":"离线发行记录无效，请向发放方核对",
  "offline-install-release-branch-required":"首次安装请使用团队发布分支 master 的离线能力包，以便后续正常取版和更新。",
  "offline-bundle-name-invalid":"请选择 capability.bundle 文件",
  "offline-bundle-invalid":"能力包校验失败，请核对发行记录、包摘要和对象完整性",
  "offline-revision-unapproved":"该离线版本尚未获当前工作台批准",
  "offline-selection-stale":"发行记录或选择已变化，请重新预演",
  "offline-preview-required":"请重新选择离线能力包并预演",
  "offline-picker-unavailable":"无法打开 Windows 文件选择，请重新启动工作台后重试",
  "offline-owner-failed":"原安装器未完成，请重新读取工程状态",
  "offline-result-mismatch":"离线操作后的工程版本与预期不符，请重新读取",
  "pull-blocked-dirty":"工程框架有未提交改动，请处理后重新预演",
  "offline-objects-missing":"能力包缺失 Git 对象，请取得完整离线包",
  "sparse-refresh-failed":"工程稀疏检出未刷新，请核对工作区后重试",
};
const states: Record<string,string> = {standard:"已绑定 standard 工程","no-framework":"工程待安装",observing:"正在识别工程",
  "overlay-declared":"Overlay 工程",partial:"框架部署不完整","invalid-head":"无法读取框架版本","unknown-source":"框架来源待核对",
  "framework-checkout":"框架源仓","custom-layout":"自定义目录","needs-refresh":"需要重新读取",
  "invalid-declaration":"Overlay 声明待核对","git-unavailable":"无法读取本机 Git","binding-changed":"工程目录身份已改变"};
const manualHelp: Record<string, { label: string; doc: string; section: string }> = {
  "invalid-declaration": { label: "查看 Overlay 声明与目录", doc: "workspace-overlay.md", section: "manifest-与目录边界" },
  "git-unavailable": { label: "查看安装环境要求", doc: "update-agents.md", section: "使用前提" },
};

export function FrameworkPanel({onChanged, projectHandoff}:{onChanged:()=>void; projectHandoff:ReactNode}) {
  const [state,setState]=useState<Observation>();
  const [receipt,setReceipt]=useState<Receipt>();
  const [pending,setPending]=useState<Action | "offline-select" | "offline-apply">();
  const overlay=state?.overlay;
  useEffect(()=>{
    const controller=new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response=await fetch("/framework.json",{headers:{"X-Workbench-Request":"1"},signal:controller.signal});
        if (!response.ok) throw Error();
        const data=await response.json(); setState(data);
        if(data.status==="observing") timer=setTimeout(read,300);
      } catch { if (!controller.signal.aborted) setReceipt({error:"工程状态读取失败"}); }
    }
    void read();
    return ()=>{controller.abort();clearTimeout(timer);};
  },[]);
  async function act(action:Action) {
    if (!state || pending) return;
    setPending(action); setReceipt(undefined);
    try {
      const result=await frameworkAction(action,state.projectId,state.revision);
      const next=action==="refresh" ? result : result.after || result.before;
      if(next) setState({...next,projectId:state.projectId,
        workbenchUpdate:result.workbenchUpdate ?? state.workbenchUpdate,workbenchRollback:result.workbenchRollback ?? state.workbenchRollback,
        overlay:result.overlay,
        offline:action==="refresh" ? result.offline : next.revision===state.revision && next.status===state.status ? state.offline : null});
      setReceipt(result);
      if(action==="install" || action==="refresh") onChanged();
    } catch(e) {setReceipt({error:e instanceof Error ? e.message : "请求失败"});}
    finally {setPending(undefined);}
  }
  async function actOffline(action: "select" | "apply") {
    if (state?.status!=="no-framework" || pending || (action==="apply" && !state.offline?.install)) return;
    setPending(action==="select" ? "offline-select" : "offline-apply");
    setReceipt(undefined);
    try {
      const result=await offlineFrameworkAction(action,state.projectId,state.revision,state.offline?.selectionId);
      const next=result.after || result.before || state;
      setState({...next,projectId:state.projectId,offline:result.offline,
        overlay:result.overlay ?? state.overlay,workbenchUpdate:state.workbenchUpdate,workbenchRollback:state.workbenchRollback});
      if(!result.cancelled) setReceipt(result);
      if(action==="apply") onChanged();
    } catch(e) {
      setReceipt({error:e instanceof Error ? e.message : "离线请求失败"});
      setState({...state,offline:null});
    } finally {setPending(undefined);}
  }
  const button=(action:Action,disabled=false)=><Button variant="outline" disabled={!!pending || disabled} onClick={()=>act(action)}>{labels[action]}</Button>;
  const canHandoff=state?.status==="standard" || state?.status==="overlay-declared";
  const needsRecovery=!!state && ["partial", "invalid-head", "unknown-source", "invalid-declaration"].includes(state.status);
  const help=state && manualHelp[state.status];
  const installChecked=receipt?.action==="install" && receipt.exitCode===0 && !receipt.error &&
    receipt.steps?.some(step=>step.step==="check" && step.exitCode===0);
  const compatibility=installChecked ? receipt.compatibility : undefined;
  return <Panel title="框架安装与更新" className="mb-6" hint={state ? (states[state.status] ?? state.status) : "正在读取工程身份"}>
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">工作台版本 {version}</p>
      {state?.revision && <p>.agents 框架版本 <code>{state.revision.slice(0,12)}</code> · 最近观测 {new Date(state.observedAt!).toLocaleTimeString()}</p>}
      {state?.installed && <p>稀疏检出规则{state.installed.sparseRules?"已读取":"缺失"} · 插件配置{state.installed.profile?"已生成":"待生成"} · 技能目录条目 {state.installed.skillEntries}</p>}
      <section aria-labelledby="framework-direct" className="space-y-2">
        <h4 id="framework-direct" className="font-semibold">在工作台完成</h4>
        {state?.status==="no-framework" && <p>安装基础框架后会生成工程入口并复查。离线首装请把独立发行记录放在能力包解压目录外。</p>}
        <div className="flex flex-wrap gap-2">
          {state?.status==="no-framework" && <>
            {button("install")}
            <Button variant="outline" disabled={!!pending} onClick={()=>actOffline("select")}>{labels["offline-select"]}</Button>
          </>}
          {state?.status==="standard" && button("check")}
          {button("refresh",!state)}
        </div>
        {help && !needsRecovery && <Button asChild variant="link" className="h-auto p-0">
          <a href={href("manual", null, { doc: help.doc, section: help.section })}>{help.label}</a>
        </Button>}
        {state?.status==="binding-changed" && <p className="text-muted-foreground">请从工作台启动器重新选择工程目录。</p>}
        {state?.status==="no-framework" && state.offline?.install && <div className="space-y-2">
          <p>离线预演通过，目标版本 <code>{state.offline.revision.slice(0,12)}</code> · {state.offline.ref}</p>
          <Button disabled={!!pending} onClick={()=>actOffline("apply")}>{labels["offline-apply"]}</Button>
        </div>}
        <div role="status" aria-live="polite">
          {pending && <p>{pending === "offline-select" ? "请在 Windows 文件选择窗口选取发行记录和能力包，选完后工作台会校验并预演。" : `正在执行 ${labels[pending]}…`}</p>}
          {installChecked && <p>基础框架已安装并通过检查。</p>}
          {compatibility && compatibility.publishedRevision !== compatibility.selectedRevision && <p>
            已安装核验版本 <code>{compatibility.selectedRevision.slice(0,12)}</code>。发布分支的 <code>{compatibility.publishedRevision.slice(0,12)}</code> 可用更新提示词接续。
          </p>}
          {receipt?.steps?.map(step=><p key={step.step}>{labels[step.step]} · 退出码 {step.exitCode} · {step.revision?.slice(0,12) ?? "尚无框架版本"}{step.diagnostic && " · "+step.diagnostic}</p>)}
          {receipt?.error && <p>{reasons[receipt.diagnostic ?? receipt.error] ?? reasons[receipt.error] ?? receipt.error}</p>}
          {!receipt?.error && receipt?.exitCode===0 && receipt.action==="install" && !receipt.steps && <p>离线首装已完成。</p>}
        </div>
        {state && overlay && <OverlayProjectLinks projectId={state.projectId} revision={state.revision} overlay={overlay} disabled={!!pending} />}
        {state?.workbenchUpdate && <ReleaseUpdateControls projectId={state.projectId} revision={state.revision}
          canRollback={!!state.workbenchRollback} onRollbackChanged={workbenchRollback=>setState(previous=>previous && ({...previous,workbenchRollback}))}
          disabled={!!pending || state.status==="observing"} />}
      </section>
      {(canHandoff || needsRecovery) && <section aria-labelledby="framework-handoff" className="space-y-3 border-t pt-3">
        <h4 id="framework-handoff" className="font-semibold">交给 Agent</h4>
        <UpdatePrompt key={state.observedAt} projectId={state.projectId} revision={state.revision} recovery={needsRecovery} />
        {needsRecovery ? <Button asChild variant="link" className="h-auto p-0">
          <a href={href("manual", null, { doc: help?.doc ?? "update-agents.md", section: help?.section ?? "更新中断与续接" })}>
            {help?.label ?? "查看框架恢复手册"}
          </a>
        </Button> : <div className="space-y-2">
          <p className="text-muted-foreground">需要从代码和业务约定补齐项目规则时，可准备工程检查请求。</p>
          {projectHandoff}
        </div>}
      </section>}
    </div>
  </Panel>;
}

const updateStatus: Record<FrameworkUpdateNote["status"], string> = {
  "update-available": "发现框架新版",
  current: "当前框架已是上游版本",
  unavailable: "暂时无法确认框架更新",
  "upstream-changed": "上游版本待核对",
  "recovery-required": "框架需要核对恢复",
};
const updateReason: Record<string, string> = {
  "upstream-unavailable": "可以通过提示词核对网络或选用获准的离线能力包。",
  "upstream-unrecognized": "请在 Agent 中核对本工程的框架来源。",
  "unknown-source": "先确认当前 Git 来源、跟踪分支和项目约定，再决定更新方式。",
  "invalid-declaration": "先核对当前工程的 Overlay 声明。修复后从启动器重新打开工程。",
  "history-not-fast-forward": "当前提交的升级路径需要在 Agent 中核对。",
  "overlay-unverified": "请先核对本工程绑定的共享能力根。",
};

function UpdatePrompt({ projectId, revision, recovery }: { projectId: string; revision: string | null; recovery: boolean }) {
  const [note, setNote] = useState<FrameworkUpdateNote>();
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState<"copied" | "manual">();
  useEffect(() => {
    const controller = new AbortController();
    readFrameworkUpdateNote(projectId, revision, controller.signal).then(result => {
      if (!controller.signal.aborted) setNote(result);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      const code = cause instanceof Error ? cause.message : "";
      setError(reasons[code] ?? (recovery ? "暂时无法准备恢复提示词，请重新读取后重试。" : "暂时无法检查框架更新，请重新读取后重试。"));
    });
    return () => controller.abort();
  }, [projectId, revision, recovery]);

  async function copyPrompt(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }

  const prompt = note?.prompt;
  const promptLabel = recovery ? "恢复提示词" : "更新提示词";
  return <div className="space-y-2">
    <p className="text-muted-foreground">{recovery ? "在当前工程的 Agent 会话核对现有 .agents 和项目规则，处理完毕后回工作台重新读取。"
      : "已有工程更新由当前工程的 Agent 会话接续，完成后回工作台重新读取。"}</p>
    <div role="status" aria-live="polite" className="space-y-1">
      <p>{error || (note ? updateStatus[note.status] : recovery ? "正在准备恢复提示词…" : "正在检查框架更新…")}
        {note?.targetRevision && note.targetRevision !== note.revision && <> · <code>{note.targetRevision.slice(0,12)}</code></>}
      </p>
      {note?.scope === "overlay" && note.revision && <p className="text-muted-foreground">共享框架版本 <code>{note.revision.slice(0,12)}</code></p>}
      {note?.reason && updateReason[note.reason] && <p className="text-muted-foreground">{updateReason[note.reason]}</p>}
    </div>
    {prompt && <Button type="button" variant={note.status === "update-available" || recovery ? "default" : "outline"}
      onClick={() => void copyPrompt(prompt)}>复制{promptLabel}</Button>}
    {copyState && <p role="status" className="text-muted-foreground">{copyState === "copied"
      ? "已复制。请粘贴到当前工程的 Agent 会话，完成后重新读取。"
      : "剪贴板不可用，请选中以下提示词手动复制。"}</p>}
    {copyState === "manual" && prompt &&
      <textarea className={textareaClass} aria-label={promptLabel} value={prompt} rows={8} readOnly
        onFocus={event => event.currentTarget.select()} />}
  </div>;
}
