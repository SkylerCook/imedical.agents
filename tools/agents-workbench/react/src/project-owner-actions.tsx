import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { frameworkAction } from "./framework-api";

type Operation = "inspect" | "install" | "enable" | "disable";
type PluginState = { installed:boolean; status:string; added:string[]; dependencies:string[]; requiredBy:string[]; missing:string[]; initialization:string|null; discoveryChecked?:boolean };
type OwnerAction = "verify-connection" | "discover-iris-mcp" | `plugin-${Operation}:${string}`;
type IrisCatalog = {profile:string; tools:string[]; processExited:boolean; backendPresent:boolean; checkedAt:string};
const errors:Record<string,string>={
  "unknown-tree":"当前框架版本尚未纳入工作台的执行范围。",
  "runtime-modified":"本地框架文件与已验证版本不一致。",
  "profile-required":"请先在工程配置中选择开发库档案。",
  "profile-owner-unavailable":"当前框架尚未提供档案核验回执。",
  "connection-handoff":"工程使用自定义 MCP 启动方式，请交给 Agent 核验。",
  "connection-check-failed":"原核验入口未成功。请核对开发模式、客户端连接和目标可达性，再重试。",
  "connection-check-stale":"核验期间目标或回执发生变化，请重新核验。",
  "mcp-discovery-binding-required":"当前档案未绑定 MCP 或配置已有冲突。请先在工程配置核对档案。",
  "mcp-discovery-handoff":"当前入口未识别为已迁移的受管适配器。可从框架更新迁移已知入口，或交给 Agent 核对。",
  "mcp-discovery-disabled":"当前工程已禁用此 MCP 服务。",
  "mcp-discovery-program-missing":"当前框架缺少可核验的受管适配器、程序或工具入口。",
  "mcp-discovery-failed":"未能从本机受管适配器读取工具。",
  "mcp-discovery-exit-unverified":"本次适配器进程的正常退出尚未确认。",
  "plugin-owner-failed":"原插件命令未完成。请核对工程改动、依赖与安装来源，再重试。",
  "plugin-checkout-dirty":"能力包检出目录已有修改。请先处理该目录的改动，再补装插件。",
  "plugin-catalog-mismatch":"插件文件与本版本目录不一致，请检查框架来源。",
  "plugin-materialization-failed":"Git 未能取齐插件文件，请核对安装来源与可达性后重试。",
  "plugin-action-conflict":"插件或依赖状态已变化，请重新读取管理预览。",
  "plugin-discovery-pending":"插件状态已写入，实际发现入口仍需核对。",
  "deployment-busy":"框架正在执行另一项操作，请稍后重试。",
  "busy":"工作台正在执行另一项操作，请稍后重试。",
  "unsupported-project":"当前工程类型需要 Agent 接续。",
  "owner-action-unavailable":"当前工程的配置或原执行入口无法读取。"
};
async function invoke(action:OwnerAction, signal?:AbortSignal) {
  const response=await fetch("/framework.json",{headers:{"X-Workbench-Request":"1"},cache:"no-store",signal});
  if (!response.ok) throw Error("工程身份读取失败");
  let state=await response.json();
  signal?.throwIfAborted();
  if (state.status==="observing") state=await frameworkAction("refresh",state.projectId,state.revision);
  signal?.throwIfAborted();
  const result=await frameworkAction(action,state.projectId,state.revision);
  if(result.error) throw Error(errors[result.error] || "操作未完成，请重新读取工程状态。");
  return result;
}
export function VerifyConnection({handoff,initial}:{handoff:()=>void;initial?:string}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[failed,setFailed]=useState(false);
  async function verify() {
    setBusy(true);setFailed(false);setMessage("");
    try {
      const {connection}=await invoke("verify-connection");
      setFailed(!connection.verified);
      setMessage(connection.verified ? "IRIS MCP 已核验档案 "+connection.profile+" · "+new Date(connection.checkedAt).toLocaleString() : "已执行核验，返回的连接状态或目标与所选档案不符。");
    } catch(e) {setFailed(true);setMessage(e instanceof Error?e.message:"核验失败");}
    finally {setBusy(false);}
  }
  return <div className="space-y-2"><Button type="button" variant="outline" disabled={busy} onClick={verify}>{busy?"正在核验…":"核验当前连接"}</Button>
    {(message || initial) && <p role="status">{message || initial}</p>}{failed && <Button type="button" variant="ghost" onClick={handoff}>生成连接核验请求</Button>}</div>;
}

export function DiscoverIrisTools({handoff}:{handoff:()=>void}) {
  const [busy,setBusy]=useState(false),[catalog,setCatalog]=useState<IrisCatalog>(),[error,setError]=useState("");
  async function discover() {
    setBusy(true);setCatalog(undefined);setError("");
    try { setCatalog((await invoke("discover-iris-mcp")).discovery); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "工具发现未完成"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <Button type="button" variant="outline" disabled={busy} onClick={discover}>
      {busy ? "正在读取受管 IRIS 工具…" : "发现受管 IRIS 工具"}
    </Button>
    {catalog && <details>
      <summary>受管适配器返回的工具（{catalog.tools.length}）</summary>
      <p className="text-sm text-muted-foreground" role="status">档案 {catalog.profile} · {catalog.processExited && "本次适配器已正常退出 · "}{new Date(catalog.checkedAt).toLocaleString()}</p>
      <p className="text-sm text-muted-foreground">后端程序{catalog.backendPresent ? "已找到" : "待部署"}</p>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">{catalog.tools.map(tool=><li key={tool}><code>{tool}</code></li>)}</ul>
    </details>}
    {error && <><p role="status">{error}</p><Button type="button" variant="ghost" onClick={handoff}>生成 MCP 核对请求</Button></>}
  </div>;
}

export function PluginActions({name,onChange,onInit}:{name:string;onChange:()=>void;onInit:(source:string)=>void}) {
  const [state,setState]=useState<PluginState>(),[message,setMessage]=useState(""),[busy,setBusy]=useState(true);
  const [confirm,setConfirm]=useState<Operation>();
  useEffect(()=>{
    const c=new AbortController();
    invoke(`plugin-inspect:${name}`,c.signal).then(r=>{if(!c.signal.aborted)setState(r.plugin);})
      .catch(e=>{if(!c.signal.aborted)setMessage(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
    return ()=>c.abort();
  },[name]);
  async function run(operation:Operation) {
    setConfirm(undefined);setBusy(true);setMessage("");
    try {
      const r=await invoke(`plugin-${operation}:${name}`);setState(r.plugin);
      if(operation!=="inspect"){setMessage(operation==="install"?"插件及依赖已补装并读回。":"插件状态与发现入口已读回。");onChange();}
    } catch(e){setMessage(e instanceof Error?e.message:"插件操作失败");}
    finally{setBusy(false);}
  }
  const label=confirm==="install"?"补装":confirm==="enable"?"启用":"停用";
  return <section className="mt-4 space-y-2"><h3 className="font-semibold">当前工程操作</h3>
    {busy && <p role="status">正在读取或更新工程…</p>}
    {state && <p>{state.installed?"已安装":"待补装"} · {({enabled:"已启用",available:"待启用",disabled:"已停用"})[state.status] || state.status}</p>}
    {confirm ? <><p>确认{label} {name}{confirm==="install" && state?.added.length ? "（含 "+state.added.join("、")+"）":""}？</p><Button type="button" onClick={()=>run(confirm)}>确认{label}</Button> <Button type="button" variant="outline" onClick={()=>setConfirm(undefined)}>取消</Button></> :
    !busy && <div className="flex flex-wrap gap-2">
      {state && (!state.installed || state.added.length>0) && <Button type="button" onClick={()=>setConfirm("install")}>补装插件与依赖</Button>}
      {state?.installed && state.status!=="enabled" && (state.initialization || state.dependencies.length || state.missing.length ?
        <Button type="button" onClick={()=>onInit([state.initialization,...state.dependencies,...state.missing].filter(Boolean).join("、"))}>接续初始化</Button> :
        <Button type="button" onClick={()=>setConfirm("enable")}>启用插件</Button>)}
      {state?.status==="enabled" && (state.requiredBy.length ? <p>仍被已启用插件引用：{state.requiredBy.join("、")}</p>:<Button type="button" variant="outline" onClick={()=>setConfirm("disable")}>停用插件</Button>)}
      {!state && <Button type="button" variant="outline" onClick={()=>onInit("plugin-management，先核对本工程的框架来源、插件清单和可复用入口")}>生成插件管理请求</Button>}
      <Button type="button" variant="ghost" onClick={()=>run("inspect")}>重读插件状态</Button>
    </div>}{message && <p role="status">{message}</p>}</section>;
}
