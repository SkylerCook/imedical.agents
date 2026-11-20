import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronRight, ClipboardCopy, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { guideSearchMaxLength, readGuide, readGuideSearch, useResource, type Guide, type GuideSearchResult } from "./api";
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

type GuideContext = { guide: Guide; guides: Guide[]; nav: Navigation };

function guideLink(target: string, { guide, guides, nav }: GuideContext) {
  const base = new URL("/" + guide.source, location.origin);
  let resolved: URL;
  try {
    resolved = new URL(target, base);
  } catch {
    return null;
  }
  if (resolved.origin !== base.origin || resolved.search) return null;
  const linked = guides.find(item => "/" + item.source === decode(resolved.pathname));
  return linked ? href("manual", nav.route.demo, { doc: linked.file, section: decode(resolved.hash.slice(1)) }) : null;
}

function inline(text: string, context: GuideContext): ReactNode[] {
  const tokens = /`([^`]+)`|\*\*([^*]+)\*\*|(!?)\[([^\]]*)]\(([^)]+)\)/g;
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
    } else if (match[3]) {
      parts.push(<span key={index} className="text-muted-foreground">{match[4] || "附图"}（图片未加载）</span>);
    } else {
      const label = match[4], target = match[5].trim();
      const link = guideLink(target, context);
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

function GuideCodeBlock({ text, line }: { text: string; line: number }) {
  const code = useRef<HTMLElement>(null);
  const [message, setMessage] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("已复制代码。");
    } catch {
      const range = document.createRange();
      if (code.current) range.selectNodeContents(code.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      setMessage("剪贴板不可用，可手动复制选中的代码。");
    }
  }

  return <div data-guide-line={line} tabIndex={-1} className="min-w-0 scroll-mt-4 rounded-md border bg-muted">
    {text && <div className="flex flex-wrap items-center justify-end gap-2 px-2 pt-2">
      <span role="status" className="text-xs text-muted-foreground">{message}</span>
      <Button variant="ghost" size="sm" onClick={() => void copy()}><ClipboardCopy aria-hidden="true" />复制代码</Button>
    </div>}
    <pre className="overflow-x-auto p-3 text-xs leading-6"><code ref={code}>{text}</code></pre>
  </div>;
}

function guideMarkup(text: string, guide: Guide, guides: Guide[], nav: Navigation) {
  const lines = text.split(/\r\n|\n|\r/u);
  const ctx = { guide, guides, nav };
  const render = (line: string) => inline(line, ctx);
  const output: ReactNode[] = [];
  const headings = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const start = i, line = lines[i];
    if (!line.trim()) continue;
    if (/^\s*```/.test(line)) {
      const block: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) block.push(lines[i]);
      output.push(<GuideCodeBlock key={start} text={block.join("\n")} line={start + 1} />);
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
      output.push(<Heading key={start} id={id} data-guide-line={start + 1} tabIndex={-1}
        className="scroll-mt-4 pt-2 font-semibold text-foreground">{render(heading[2])}</Heading>);
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
        if (!cells.every(cell => /^[:\s-]+$/.test(cell))) rows.push(cells);
      }
      i--;
      if (rows.length) output.push(<div key={start} data-guide-line={start + 1} tabIndex={-1} className="scroll-mt-4">
        <GridTable label="手册表格" headers={rows[0]} rows={rows.slice(1).map(row => row.map(render))} />
      </div>);
      continue;
    }
    const marker = /^\s*(?:[-*+] |\d+\. )/;
    if (marker.test(line)) {
      const List = /^\s*\d+\./.test(line) ? "ol" : "ul";
      const items: ReactNode[] = [];
      for (; i < lines.length && marker.test(lines[i]); i++) items.push(<li key={i} data-guide-line={i + 1} tabIndex={-1}
        className="scroll-mt-4">{render(lines[i].replace(marker, ""))}</li>);
      i--;
      output.push(<List key={start} className={List === "ol" ? "list-decimal pl-5" : "list-disc pl-5"}>{items}</List>);
      continue;
    }
    output.push(<p key={start} data-guide-line={start + 1} tabIndex={-1} className="scroll-mt-4">{render(line)}</p>);
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

function GuideSearchResults({ query, nav }: { query: string; nav: Navigation }) {
  const [result, setResult] = useState<{ data?: GuideSearchResult; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      readGuideSearch(query, controller.signal).then(
        data => { if (!controller.signal.aborted) setResult({ data }); },
        error => { if (!controller.signal.aborted) setResult({ error: error instanceof Error ? error.message : "暂时无法搜索手册。" }); },
      );
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, attempt]);

  if (!result.data) return <ReadState label={result.error ? "手册搜索失败" : "正在搜索手册…"}
    error={result.error} retry={() => { setResult({}); setAttempt(current => current + 1); }} />;
  const { matches, truncated } = result.data;
  if (!matches.length) return <Empty title="没有匹配内容">可换个关键词，或清空搜索查看手册目录。</Empty>;
  return <>
    <ul aria-label="手册搜索结果" className="divide-y">
      {matches.map(match => {
        const line = String(match.line);
        const active = nav.route.params.get("doc") === match.file && nav.route.params.get("line") === line;
        return <li key={`${match.file}:${line}`}>
          <a href={href("manual", nav.route.demo, { doc: match.file, q: nav.route.params.get("q")?.slice(0, guideSearchMaxLength) ?? query, line })}
            aria-current={active ? "true" : undefined}
            className="block rounded-sm px-2 py-2.5 text-sm wrap-anywhere hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-current:bg-sidebar-accent">
            <span className="block font-medium">{match.title}</span>
            <span className="block text-xs text-muted-foreground">{match.section && `${match.section} · `}第 {line} 行</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{match.excerpt}</span>
          </a>
        </li>;
      })}
    </ul>
    {truncated && <p className="px-2 py-2 text-xs text-muted-foreground">仅显示前 {matches.length} 条结果，可以缩小搜索范围。</p>}
  </>;
}

type GuideHandoff = (title: string, file: string) => void;

function GuideArticle({ guide, guides, nav, onHandoff, handoffPending }: {
  guide: Guide; guides: Guide[]; nav: Navigation; onHandoff: GuideHandoff; handoffPending: boolean;
}) {
  const article = useRef<HTMLElement>(null);
  const fetchGuide = useCallback((signal: AbortSignal) => readGuide(guide.file, signal), [guide.file]);
  const body = useResource(fetchGuide);
  const section = nav.route.params.get("section");
  const line = Number(nav.route.params.get("line"));
  const titleIndex = body.data?.split(/\r\n|\n|\r/u, 3).findIndex(text => /^#\s+/.test(text)) ?? -1;
  const destination = guideDestinations[guide.file];
  useEffect(() => {
    if (!body.data || !article.current) return;
    let target: HTMLElement | null = null;
    if (Number.isSafeInteger(line) && line > 0) {
      let nearest = 0;
      for (const block of article.current.querySelectorAll<HTMLElement>("[data-guide-line]")) {
        const start = Number(block.dataset.guideLine);
        if (start > nearest && start <= line) {
          nearest = start;
          target = block;
        }
      }
    }
    if (!target && section) target = article.current.querySelector<HTMLElement>(`#${CSS.escape(section)}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start" });
  }, [body.data, line, section]);
  return <article ref={article} className="min-w-0 rounded-lg border bg-background">
    <header className="border-b px-4 py-4 sm:px-6">
      <h3 data-guide-line={titleIndex >= 0 ? titleIndex + 1 : undefined} tabIndex={-1}
        className="scroll-mt-4 text-lg font-semibold">{guide.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">{guide.source} · 本地只读</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {destination && <Button asChild variant="outline" size="sm"><a href={href(destination.page, nav.route.demo)}>{destination.label}</a></Button>}
        <Button variant="ghost" size="sm" disabled={handoffPending}
          onClick={() => onHandoff(`按《${guide.title}》核对当前工程`, guide.file)}>生成相关请求</Button>
      </div>
    </header>
    <div className="min-w-0 px-4 py-5 sm:px-6">
      {body.data !== undefined
        ? <div className="guide-content space-y-3 text-sm leading-7 text-foreground">
          {guideMarkup(body.data, guide, guides, nav)}
        </div>
        : <ReadState error={body.error} retry={body.retry} label={body.error ? "手册正文加载失败" : "正在读取本地手册…"} />}
    </div>
  </article>;
}

export function GuideReader({ guides, nav, onHandoff, handoffPending = false }: {
  guides: Guide[]; nav: Navigation; onHandoff: GuideHandoff; handoffPending?: boolean;
}) {
  const query = (nav.route.params.get("q") ?? "").slice(0, guideSearchMaxLength);
  const search = query.trim();
  const selected = nav.route.params.get("doc");
  const chosen = guides.find(guide => guide.file === selected) ?? guides.find(guide => guide.file === "usage-manual.md") ?? guides[0];
  return <>
    <PageHeading title="使用手册" description="查看框架原文、连接配置和插件部署说明。" />
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-lg border bg-muted p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><BookOpen aria-hidden="true" className="size-4" />手册目录</div>
        <SearchField label="搜索手册" placeholder="搜索标题或正文"
          value={query} onChange={q => nav.replace({ q: q.slice(0, guideSearchMaxLength) })} />
        <div className="mt-2 max-h-[42vh] overflow-y-auto lg:max-h-[65vh]">
          {search ? <GuideSearchResults key={search} query={search} nav={nav} /> : <GuideList guides={guides} nav={nav} active={chosen?.file} />}
        </div>
      </aside>
      {chosen ? <GuideArticle key={chosen.file} guide={chosen} guides={guides} nav={nav}
        onHandoff={onHandoff} handoffPending={handoffPending} />
        : <Empty title="手册目录为空">请核对运行包的 docs/guides。</Empty>}
    </div>
  </>;
}
