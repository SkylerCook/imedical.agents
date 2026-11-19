import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { frameworkAction } from "./framework-api";
import { GridTable, Notice } from "./ui";

type IndexState = {
  available: boolean; selected: boolean; localObject: boolean; shared: boolean; writable: boolean;
  bytes: number | null; format: "missing" | "readable" | "invalid";
};
type Observation = { projectId: string; status: string; revision: string | null; companyIndex?: IndexState };
type Action = "refresh" | "install-index" | "remove-index";

const messages: Record<string, string> = {
  "deployment-busy": "框架正在执行其他操作，请稍后重试。",
  "index-fetch-failed": "本机缺少索引物料，无法从框架来源取得。联网后可重试。",
  "index-not-in-release": "当前框架版本未提供这份索引。",
  "index-readback-mismatch": "索引操作完成后未通过读回，请重新读取当前状态。",
  "index-readback-recovery-failed": "索引读回和恢复未能确认，请重新读取当前状态。",
  "index-readback-restored": "索引格式未通过检查，已恢复原选装状态。",
  "index-selection-failed": "索引操作未完成，请核对框架工作区和 Git 状态。",
  "index-selection-unavailable": "当前工程无法通过工作台调整索引，请核对框架版本和部署状态。",
  "index-worktree-dirty": "框架检出有未提交修改，请核对 Git 状态后再调整索引。",
  "runtime-modified": "框架运行文件与已验证版本有差异。",
  "stale-observation": "框架版本已变化，请重新读取后重试。",
  "unknown-tree": "当前框架版本尚未通过工作台验证。",
};

export function VectorIndexControls() {
  const [state, setState] = useState<Observation>();
  const [pending, setPending] = useState<Action>();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response = await fetch("/framework.json", {
          headers: { "X-Workbench-Request": "1" }, signal: controller.signal, cache: "no-store",
        });
        if (!response.ok) throw new Error();
        const value: Observation = await response.json();
        setState(value);
        if (value.status === "observing") timer = setTimeout(read, 300);
      } catch {
        if (!controller.signal.aborted) setNotice({ text: "暂时无法读取索引，刷新页面后可重试。", error: true });
      }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  async function apply(action: Action) {
    if (!state || pending) return;
    setPending(action);
    setNotice(undefined);
    try {
      const result = await frameworkAction(action, state.projectId, state.revision);
      if (result.error) {
        if (result.after) setState({ ...result.after, projectId: state.projectId });
        setNotice({ text: messages[result.error] || "索引操作未完成，请重新读取后重试。", error: true });
      } else if (action === "refresh") {
        setState(result);
      } else if (result.exitCode === 0 && result.after?.companyIndex) {
        setState({ ...result.after, projectId: state.projectId });
        setNotice({ text: action === "install-index" ? "分发索引已选装并读回。" : "分发索引已移除并读回。" });
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setNotice({ text: messages[code] || "请求未完成，请从工作台启动器重新打开当前工程。", error: true });
    } finally { setPending(undefined); }
  }

  const index = state?.companyIndex;
  return <div className="space-y-3 text-sm">
    <h4 className="font-medium">公司分发索引</h4>
    {index ? <>
      <GridTable label="公司分发索引状态" headers={["项目", "状态"]} rows={[
        ["当前框架供应", index.available ? "已提供" : "未提供"],
        ["选装", index.selected ? "已选装" : "未选装"],
        ["落盘文件", index.bytes === null ? "未读到文件" : `${Math.round(index.bytes / 1024)} KB`],
        ["索引格式", index.format === "readable" ? "格式可读" : index.format === "invalid" ? "不可用" : "待落盘"],
      ]} />
      {index.shared ? <p className="text-muted-foreground">当前模块使用共享框架索引。请打开所属 standard 根工程选装或移除。</p>
        : !index.writable ? <p className="text-muted-foreground">可从已验证的 standard 稀疏部署调整选装。</p>
        : index.available && !index.localObject && <p className="text-muted-foreground">选装时将从框架来源下载这份索引。</p>}
    </> : <p className="text-muted-foreground">
      {state && state.status !== "observing" ? "未读到分发索引状态。" : "正在读取分发索引…"}
    </p>}
    <div className="flex flex-wrap gap-2">
      {index?.writable && index.available && (!index.selected || index.format === "missing") &&
        <Button type="button" disabled={!!pending} onClick={() => void apply("install-index")}>选装公司索引</Button>}
      {index?.writable && index.selected &&
        <Button type="button" variant="outline" disabled={!!pending} onClick={() => void apply("remove-index")}>移除公司索引</Button>}
      {state && <Button type="button" variant="outline" disabled={!!pending} onClick={() => void apply("refresh")}>重新读取索引</Button>}
    </div>
    {pending && <Notice>正在{pending === "install-index" ? "选装索引" : pending === "remove-index" ? "移除索引" : "读取状态"}。</Notice>}
    {notice && <Notice error={notice.error}>{notice.text}</Notice>}
  </div>;
}
