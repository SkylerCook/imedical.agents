import { useState } from "react";
import { Button } from "@/components/ui/button";
import { workbenchReleaseAction } from "./framework-api";
import { Notice } from "./ui";

const reasons: Record<string, string> = {
  "release-not-newer": "请选择高于当前工作台版本的发布包。",
  "release-record-invalid": "请选择随工作台 ZIP 发放的工作台发行记录（JSON）。",
  "release-selection-changed": "发行记录在导入期间发生变化，请重新选择。",
  "release-picker-unavailable": "无法打开 Windows 文件选择窗口。请从工作台启动器重新打开当前工程。",
  "import-failed": "校验或导入失败。请核对可信渠道提供的 ZIP 和包外发行记录。",
  "release-directory-exists": "同名版本目录与可信发行包不一致，原目录已保留。可在新的安装位置解压可信包。",
  "release-changed": "本地版本文件发生变化，请核对发放渠道的发布包。",
  "release-rollback-unavailable": "当前没有可恢复的旧版。请重新读取工程。",
  "release-rollback-failed": "无法恢复旧版默认设置，可继续使用当前工作台。",
  "startup-failed": "候选工作台启动失败，可继续使用当前工作台。",
  "startup-timeout": "候选工作台在限时内未就绪，可继续使用当前工作台。",
  "project-not-ready": "候选工作台未能绑定当前工程。",
  "interface-unavailable": "候选工作台界面未通过读取检查。",
  "stale-observation": "工程版本已变化，请重新读取。",
  "binding-changed": "工程目录身份已变化，请从启动器重新绑定。",
  "knowledge-build-busy": "请等待正在运行的知识构建结束。",
  busy: "当前工程正在执行其他操作，请稍后重试。",
};

export function ReleaseUpdateControls({ projectId, revision, disabled, canRollback, onRollbackChanged }: {
  projectId: string;
  revision: string | null;
  disabled: boolean;
  canRollback: boolean;
  onRollbackChanged: (value: boolean) => void;
}) {
  const [pending, setPending] = useState<"open" | "rollback">();
  const [result, setResult] = useState<{ version: string; address: string; selectionSaved: boolean; restored: boolean }>();
  const [error, setError] = useState<string>();

  async function choose(action: "open" | "rollback") {
    if (disabled || pending) return;
    setPending(action);
    setResult(undefined);
    setError(undefined);
    try {
      const selected = await workbenchReleaseAction(action, projectId, revision);
      if (!("cancelled" in selected)) {
        setResult({ ...selected, restored: action === "rollback" });
        onRollbackChanged(selected.canRollback);
      }
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(reasons[code] ?? "版本切换未完成，可继续使用当前工作台。");
    } finally {
      setPending(undefined);
    }
  }

  return <section className="space-y-2 border-t pt-3" aria-labelledby="workbench-release-update">
    <h5 id="workbench-release-update" className="font-medium">更新工作台</h5>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={disabled || !!pending} onClick={() => void choose("open")}>
        {pending === "open" ? "正在选择或核验发布包…" : "导入工作台新版"}
      </Button>
      {canRollback && <Button type="button" variant="outline" disabled={disabled || !!pending} onClick={() => void choose("rollback")}>
        {pending === "rollback" ? "正在启动旧版…" : "恢复旧版工作台"}
      </Button>}
    </div>
    {result && <div className="space-y-2">
      <Notice>工作台 {result.version} 已通过启动及工程绑定检查。{result.selectionSaved
        ? "下次从原启动器进入此工程时使用该版本。" : "默认版本保存失败，本次仍可打开已验证的新版。"}</Notice>
      <Button asChild><a href={result.address} target="_blank" rel="noreferrer">{result.restored ? "打开旧版工作台" : "打开新版工作台"}</a></Button>
    </div>}
    {error && <Notice error>{error}</Notice>}
  </section>;
}
