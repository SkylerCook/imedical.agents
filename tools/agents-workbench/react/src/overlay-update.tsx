import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openOverlayWorkbench, refreshOverlayWorkbench } from "./framework-api";

type MemberIssue = "member-sources-unready" | "member-layout-unready";
type Member = { id: string; label: string; status: "ready" | "offline" | "needs-verification" | "owner-blocked"; issue?: MemberIssue };

export type OverlayView =
  | { scope: "member"; standardRoot: string | null; planId?: string; issue?: MemberIssue; canRefresh: boolean }
  | { scope: "standard"; error: string }
  | { scope: "standard"; planId: string; members: Member[] };

export type OverlayReceipt = {
  status: "complete" | "partial" | "blocked";
  rootStatus?: "current" | "updated";
  members: {
    id: string;
    label: string;
    status: "complete" | "failed" | "blocked";
    steps: { mode: "DryRun" | "Write" | "Check"; exitCode: number | null; noPull: boolean; diagnostic?: string }[];
  }[];
};

const memberStatus = { ready: "可刷新", offline: "缺席，保留所需能力", "needs-verification": "工程声明待核验", "owner-blocked": "暂不可刷新" };
const issueLabel = { "member-sources-unready": "源码目录或 GitRoot 尚未就绪", "member-layout-unready": "本地或共享目录尚未就绪" };
const resultStatus = { complete: "已刷新并复查", failed: "刷新失败", blocked: "工程身份已变化" };
const modeLabel = { DryRun: "预演", Write: "写入", Check: "复查" };
const ownerDiagnosticLabel: Record<string,string> = {
  "runtime-assets-invalid": "共享运行物料异常，请在标准根检查工程",
  "source-directory-invalid": "源码目录或 GitRoot 尚未就绪",
  "source-path-missing": "找不到已声明的源码入口",
  "shared-path-not-junction": "共享目录入口与声明不符",
  "junction-target-mismatch": "目录链接没有指向声明目标",
  "manifest-invalid": "工作区声明待核验",
  "config-migration-conflict": "本地配置迁移有冲突",
  "thin-index-conflict": "本地技能入口有冲突",
};
type MemberReceipt = { memberUpdate: OverlayReceipt["members"][number]; registered: boolean; error?: string };
const refreshErrors: Record<string,string> = {
  "overlay-target-changed": "工程或共享版本已变化，请重新读取后再试。",
  "overlay-member-unready": "本工程的源码或目录尚未就绪，请核对后重新读取。",
  "deployment-busy": "共享部署正在运行其他操作，请结束后重试。",
  "custom-git-config": "当前工程使用自定义 Git 执行配置，请沿原更新器接续。",
  "overlay-registration-unconfirmed": "本工程已刷新并复查。标准根的成员登记未确认，可重新读取后再试。",
};

export function OverlayUpdateControls({ projectId, revision, overlay, memberIds, disabled, canApply, onSelect, onRefresh, onMemberUpdated }: {
  projectId: string;
  revision: string | null;
  overlay: OverlayView;
  memberIds: string[];
  disabled: boolean;
  canApply: boolean;
  onSelect: (ids: string[]) => void;
  onRefresh: () => void;
  onMemberUpdated: () => void;
}) {
  const [opening,setOpening]=useState<string>();
  const [openError,setOpenError]=useState<string>();
  const [openLink,setOpenLink]=useState<string>();
  const [refreshing,setRefreshing]=useState(false);
  const [refreshResult,setRefreshResult]=useState<MemberReceipt>();
  const [refreshError,setRefreshError]=useState<string>();
  async function openProject(plan:string,member?:string) {
    if (opening) return;
    const tab=window.open("about:blank","_blank");
    if (tab) tab.opener=null;
    setOpening(member ?? "standard");
    setOpenError(undefined);
    setOpenLink(undefined);
    try {
      const {address}=await openOverlayWorkbench(projectId,revision,plan,member);
      if (tab && !tab.closed) tab.location.replace(address);
      else setOpenLink(address);
    } catch (cause) {
      tab?.close();
      setOpenError(cause instanceof Error && cause.message==="overlay-target-changed"
        ? "工程绑定或共享成员登记已变化。请重新读取后再打开。"
        : "目标工作台启动失败。当前窗口可继续使用。");
    } finally { setOpening(undefined); }
  }
  async function refreshProject(plan:string) {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshResult(undefined);
    setRefreshError(undefined);
    try {
      const result:MemberReceipt=await refreshOverlayWorkbench(projectId,revision,plan);
      setRefreshResult(result);
      if (result.error) setRefreshError(refreshErrors[result.error] ?? "本工程刷新未完成。可核对阶段回执后重试。");
      onMemberUpdated();
    } catch (cause) {
      const code=cause instanceof Error ? cause.message : "";
      setRefreshError(refreshErrors[code] ?? "本工程刷新未完成，请重新读取后再试。");
    } finally { setRefreshing(false); }
  }
  const openFeedback=<div role="status" aria-live="polite">
    {openError && <p className="text-destructive">{openError}</p>}
    {openLink && <a className="underline" href={openLink} target="_blank" rel="noreferrer">打开已就绪的项目工作台</a>}
  </div>;
  if (overlay.scope === "member") {
    const {standardRoot,planId,issue,canRefresh}=overlay;
    return <div className="space-y-1 border-t pt-3">
      <p className="font-medium">在共享能力的标准根管理成员更新</p>
      {issue && <p className="text-muted-foreground">{issueLabel[issue]}，本工程暂不可刷新。</p>}
      {standardRoot && planId
        ? <>
          <p><code className="break-all">{standardRoot}</code></p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={disabled || !!opening} onClick={()=>void openProject(planId)}>
              {opening ? "正在打开标准根…" : "打开标准根工作台"}
            </Button>
            {canRefresh && <Button type="button" variant="outline" disabled={disabled || refreshing} onClick={()=>void refreshProject(planId)}>
              {refreshing ? "正在刷新本工程…" : "刷新本工程"}
            </Button>}
          </div>
          {canRefresh && <p className="text-muted-foreground">使用当前共享版本刷新本工程，并在标准根登记。</p>}
        </>
        : <p>请从本工程的 <code>.agents/capability.json</code> 核对 CapabilityRoot，并沿共享能力更新流程接续。</p>}
      {openFeedback}
      <div role="status" aria-live="polite">
        {refreshResult && <ul><MemberUpdateResult member={refreshResult.memberUpdate} /></ul>}
        {refreshResult?.registered && <p>已在标准根登记。</p>}
        {refreshError && <p className="text-destructive">{refreshError}</p>}
      </div>
    </div>;
  }
  if ("error" in overlay) return <p className="text-muted-foreground">共享成员登记暂不可读取。可以继续更新当前工程。</p>;
  if (!overlay.members.length) return null;
  return <fieldset className="space-y-2 border-t pt-3">
    <legend className="font-medium">共享能力的 Overlay 成员</legend>
    <p className="text-muted-foreground">{canApply
      ? "应用时先更新并复查标准根，再逐个刷新所选成员的本地配置和生成入口。"
      : "获取新版后，可随标准根更新刷新所选成员。也可使用当前版本单独刷新成员。"}</p>
    <ul className="space-y-2">
      {overlay.members.map(member => <li key={member.id} className="flex flex-wrap items-center gap-2">
        {member.status === "ready" ?
          <label className="flex items-start gap-2">
            <input className="mt-0.5 size-4 shrink-0" type="checkbox" checked={memberIds.includes(member.id)}
              disabled={disabled}
              onChange={e => onSelect(e.target.checked ? [...memberIds,member.id] : memberIds.filter(id => id !== member.id))} />
            <span className="break-all">{member.label} · {memberStatus[member.status]}</span>
          </label> : <span className="break-all">{member.label} · {member.issue ? issueLabel[member.issue] : memberStatus[member.status]}</span>}
        {(member.status === "ready" || member.status === "owner-blocked") &&
          <Button type="button" size="sm" variant="ghost" disabled={disabled || !!opening}
            aria-label={`打开成员工作台 ${member.label}`} onClick={()=>void openProject(overlay.planId,member.id)}>
            {opening===member.id ? "正在打开…" : "打开工作台"}
          </Button>}
      </li>)}
    </ul>
    {memberIds.length > 0 && <Button variant="outline" disabled={disabled} onClick={onRefresh}>仅刷新所选成员</Button>}
    {openFeedback}
  </fieldset>;
}

function MemberUpdateResult({ member }: { member: OverlayReceipt["members"][number] }) {
  return <li className="break-all">
    {member.label} · {resultStatus[member.status]}
    {member.steps.length > 0 && " · " + member.steps.map(step => `${modeLabel[step.mode]} ${step.exitCode === 0 && step.noPull ? "✓" : "未通过"}`).join("，")}
    {member.steps.some(step=>step.diagnostic) && " · " + member.steps.flatMap(step=>step.diagnostic ? ownerDiagnosticLabel[step.diagnostic] ?? [] : []).join("，")}
  </li>;
}

export function OverlayUpdateResult({ result }: { result: OverlayReceipt }) {
  return <div className="space-y-1">
    {result.rootStatus === "updated" && <p>标准根已应用并复查。</p>}
    {result.members.length > 0 && <ul>
      {result.members.map(member => <MemberUpdateResult key={member.id} member={member} />)}
    </ul>}
    {result.status === "partial" && <p>复核失败成员后，可以仅刷新所选成员。</p>}
  </div>;
}
