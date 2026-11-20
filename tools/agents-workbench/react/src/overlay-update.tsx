import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openOverlayWorkbench } from "./framework-api";

type MemberIssue = "member-sources-unready" | "member-layout-unready";
type Member = { id: string; label: string; status: "ready" | "offline" | "needs-verification" | "owner-blocked"; issue?: MemberIssue };

export type OverlayView =
  | { scope: "member"; standardRoot: string | null; planId?: string; issue?: MemberIssue }
  | { scope: "standard"; error: string }
  | { scope: "standard"; planId: string; members: Member[] };

const memberStatus = { ready: "已核验", offline: "暂不可用", "needs-verification": "工程声明待核验", "owner-blocked": "目录待核验" };
const issueLabel = { "member-sources-unready": "源码目录或 GitRoot 尚未就绪", "member-layout-unready": "本地或共享目录尚未就绪" };

export function OverlayProjectLinks({ projectId, revision, overlay, disabled }: {
  projectId: string;
  revision: string | null;
  overlay: OverlayView;
  disabled: boolean;
}) {
  const [opening,setOpening]=useState<string>();
  const [openError,setOpenError]=useState<string>();
  const [openLink,setOpenLink]=useState<string>();
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
  const openFeedback=<div role="status" aria-live="polite">
    {openError && <p className="text-destructive">{openError}</p>}
    {openLink && <a className="underline" href={openLink} target="_blank" rel="noreferrer">打开已就绪的项目工作台</a>}
  </div>;
  if (overlay.scope === "member") {
    const {standardRoot,planId,issue}=overlay;
    return <div className="space-y-2 border-t pt-3">
      <p className="font-medium">所属标准根</p>
      {issue && <p className="text-muted-foreground">{issueLabel[issue]}。</p>}
      {standardRoot && planId
        ? <>
          <p><code className="break-all">{standardRoot}</code></p>
          <Button type="button" variant="outline" disabled={disabled || !!opening} onClick={()=>void openProject(planId)}>
            {opening ? "正在打开标准根…" : "打开标准根工作台"}
          </Button>
        </>
        : <p className="text-muted-foreground">请使用更新提示词核对本工程声明的 CapabilityRoot。</p>}
      {openFeedback}
    </div>;
  }
  if ("error" in overlay) return <p className="text-muted-foreground">共享成员登记暂不可读取。</p>;
  if (!overlay.members.length) return null;
  return <div className="space-y-2 border-t pt-3">
    <p className="font-medium">共享能力的 Overlay 成员</p>
    <ul className="space-y-2">
      {overlay.members.map(member => <li key={member.id} className="flex flex-wrap items-center gap-2">
        <span className="break-all">{member.label} · {member.issue ? issueLabel[member.issue] : memberStatus[member.status]}</span>
        {(member.status === "ready" || member.status === "owner-blocked") &&
          <Button type="button" size="sm" variant="ghost" disabled={disabled || !!opening}
            aria-label={`打开成员工作台 ${member.label}`} onClick={()=>void openProject(overlay.planId,member.id)}>
            {opening===member.id ? "正在打开…" : "打开工作台"}
          </Button>}
      </li>)}
    </ul>
    {openFeedback}
  </div>;
}
