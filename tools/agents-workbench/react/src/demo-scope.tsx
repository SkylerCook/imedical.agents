import { useState, type FormEvent } from "react";
import { ArrowRight, Database, Link2, Settings2, Shapes, Wrench } from "lucide-react";
import { domains } from "../../prototype/scope.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Details, Empty, GridTable, Notice, PageHeading, SearchField, selectClass, Status, textareaClass, WorkbenchDialog } from "./ui";
import type { Navigation } from "./routes";

const domainList = domains.map(([id, title, scope, specs, source, flow]) => ({
  id, title, scope, source, flow,
  fields: specs.split("|").map(spec => {
    const [label, list] = spec.split(":");
    return { label: label.replace(/!$/, ""), secret: label.endsWith("!"), choices: list?.split(",") };
  }),
}));
const groups = [
  { title: "工程配置", icon: Settings2, ids: ["identity", "iris", "web", "profiles"] },
  { title: "连接与客户端", icon: Link2, ids: ["mcp", "hosts", "bos"] },
  { title: "知识与资料", icon: Database, ids: ["sources", "embedding", "vectors"] },
  { title: "接入与维护", icon: Wrench, ids: ["install", "update", "recovery", "backup"] },
];

export function ScopeActions({ ids, nav }: { ids: string[]; nav: Navigation }) {
  return <div className="flex flex-wrap gap-2">
    {domainList.filter(domain => ids.includes(domain.id)).map(domain => <Button key={domain.id} variant="outline" size="sm"
      onClick={() => nav.replace({ domain: domain.id })}>{domain.title}</Button>)}
  </div>;
}

export function DemoScope({ nav }: { nav: Navigation }) {
  const query = nav.route.params.get("q") ?? "";
  const matching = domainList.filter(domain => [domain.title, domain.scope, ...domain.fields.map(field => field.label)]
    .join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <PageHeading title="完整工作台能力" description="选择能力，查看配置字段、影响范围和接续路径。" />
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div className="w-full sm:max-w-80"><SearchField label="搜索能力" placeholder="搜索能力或字段" value={query}
        onChange={q => nav.replace({ q })} /></div>
      <span role="status" className="text-sm tabular-nums text-muted-foreground">{matching.length} 项能力</span>
    </div>
    {matching.length ? <div className="grid min-w-0 items-start gap-x-6 gap-y-5 lg:grid-cols-2">
      {groups.map(({ title, icon: Icon, ids }) => {
        const items = ids.flatMap(id => matching.find(domain => domain.id === id) ?? []);
        if (!items.length) return null;
        return <section key={title} className="min-w-0 border-t">
          <h3 className="flex items-center gap-2 px-2 py-3 font-medium"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{title}</h3>
          <ul className="divide-y rounded-lg border bg-muted">
            {items.map(domain => <li key={domain.id}>
              <button type="button" className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-sm px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`查看与配置：${domain.title}`} onClick={() => nav.replace({ domain: domain.id })}>
                <strong className="font-medium">{domain.title}</strong>
                <ArrowRight aria-hidden="true" className="size-4 justify-self-end text-muted-foreground" />
                <span className="col-start-1 min-w-0 truncate text-xs text-muted-foreground">
                  {domain.fields.slice(0, 3).map(field => field.label).join(" · ")}
                </span>
                <span className="col-start-2 text-xs text-muted-foreground">{domain.scope}</span>
              </button>
            </li>)}
          </ul>
        </section>;
      })}
    </div> : <Empty title="未找到匹配的能力"><Button variant="outline" onClick={() => nav.replace({ q: undefined })}>清除搜索</Button></Empty>}
  </>;
}

export function DemoScopeDialog({ id, project, onClose }: { id: string; project: string; onClose: () => void }) {
  const [values, setValues] = useState<string[]>();
  const [copied, setCopied] = useState("");
  const domain = domainList.find(item => item.id === id);
  if (!domain) return <WorkbenchDialog title="能力未找到" description="请从能力目录重新选择。" onClose={onClose} />;
  const prompt = `工程：${project}（演示）\n目标：${domain.title}\n来源：${domain.source}\n步骤：${domain.flow}\n先核对来源、差异和作用域，保护凭据。共享配置与远端写入须由用户确认。完成后读回验证。`;
  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setValues(domain!.fields.map((_, index) => String(form.get(`scope-${index}`) || "未填写 / 保留")));
  }
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setCopied("已复制，执行后需返回检查。"); }
    catch { setCopied("剪贴板不可用，可手动复制。"); }
  }
  return <WorkbenchDialog title={values ? "操作影响与下一步" : domain.title}
    description={`${project} · ${domain.scope} · 交互演示`} onClose={onClose}
    actions={values ? <><Button variant="outline" onClick={() => setValues(undefined)}>返回编辑</Button><Button onClick={copy}>复制接续请求</Button></>
      : <Button type="submit" form="scope-form">预览影响</Button>}>
    {values ? <>
      <Notice>本次预览仅用于核对交互。请求中省略表单值。</Notice>
      <GridTable label="演示输入" headers={["字段", "演示意图"]} rows={domain.fields.map((field, index) => [field.label, values[index]])} />
      <p className="text-muted-foreground">{domain.flow}</p>
      <textarea aria-label="计划能力交接请求" className={textareaClass} value={prompt} rows={6} readOnly />
      {copied && <Notice>{copied}</Notice>}
    </> : <>
      <Notice>{domain.scope.includes("共享") ? "共享范围涉及所有引用同一个人来源的工程。" : "这是交互样例，请使用虚构值。"} </Notice>
      <form id="scope-form" onSubmit={preview} autoComplete="off" className="grid gap-4 sm:grid-cols-2">
        {domain.fields.map((field, index) => {
          const key = `scope-${index}`;
          const choices = field.secret ? ["保留现有值", "模拟替换", "显式清除"] : field.choices;
          return <label htmlFor={key} key={key} className="grid min-w-0 gap-2">{field.label}
            {choices ? <select id={key} name={key} className={selectClass}>{choices.map(choice => <option key={choice}>{choice}</option>)}</select>
              : <Input id={key} name={key} placeholder="输入演示值" maxLength={200} />}
          </label>;
        })}
      </form>
      <Details title={<span className="flex items-center gap-2"><Shapes aria-hidden="true" className="size-4" />来源与执行边界</span>}>
        <p className="break-all">{domain.source}</p><p className="text-muted-foreground">{domain.flow}</p>
      </Details>
    </>}
  </WorkbenchDialog>;
}
