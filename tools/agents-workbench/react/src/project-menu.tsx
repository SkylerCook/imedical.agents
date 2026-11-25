import { useEffect, useRef, useState } from "react";
import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { frameworkPost } from "./framework-api";

type RecentProject = { id: string; name: string; path: string };
type RecentProjects = { projects: RecentProject[]; currentId?: string };
type OpenProject = { action: "pick" } | { action: "open"; id: string };
type Feedback = { text: string; error?: boolean; address?: string };

const failures: Record<string, string> = {
  "session-required": "请从工作台启动器重新打开当前工程。",
  "binding-mismatch": "当前工程目录已变更，请从启动器重新打开。",
  "project-unavailable": "工程目录已变更或不可访问，请重新选择。",
  "project-picker-busy": "文件夹选择器已打开。",
  "project-pick-unavailable": "文件夹选择器不可用，请从工作台启动器打开工程。",
  "project-startup-failed": "工程工作台启动失败，请检查目录后重试。",
  "project-startup-timeout": "工程工作台启动超时，请重试。",
};

function readyAddress(address: unknown) {
  if (typeof address !== "string") return undefined;
  try {
    const url = new URL(address);
    if (url.protocol === "http:" && url.hostname === "127.0.0.1" && Number(url.port) > 0 &&
      !url.username && !url.password && url.pathname === "/" && !url.search && /^#bootstrap=[a-f0-9]{64}$/.test(url.hash)) {
      return url.href;
    }
  } catch { /* Leave an invalid launch result out of the UI. */ }
}

export function ProjectMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentProjects>();
  const [historyError, setHistoryError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const request = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function readHistory() {
      try {
        const response = await frameworkPost("projects", { action: "list" }, controller.signal);
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.projects)) throw new Error("history-unavailable");
        if (!controller.signal.aborted) setRecent(result);
      } catch {
        if (!controller.signal.aborted) setHistoryError(true);
      }
    }
    void readHistory();
    return () => controller.abort();
  }, [open]);

  useEffect(() => () => request.current?.abort(), []);

  function toggle(next: boolean) {
    if (next) {
      if (request.current) return;
      setHistoryError(false);
      setRecent(undefined);
    }
    setOpen(next);
  }

  async function launch(body: OpenProject) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setOpen(false);
    setBusy(true);
    setFeedback({ text: body.action === "pick" ? "正在选择工程…" : "正在打开工程…" });
    try {
      const response = await frameworkPost("projects", body, controller.signal);
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(result.error);
      switch (result.state) {
        case "cancelled": setFeedback(undefined); break;
        case "current": setFeedback({ text: "已在当前工程。" }); break;
        case "opened": setFeedback({ text: "已在新页签打开工程。" }); break;
        case "ready": {
          const address = readyAddress(result.address);
          if (!address) throw new Error("project-startup-failed");
          setFeedback({ text: "工程已就绪。", address });
          break;
        }
        default: throw new Error("project-startup-failed");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error instanceof Error ? error.message : "";
      const text = Object.hasOwn(failures, code) ? failures[code]
        : code === failures["session-required"] ? code : "暂时无法打开工程，请重试。";
      setFeedback({ text, error: true });
    } finally {
      request.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div className="min-w-0 py-1">
    <h1 className="text-base font-medium">
      <DropdownMenu open={open} onOpenChange={toggle} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" title={name} aria-label={`工程菜单，${name}`} aria-disabled={busy || undefined}
            className="-ml-2 max-w-full justify-start gap-1 px-2 text-base font-medium">
            <span className="min-w-0 truncate">{name}</span><ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" collisionPadding={12} className="w-96 max-w-[calc(100vw_-_2rem)]">
          <DropdownMenuItem onSelect={() => void launch({ action: "pick" })}>
            <FolderOpen aria-hidden="true" /> 打开工程…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">最近打开</DropdownMenuLabel>
          {historyError ? <p className="px-2 pb-2 text-xs text-muted-foreground">无法读取最近工程，可直接选择文件夹。</p>
            : !recent ? <p className="px-2 pb-2 text-xs text-muted-foreground">正在读取最近工程…</p>
            : recent.projects.length === 0 ? <p className="px-2 pb-2 text-xs text-muted-foreground">暂无最近工程。</p>
            : recent.projects.map(project => <DropdownMenuItem key={project.id} textValue={project.name}
              className="items-start py-2" aria-current={project.id === recent.currentId ? "true" : undefined}
              onSelect={() => void launch({ action: "open", id: project.id })}>
              <Folder aria-hidden="true" className="mt-0.5" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{project.name}</span>
                <span className="line-clamp-2 break-all text-xs text-muted-foreground" title={project.path}>{project.path}</span>
              </span>
              {project.id === recent.currentId && <span className="shrink-0 text-xs text-muted-foreground">当前</span>}
            </DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </h1>
    <div role="status" className={!feedback || open ? "sr-only" : `pb-1 text-xs break-words ${feedback.error ? "text-destructive" : "text-muted-foreground"}`}>
      {feedback?.text} {feedback?.address && <a className="underline underline-offset-2" href={feedback.address} target="_blank" rel="noreferrer">打开已就绪的工程</a>}
    </div>
  </div>;
}
