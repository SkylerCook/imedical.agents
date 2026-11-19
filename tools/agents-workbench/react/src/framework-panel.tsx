import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { frameworkAction, offlineFrameworkAction, type OfflinePlan } from "./framework-api";
import { OverlayUpdateControls, OverlayUpdateResult, type OverlayReceipt, type OverlayView } from "./overlay-update";
import { ReleaseUpdateControls } from "./release-update";
import { Panel } from "./ui";
import { version } from "../package.json";

type Action = Parameters<typeof frameworkAction>[0];
type Observation = { projectId: string; status: string; revision: string | null; observedAt: string | null; canApply?: boolean; offline?: OfflinePlan | null; overlay?: OverlayView; workbenchUpdate?: boolean; workbenchRollback?: boolean; installed?: { sparseRules:boolean; profile:boolean; skillEntries:number } };
type Receipt = { action?: string; error?: string; diagnostic?: string; before?: Observation; after?: Observation; exitCode?: number; overlayUpdate?: OverlayReceipt; steps?: {step:string; exitCode:number; revision:string|null;diagnostic?:string}[]; compatibility?: { publishedRevision: string; selectedRevision: string } };
const labels: Record<string,string> = {
  install:"安装基础框架", initialize:"生成工程入口", check:"检查工程", preview:"本地预演",
  "fetch-preview":"获取新版并预演", apply:"应用更新并复查", refresh:"重新读取",
  "refresh-overlay":"仅刷新所选成员",
  "offline-select":"选择并预演离线能力包", "offline-apply":"应用离线能力包",
};
const reasons: Record<string,string> = {
  "unsupported-platform":"当前平台仅支持读取", "install-failed":"安装器未完成，请核对框架来源、版本及工程目录后重新读取",
  "revision-mismatch":"取版后的工程版本与预期不同，请重新读取", "custom-git-config":"当前 Git 使用自定义执行配置，请通过原 CLI 接续",
  "inspection-failed":"读取或核验运行文件失败", "git-unavailable":"无法运行 Git 或读取框架对象",
  "deployment-busy":"其他操作持有部署锁。结束后可直接再次应用本次预演。",
  "unknown-tree":"当前框架或目标版本尚未验证", "runtime-modified":"运行文件与已验证版本有差异",
  "custom-upstream":"当前分支或上游为自定义配置", "fetch-failed":"无法获取框架来源，请检查 Git 和网络",
  "published-history-mismatch":"发布分支的已核验版本无法从当前版本安全快进，已保留当前工程。",
  "preview-required":"请先获取新版并预演", "preview-failed":"原更新器预演失败，请检查部署锁、工作区和上游",
  "unsupported-project":"工程状态发生变化，请重新读取", "session-required":"请通过启动器重新打开工程",
  "binding-changed":"工程目录身份已改变，请重新绑定", "busy":"当前工程正在执行其他操作",
  "overlay-plan-changed":"共享能力或成员登记发生变化，请重新读取工程。",
  "overlay-selection-unverified":"所选成员待核验，请重新读取工程。",
  "overlay-selection-changed":"所选成员已变化，请重新读取或取消选择后更新标准根。",
  "overlay-root-changed":"共享能力根身份或版本已变化，请重新读取工程。",
  "overlay-root-update-failed":"标准根更新或复查未完成，成员未刷新。",
  "offline-local-file-required":"请选择本机磁盘上的发行记录和能力包",
  "offline-local-directory-required":"请选择本机磁盘上的能力包并重新预演",
  "offline-release-record-not-independent":"请使用从批准渠道另行取得的发行记录",
  "offline-release-record-invalid":"离线发行记录无效，请向发放方核对",
  "offline-install-release-branch-required":"首次安装请使用团队发布分支 master 的离线能力包，以便后续正常取版和更新。",
  "offline-bundle-name-invalid":"请选择 capability.bundle 文件",
  "offline-bundle-invalid":"能力包校验失败，请核对发行记录、包摘要和对象完整性",
  "offline-revision-unapproved":"该离线版本尚未获当前工作台批准",
  "offline-installed-revision-unapproved":"当前工程版本尚未获当前工作台批准",
  "offline-selection-stale":"发行记录或选择已变化，请重新预演",
  "offline-preview-required":"请重新选择离线能力包并预演",
  "offline-picker-unavailable":"无法打开 Windows 文件选择，请重新启动工作台后重试",
  "offline-owner-failed":"原安装器或更新器未完成，请重新读取工程状态",
  "offline-result-mismatch":"离线操作后的工程版本与预期不符，请重新读取",
  "pull-blocked-dirty":"工程框架有未提交改动，请处理后重新预演",
  "pull-blocked-diverged":"工程版本无法快进到选中的离线版本",
  "offline-objects-missing":"能力包缺失 Git 对象，请取得完整离线包",
  "sparse-refresh-failed":"工程稀疏检出未刷新，请核对工作区后重试",
};
const states: Record<string,string> = {standard:"已绑定 standard 工程","no-framework":"工程待安装",observing:"正在识别工程",
  "overlay-declared":"Overlay 工程",partial:"框架部署不完整","unknown-source":"框架来源待核对",
  "framework-checkout":"框架源仓","custom-layout":"自定义目录","needs-refresh":"需要重新读取"};

export function FrameworkPanel({onChanged}:{onChanged:()=>void}) {
  const [state,setState]=useState<Observation>();
  const [receipt,setReceipt]=useState<Receipt>();
  const [pending,setPending]=useState<Action | "offline-select" | "offline-apply">();
  const [selection,setSelection]=useState<{planId:string; ids:string[]}>();
  const overlay=state?.overlay;
  const roster=overlay && overlay.scope==="standard" && "planId" in overlay ? overlay : undefined;
  const memberIds=roster
    ? selection?.planId===roster.planId ? selection.ids : roster.members.filter(member=>member.status==="ready").map(member=>member.id)
    : [];
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
      const includeMembers=roster && memberIds.length && (action==="apply" || action==="refresh-overlay");
      const result=await frameworkAction(action,state.projectId,state.revision,
        includeMembers ? {overlayPlanId:roster.planId,memberIds} : undefined);
      const next=action==="refresh" ? result : result.after || result.before;
      if(next) setState({...next,projectId:state.projectId,canApply:result.canApply,
        workbenchUpdate:result.workbenchUpdate ?? state.workbenchUpdate,workbenchRollback:result.workbenchRollback ?? state.workbenchRollback,
        overlay:result.overlay,
        offline:action==="refresh" ? result.offline : next.revision===state.revision && next.status===state.status ? state.offline : null});
      const memberResult: OverlayReceipt | undefined=result.overlayUpdate;
      const nextOverlay: OverlayView | undefined=result.overlay;
      const preserveSelection=selection && ["fetch-preview","preview","refresh"].includes(action);
      if ((memberResult?.status==="partial" || preserveSelection) && nextOverlay?.scope==="standard" && "planId" in nextOverlay) {
        const finished=new Set(memberResult?.members.filter(member=>member.status==="complete").map(member=>member.id));
        const remaining=new Set(memberIds.filter(id=>!finished.has(id)));
        setSelection({planId:nextOverlay.planId,ids:nextOverlay.members
          .filter(member=>member.status==="ready" && remaining.has(member.id)).map(member=>member.id)});
      }
      setReceipt(result);
      if(["install","apply","fetch-preview","refresh-overlay"].includes(action)) onChanged();
    } catch(e) {setReceipt({error:e instanceof Error ? e.message : "请求失败"});}
    finally {setPending(undefined);}
  }
  async function actOffline(action: "select" | "apply") {
    if (!state || pending || (action==="apply" && !state.offline)) return;
    setPending(action==="select" ? "offline-select" : "offline-apply");
    setReceipt(undefined);
    try {
      const result=await offlineFrameworkAction(action,state.projectId,state.revision,state.offline?.selectionId);
      const next=result.after || result.before || state;
      setState({...next,projectId:state.projectId,offline:result.offline,canApply:result.canApply ?? state.canApply,
        overlay:result.overlay ?? state.overlay,workbenchUpdate:state.workbenchUpdate,workbenchRollback:state.workbenchRollback});
      if(!result.cancelled) setReceipt(result);
      if(action==="apply") onChanged();
    } catch(e) {
      setReceipt({error:e instanceof Error ? e.message : "离线请求失败"});
      setState({...state,offline:null});
    } finally {setPending(undefined);}
  }
  const button=(action:Action,disabled=false,label=labels[action])=><Button variant="outline" disabled={!!pending || disabled} onClick={()=>act(action)}>{label}</Button>;
  return <Panel title="框架安装与更新" hint={state ? (states[state.status] ?? state.status) : "正在读取工程身份"}>
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">工作台 {version}</p>
      {state?.revision && <p>当前版本 <code>{state.revision.slice(0,12)}</code> · 最近观测 {new Date(state.observedAt!).toLocaleTimeString()}</p>}
      {state?.installed && <p>稀疏检出规则{state.installed.sparseRules?"已读取":"缺失"} · 插件配置{state.installed.profile?"已生成":"待生成"} · 技能目录条目 {state.installed.skillEntries}</p>}
      {state?.status==="standard" && <><p>本地预演检查当前版本。获取新版会更新共享框架目录；应用更新会写入当前工程配置和生成入口。</p>
        <div className="flex flex-wrap gap-2">{button("check")}{button("preview")}{button("fetch-preview")}
          {button("apply",!state.canApply,memberIds.length ? `应用更新并刷新 ${memberIds.length} 个成员` : labels.apply)}</div></>}
      {state && overlay && <OverlayUpdateControls projectId={state.projectId} revision={state.revision}
        overlay={overlay} memberIds={memberIds} disabled={!!pending} canApply={!!state.canApply}
        onSelect={ids=> { if (roster) setSelection({planId:roster.planId,ids}); }} onRefresh={()=>act("refresh-overlay")}
        onMemberUpdated={onChanged} />}
      {state?.status==="no-framework" && <><p>从框架发布源安装到当前工程的 .agents，生成基础入口并复查。</p>{button("install")}</>}
      {(state?.status==="standard" || state?.status==="no-framework") && <div className="space-y-2 border-t pt-3">
        <Button variant="outline" disabled={!!pending} onClick={()=>actOffline("select")}>{labels["offline-select"]}</Button>
        {state.offline && <div className="space-y-2">
          <p>离线预演通过，目标版本 <code>{state.offline.revision.slice(0,12)}</code> · {state.offline.ref}</p>
          <Button disabled={!!pending} onClick={()=>actOffline("apply")}>{state.offline.install ? "确认离线首装" : "应用离线更新"}</Button>
        </div>}
      </div>}
      {button("refresh",!state)}
      {state?.workbenchUpdate && <ReleaseUpdateControls projectId={state.projectId} revision={state.revision}
        canRollback={!!state.workbenchRollback} onRollbackChanged={workbenchRollback=>setState(previous=>previous && ({...previous,workbenchRollback}))}
        disabled={!!pending} />}
      <div role="status" aria-live="polite">{pending && <p>正在执行：{labels[pending]}…</p>}
        {receipt?.steps?.map(step=><p key={step.step}>{labels[step.step]} · 退出码 {step.exitCode} · {step.revision?.slice(0,12) ?? "尚无框架版本"}{step.diagnostic && " · "+step.diagnostic}</p>)}
        {receipt?.compatibility && <p>发布分支已到 <code>{receipt.compatibility.publishedRevision.slice(0,12)}</code>，本次采用已核验版本 <code>{receipt.compatibility.selectedRevision.slice(0,12)}</code>。</p>}
        {receipt?.overlayUpdate && <OverlayUpdateResult result={receipt.overlayUpdate} />}
        {receipt?.error && <p>{reasons[receipt.diagnostic ?? receipt.error] ?? reasons[receipt.error] ?? receipt.error}</p>}
        {!receipt?.error && receipt?.exitCode===0 && (receipt.action==="install" || receipt.action==="apply") && !receipt.steps &&
          <p>离线{receipt.action==="install" ? "首装" : "更新"}已完成。</p>}
      </div>
      {(receipt?.error || (receipt?.exitCode !== undefined && receipt.exitCode!==0)) && state?.status==="standard" &&
        <details><summary>从原 CLI 接续</summary><p>先核对当前和目标版本的更新器、插件来源与工作区差异。在工程根目录运行下面的命令可查看详细结果。</p>
          <pre className="overflow-auto">{String.raw`.\.agents\scripts\update-agents.ps1 -ProjectRoot . -Mode Check -NoPull -Detailed`}</pre>
          <p>确认来源可信并决定更新后，先取版预演，再应用和复查。完成后点击“重新读取”。</p>
          <pre className="overflow-auto">{String.raw`.\.agents\scripts\update-agents.ps1 -ProjectRoot . -Mode DryRun
.\.agents\scripts\update-agents.ps1 -ProjectRoot . -Mode Write -NoPull
.\.agents\scripts\update-agents.ps1 -ProjectRoot . -Mode Check -NoPull`}</pre></details>}
    </div>
  </Panel>;
}
