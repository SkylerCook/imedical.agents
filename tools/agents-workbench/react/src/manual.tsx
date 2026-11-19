import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { BookOpen, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readGuide, useResource, type Guide } from "./api";
import { href, type Navigation, type Page } from "./routes";
import { Empty, GridTable, PageHeading, ReadState, SearchField } from "./ui";

const slug = (text: string) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s+/g, "-");
const decode = (text: string) => { try { return decodeURIComponent(text); } catch { return text; } };
const guideDestinations: Record<string, { page: Page; label: string }> = {
  "connection-configuration.md": { page: "connections", label: "打开 MCP 与连接" },
  "iris-managed-sessions.md": { page: "config", label: "打开工程配置" },
  "plugin-deployment.md": { page: "plugins", label: "打开插件页" },
  "knowledge-retrieval.md": { page: "knowledge", label: "打开知识与向量" },
  "imedical-knowledge.md": { page: "knowledge", label: "打开知识与向量" },
  "capability-catalog.md": { page: "scope", label: "打开能力目录" },
};

function inline(text: string, context: { file: string; guides: Guide[]; nav: Navigation }): ReactNode[] {
  const tokens = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)]\(([^)]+)\)/g;
  const parts: ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index;
    parts.push(text.slice(end, index));
    end = index + match[0].length;
    if (match[1]) {
      parts.push(<code key={index} className="rounded bg-accent px-1 py-0.5 text-xs wrap-anywhere">{match[1]}</code>);
    } else if (match[2]) {
      parts.push(<strong key={index} className="font-semibold text-foreground">{match[2]}</strong>);
    } else {
      const label = match[3], target = match[4].trim();
      const [path, anchor] = target.split("#", 2);
      const file = decode(path.replace(/^\.\//, "")) || context.file;
      const link = context.guides.some(guide => guide.file === file)
        ? href("manual", context.nav.route.demo, { doc: file, section: anchor && decode(anchor) }) : null;
      if (link) {
        parts.push(<a key={index} href={link} className="text-foreground underline decoration-muted-foreground underline-offset-4 hover:decoration-foreground">{label}</a>);
      } else if (/^https:\/\/[^\s]+$/i.test(target)) {
        parts.push(<a key={index} href={target} rel="noopener noreferrer" target="_blank" className="text-foreground underline decoration-muted-foreground underline-offset-4">
          {label}<ExternalLink aria-label="在新标签页打开外部文档" className="ml-1 inline size-3" />
        </a>);
      } else {
        parts.push(<span key={index}>{label} <small className="text-muted-foreground wrap-anywhere">（{target}）</small></span>);
      }
    }
  }
  parts.push(text.slice(end));
  return parts;
}

function guideMarkup(text: string, file: string, guides: Guide[], nav: Navigation) {
  const lines = text.split(/\r?\n/);
  const ctx = { file, guides, nav };
  const render = (line: string) => inline(line, ctx);
  const output: ReactNode[] = [];
  const headings = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const start = i, line = lines[i];
    if (!line.trim()) continue;
    if (/^\s*```/.test(line)) {
      const block: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) block.push(lines[i]);
      output.push(<pre key={start} className="overflow-x-auto rounded-md border bg-muted p-3 text-xs leading-6"><code>{block.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const base = slug(heading[2]);
      const index = headings.get(base) ?? 0;
      headings.set(base, index + 1);
      const id = index ? `${base}-${index}` : base;
      if (heading[1] === "#" && start < 3) continue;
      const Heading = heading[1].length <= 2 ? "h4" : "h5";
      output.push(<Heading key={start} id={id} className="scroll-mt-4 pt-2 font-semibold text-foreground">{render(heading[2])}</Heading>);
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
        if (!cells.every(cell => /^[:\s-]+$/.test(cell))) rows.push(cells);
      }
      i--;
      if (rows.length) output.push(<GridTable key={start} label="手册表格" headers={rows[0]}
        rows={rows.slice(1).map(row => row.map(render))} />);
      continue;
    }
    const marker = /^\s*(?:[-*+] |\d+\. )/;
    if (marker.test(line)) {
      const List = /^\s*\d+\./.test(line) ? "ol" : "ul";
      const items: ReactNode[] = [];
      for (; i < lines.length && marker.test(lines[i]); i++) items.push(<li key={i}>{render(lines[i].replace(marker, ""))}</li>);
      i--;
      output.push(<List key={start} className={List === "ol" ? "list-decimal pl-5" : "list-disc pl-5"}>{items}</List>);
      continue;
    }
    output.push(<p key={start}>{render(line)}</p>);
  }
  return output;
}

export const searchGuides = (guides: Guide[], query: string) => guides.filter(guide =>
  `${guide.title} ${guide.file}`.toLowerCase().includes(query.trim().toLowerCase()));

export function GuideList({ guides, nav, active }: { guides: Guide[]; nav: Navigation; active?: string }) {
  return guides.length ? <ul className="divide-y">
    {guides.map(guide => <li key={guide.file}>
      <a href={href("manual", nav.route.demo, { doc: guide.file })}
        aria-current={active === guide.file ? "true" : undefined}
        className="flex items-center gap-2 rounded-sm px-2 py-2.5 text-sm wrap-anywhere hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-current:bg-sidebar-accent">
        <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">{guide.title}</span>
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </a>
    </li>)}
  </ul> : <Empty title="没有匹配资料">调整关键词后重试。</Empty>;
}

function GuideArticle({ guide, guides, nav, query, onHandoff }: {
  guide: Guide; guides: Guide[]; nav: Navigation; query: string; onHandoff: (title: string) => void;
}) {
  const fetchGuide = useCallback((signal: AbortSignal) => readGuide(guide.file, signal), [guide.file]);
  const body = useResource(fetchGuide);
  const section = nav.route.params.get("section");
  const destination = guideDestinations[guide.file];
  useEffect(() => {
    if (body.data && section) document.getElementById(section)?.scrollIntoView({ block: "start" });
  }, [body.data, section]);
  return <article className="min-w-0 rounded-lg border bg-background">
    <header className="border-b px-4 py-4 sm:px-6">
      <h3 className="text-lg font-semibold">{guide.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">docs/guides/{guide.file} · 本地只读</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {destination && <Button asChild variant="outline" size="sm"><a href={href(destination.page, nav.route.demo)}>{destination.label}</a></Button>}
        <Button variant="ghost" size="sm" onClick={() => onHandoff(`按《${guide.title}》核对当前工程`)}>生成相关请求</Button>
      </div>
    </header>
    <div className="min-w-0 px-4 py-5 sm:px-6">
      {body.data !== undefined
        ? <div className="guide-content space-y-3 text-sm leading-7 text-foreground">
          {query && nav.route.demo && <p role="status" className="font-medium text-foreground">
            {body.data.toLowerCase().includes(query.toLowerCase()) ? "当前正文中有匹配" : "当前正文无匹配"}
          </p>}
          {guideMarkup(body.data, guide.file, guides, nav)}
        </div>
        : <ReadState error={body.error} retry={body.retry} label={body.error ? "手册正文加载失败" : "正在读取本地手册…"} />}
    </div>
  </article>;
}

export function GuideReader({ guides, nav, onHandoff }: { guides: Guide[]; nav: Navigation; onHandoff: (title: string) => void }) {
  const query = nav.route.params.get("q") ?? "";
  const selected = nav.route.params.get("doc");
  const chosen = guides.find(guide => guide.file === selected) ?? guides.find(guide => guide.file === "usage-manual.md") ?? guides[0];
  const filtered = useMemo(() => searchGuides(guides, query), [guides, query]);
  return <>
    <PageHeading title="使用手册" description="查看框架原文、连接配置和插件部署说明。" />
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-lg border bg-muted p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><BookOpen aria-hidden="true" className="size-4" />手册目录</div>
        <SearchField label="搜索手册" placeholder={nav.route.demo ? "搜索标题或当前正文" : "筛选标题或文件名"}
          value={query} onChange={q => nav.replace({ q })} />
        <div className="mt-2 max-h-[42vh] overflow-y-auto lg:max-h-[65vh]"><GuideList guides={filtered} nav={nav} active={chosen?.file} /></div>
      </aside>
      {chosen ? <GuideArticle key={chosen.file} guide={chosen} guides={guides} nav={nav} query={query} onHandoff={onHandoff} />
        : <Empty title="手册目录为空">请核对运行包的 docs/guides。</Empty>}
    </div>
  </>;
}
