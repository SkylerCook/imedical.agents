import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useResource } from "./api";
import { knowledgeBuildAction, type KnowledgeBuildCommand } from "./framework-api";
import { Notice } from "./ui";

type Binding = { projectId: string; revision: string | null; status: string };
type Plan = {
  planId: string;
  preview: { provider: string; model: string; dimensions: number; chunks: number; transferDirectories: string[];
    pendingVectors: number; estimatedMaximumUsd: number | null; priceDate: string | null; tokenUpperBound: number; providerReady: boolean };
};
type Run = { status: "running"; runId: string; stopRequested?: boolean; progress?: { saved: number; pending: number; embeddingTokens: number } }
  | { status: "complete" | "partial" | "paused"; indexed: number; remainingVectors: number; embeddingTokens: number }
  | { status: "failed"; error: string };

const errors: Record<string, string> = {
  "knowledge-preview-stale": "资料、已缓存向量或连接配置有变化，请重新预览。",
  "knowledge-build-busy": "已有构建正在运行，请等待本轮完成。",
  "knowledge-shutting-down": "工作台正在退出。重新打开后可预览剩余资料。",
  "workbench-shutting-down": "工作台正在退出。重新打开后可预览剩余资料。",
  "knowledge-run-changed": "构建状态已变化，请按重新读取的状态操作。",
  "knowledge-provider-config": "请在模型与 Key 中补齐当前提供方的配置。",
  "knowledge-root-required": "请在所属 standard 工程打开构建。",
  "stale-observation": "框架版本已变化，请重新读取后预览。",
  "busy": "框架正在执行其他操作，请稍后重试。",
};

function describe(error: string) {
  return errors[error] || "操作未完成。请核对知识范围、缓存或提供方配置后重新预览。";
}

async function readBinding(signal: AbortSignal): Promise<Binding> {
  for (;;) {
    const response = await fetch("/framework.json", { signal, cache: "no-store", headers: { "X-Workbench-Request": "1" } });
    if (!response.ok) throw Error("无法读取当前工程的构建状态。");
    const binding: Binding = await response.json();
    if (binding.status !== "observing") return binding;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

export function KnowledgeBuildControls({ onReadback }: { onReadback: () => void }) {
  const { data: binding, error: bindingError, retry } = useResource(readBinding);
  const [plan, setPlan] = useState<Plan>();
  const [run, setRun] = useState<Run>();
  const [action, setAction] = useState<KnowledgeBuildCommand["action"]>();
  const [error, setError] = useState<string>();
  const running = run?.status === "running";
  const finished = !!run && !running;

  useEffect(() => { if (finished) onReadback(); }, [finished, onReadback]);

  useEffect(() => {
    if (!binding || binding.status !== "standard" || action) return;
    const { projectId, revision } = binding;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await knowledgeBuildAction({ action: "status", projectId, revision });
        if (stopped) return;
        setRun(result.run);
        if (result.run?.status === "running") timer = setTimeout(poll, 1200);
      } catch { if (!stopped) setError("无法读取构建进度，请从工作台启动器重新打开当前工程。"); }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [binding, running, action]);

  async function perform(next: KnowledgeBuildCommand) {
    if (!binding || action) return;
    if (next.action === "stop") {
      if (!running || run.runId !== next.runId || run.stopRequested) return;
    } else if (running) return;
    setError(undefined);
    setAction(next.action);
    if (next.action !== "stop") setPlan(undefined);
    try {
      const result = await knowledgeBuildAction({ ...next, projectId: binding.projectId, revision: binding.revision });
      if (next.action === "preview") setPlan(result);
      else setRun(result.run);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(next.action === "stop" && !Object.hasOwn(errors, code)
        ? "暂停请求未确认，请核对构建进度后重试。" : describe(code));
      if (code === "stale-observation") retry();
    } finally { setAction(undefined); }
  }

  if (bindingError) return <Notice error>{bindingError}</Notice>;
  if (!binding) return <Notice>正在读取构建入口。</Notice>;
  if (binding.status !== "standard") return <p className="text-sm text-muted-foreground">向量构建从所属 standard 工程启动。</p>;

  return <section className="space-y-3 text-sm" aria-label="向量构建">
    <h4 className="font-medium">构建与续建</h4>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={!!action || running} onClick={() => void perform({ action: "preview" })}>
        {run?.status === "partial" || run?.status === "paused" || run?.status === "failed" ? "预览续建" : "预览构建"}
      </Button>
      {running && <Button type="button" variant="outline" disabled={!!action || run.stopRequested}
        onClick={() => void perform({ action: "stop", runId: run.runId })}>暂停构建</Button>}
    </div>
    {action === "preview" && <Notice>正在核对资料、授权和缓存。</Notice>}
    {plan && <BuildPlan plan={plan} onStart={() => void perform({ action: "start", planId: plan.planId })} onClose={() => setPlan(undefined)} />}
    {action === "stop" && <Notice>正在提交暂停请求。</Notice>}
    {running && run.stopRequested && <Notice>已请求暂停，当前批次保存后停止。</Notice>}
    {running && <Notice>{run.progress ? `本轮已保存 ${run.progress.saved} / ${run.progress.pending} 条向量。` : "正在检查或构建索引。"}</Notice>}
    {run?.status === "complete" && <Notice>构建完成，已读回 {run.indexed} 个片段，本轮使用 {run.embeddingTokens} tokens。</Notice>}
    {run?.status === "paused" && <Notice>构建已暂停，还有 {run.remainingVectors} 条向量待完成。本轮使用 {run.embeddingTokens} tokens，预览续建时会复用已保存的向量。</Notice>}
    {run?.status === "partial" && <Notice error>构建中断，还有 {run.remainingVectors} 条向量待完成。本轮使用 {run.embeddingTokens} tokens，可预览续建。</Notice>}
    {run?.status === "failed" && <Notice error>{describe(run.error)}</Notice>}
    {error && <Notice error>{error}</Notice>}
  </section>;
}

function BuildPlan({ plan, onStart, onClose }: { plan: Plan; onStart: () => void; onClose: () => void }) {
  const { preview } = plan;
  return <div className="space-y-3 rounded-md border bg-background p-3">
    <p><strong>提供方与模型</strong> {preview.provider} · {preview.model} · {preview.dimensions} 维</p>
    <p><strong>资料</strong> {preview.chunks} 个片段{preview.pendingVectors > 0 ? `，本轮待外发 ${preview.pendingVectors} 个去重片段` : "，本轮无需外发"}</p>
    {preview.transferDirectories.length > 0 && <div>
      <p className="font-medium">本轮外发目录</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 wrap-anywhere">
        {preview.transferDirectories.map(directory => <li key={directory}><code>{directory}</code></li>)}
      </ul>
      <p className="mt-2 text-muted-foreground">
        Token 上界 {preview.tokenUpperBound}，费用{preview.estimatedMaximumUsd === null ? "未知" :
          `估算上界 ${preview.estimatedMaximumUsd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 })}（${preview.priceDate}）`}。
      </p>
    </div>}
    {!preview.providerReady && <Notice error>{errors["knowledge-provider-config"]}</Notice>}
    {preview.chunks === 0 && <Notice>当前工程没有可构建的知识资料。</Notice>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={!preview.providerReady || preview.chunks === 0} onClick={onStart}>
        {preview.pendingVectors > 0 ? "确认范围并开始构建" : "开始本地构建"}
      </Button>
      <Button type="button" variant="outline" onClick={onClose}>关闭预览</Button>
    </div>
  </div>;
}
