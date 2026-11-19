import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { frameworkAction } from "./framework-api";
import { Panel } from "./ui";
import { version } from "../package.json";

type Action = Parameters<typeof frameworkAction>[0];
type Observation = { projectId: string; status: string; revision: string | null; observedAt: string | null; canApply?: boolean; installed?: { sparseRules:boolean; profile:boolean; skillEntries:number } };
type Receipt = { error?: string; before?: Observation; after?: Observation; exitCode?: number; steps?: {step:string; exitCode:number; revision:string|null;diagnostic?:string}[] };
const labels: Record<string,string> = {
  install:"安装基础框架", initialize:"生成工程入口", check:"检查工程", preview:"本地预演",
  "fetch-preview":"获取新版并预演", apply:"应用更新并复查", refresh:"重新读取",
};
const reasons: Record<string,string> = {
  "unsupported-platform":"当前平台仅支持读取", "install-failed":"安装器未完成，请核对框架来源、版本及工程目录后重新读取",
  "revision-mismatch":"取版后的工程版本与预期不同，请重新读取", "custom-git-config":"当前 Git 使用自定义执行配置，请通过原 CLI 接续",
  "inspection-failed":"读取或核验运行文件失败", "git-unavailable":"无法运行 Git 或读取框架对象",
  "deployment-busy":"其他操作持有部署锁。结束后可直接再次应用本次预演。",
  "unknown-tree":"当前框架或目标版本尚未验证", "runtime-modified":"运行文件与已验证版本有差异",
  "custom-upstream":"当前分支或上游为自定义配置", "fetch-failed":"无法获取框架来源，请检查 Git 和网络",
  "preview-required":"请先获取新版并预演", "preview-failed":"原更新器预演失败，请检查部署锁、工作区和上游",
  "unsupported-project":"工程状态发生变化，请重新读取", "session-required":"请通过启动器重新打开工程",
  "binding-changed":"工程目录身份已改变，请重新绑定", "busy":"当前工程正在执行其他操作",
};
const states: Record<string,string> = {standard:"已绑定 standard 工程","no-framework":"工程待安装",observing:"正在识别工程",
  "overlay-declared":"Overlay 工程，本版只读",partial:"框架部署不完整","unknown-source":"框架来源待核对",
  "framework-checkout":"框架源仓","custom-layout":"自定义目录","needs-refresh":"需要重新读取"};

export function FrameworkPanel({onChanged}:{onChanged:()=>void}) {
  const [state,setState]=useState<Observation>();
  const [receipt,setReceipt]=useState<Receipt>();
  const [pending,setPending]=useState<Action>();
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
      if(next) setState({...next,projectId:state.projectId,canApply:result.canApply});
      setReceipt(result);
      if(["install","apply","fetch-preview"].includes(action)) onChanged();
    } catch(e) {setReceipt({error:e instanceof Error ? e.message : "请求失败"});}
    finally {setPending(undefined);}
  }
  const button=(action:Action,disabled=false)=><Button variant="outline" disabled={!!pending || disabled} onClick={()=>act(action)}>{labels[action]}</Button>;
  return <Panel title="框架安装与更新" hint={state ? (states[state.status] ?? state.status) : "正在读取工程身份"}>
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">工作台 {version} · Windows standard 试点</p>
      {state?.revision && <p>当前版本 <code>{state.revision.slice(0,12)}</code> · 最近观测 {new Date(state.observedAt!).toLocaleTimeString()}</p>}
      {state?.installed && <p>稀疏检出规则{state.installed.sparseRules?"已读取":"缺失"} · 插件配置{state.installed.profile?"已生成":"待生成"} · 技能目录条目 {state.installed.skillEntries}</p>}
      {state?.status==="standard" && <><p>本地预演检查当前版本。获取新版会更新共享框架目录；应用更新会写入当前工程配置和生成入口。</p>
        <div className="flex flex-wrap gap-2">{button("check")}{button("preview")}{button("fetch-preview")}{button("apply",!state.canApply)}</div></>}
      {state?.status==="no-framework" && <><p>从框架发布源安装到当前工程的 .agents，生成基础入口并复查。</p>{button("install")}</>}
      {button("refresh",!state)}
      <div role="status" aria-live="polite">{pending && <p>正在执行：{labels[pending]}…</p>}
        {receipt?.steps?.map(step=><p key={step.step}>{labels[step.step]} · 退出码 {step.exitCode} · {step.revision?.slice(0,12) ?? "尚无框架版本"}{step.diagnostic && " · "+step.diagnostic}</p>)}
        {receipt?.error && <p>{reasons[receipt.error] ?? receipt.error}</p>}
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
