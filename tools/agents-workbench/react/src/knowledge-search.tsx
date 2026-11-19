import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice, Panel, selectClass } from "./ui";

type Match = { path: string; line: number; endLine: number; heading: string; text: string };
type SearchResult = { mode: "lexical"; sourcesAvailable: boolean; truncated: boolean; matches: Match[] };
type SearchState = { status: "idle" | "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; result: SearchResult };

export function KnowledgeSearch() {
  const queryId = useId();
  const domainId = useId();
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("all");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = query.trim();
    if (!keyword || state.status === "loading") return;
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    try {
      const response = await fetch("/knowledge/query", {
        method: "POST",
        headers: { "X-Workbench-Request": "1", "Content-Type": "application/json" },
        body: JSON.stringify({ query: keyword, domain }),
        cache: "no-store",
        signal: controller.signal,
      });
      const result: SearchResult & { error?: string } = await response.json();
      if (!response.ok) {
        setState({ status: "failed", message: result.error || "搜索失败，请重试。" });
      } else {
        setState({ status: "ready", result });
      }
    } catch {
      if (!controller.signal.aborted) setState({ status: "failed", message: "无法读取本地搜索结果，请重试。" });
    }
  }

  return <Panel title="本地知识检索">
    <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
      <label className="min-w-40 flex-1 space-y-1.5 text-sm" htmlFor={queryId}>
        <span className="block">关键词</span>
        <Input id={queryId} type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={512} required />
      </label>
      <label className="space-y-1.5 text-sm" htmlFor={domainId}>
        <span className="block">范围</span>
        <select id={domainId} className={selectClass} value={domain} onChange={event => setDomain(event.target.value)}>
          <option value="all">全部知识</option>
          <option value="business">业务知识</option>
          <option value="ui">界面参考</option>
        </select>
      </label>
      <Button type="submit" disabled={!query.trim() || state.status === "loading"}>
        <Search aria-hidden="true" />{state.status === "loading" ? "搜索中…" : "搜索知识"}
      </Button>
    </form>
    {state.status === "loading" && <div className="mt-3"><Notice>正在检索本地资料。</Notice></div>}
    {state.status === "failed" && <div className="mt-3"><Notice error>{state.message}</Notice></div>}
    {state.status === "ready" && <SearchResults result={state.result} />}
  </Panel>;
}

function SearchResults({ result }: { result: SearchResult }) {
  if (!result.sourcesAvailable) {
    return <div className="mt-3"><Notice>此范围没有可检索的资料。请换个范围，或检查工程已安装的知识来源。</Notice></div>;
  }
  if (!result.matches.length) {
    return <div className="mt-3"><Notice>没有匹配内容。请缩短关键词或选择其他范围。</Notice></div>;
  }
  return <div className="mt-4 space-y-3">
    <p role="status" className="text-sm text-muted-foreground">
      本地关键词检索，显示 {result.matches.length} 条结果{result.truncated ? "，可缩小范围查看更多匹配" : ""}。
    </p>
    <ul className="space-y-3">
      {result.matches.map(match => <li key={`${match.path}:${match.line}-${match.endLine}`} className="rounded-md border bg-background px-4 py-3">
        {match.heading && <h4 className="font-medium wrap-anywhere">{match.heading}</h4>}
        <p className="my-1 wrap-anywhere text-xs text-muted-foreground">
          <code>{match.path}</code> 第 {match.line}{match.endLine > match.line ? `–${match.endLine}` : ""} 行
        </p>
        <p className="mt-2 text-sm leading-6 whitespace-pre-wrap wrap-anywhere">{match.text}</p>
      </li>)}
    </ul>
  </div>;
}
