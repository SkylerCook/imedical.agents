import { useRef } from "react";
import { ChevronDown, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { filterPlugins, pluginStatus } from "../../prototype/plugin-directory.mjs";
import { readCatalog, useResource, type ProjectSummary } from "./api";
import { PluginActions } from "./project-owner-actions";
import { PluginPreview, PluginTable } from "./plugins";
import { href, type Navigation } from "./routes";
import { Details, Notice, PageHeading, ReadState, SearchField } from "./ui";

const states = ["all", "enabled", "available", "disabled", "pending", "unknown"];
const stateLabel = (state: string) => state === "all" ? "全部状态" : pluginStatus(state);

export function PluginsPage({ project, nav, onHandoff, refresh }: {
  project: ProjectSummary; nav: Navigation; refresh:()=>void; onHandoff: (name: string) => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const catalog = useResource(readCatalog);
  const query = nav.route.params.get("q") ?? "";
  const state = nav.route.params.get("state") ?? "all";
  const filter = states.includes(state) ? state : "all";
  const preview = nav.route.params.get("preview") ?? "";
  const profile = new Map(project.plugins.map(plugin => [plugin.name, plugin.status]));
  const heading = <PageHeading title="插件" description="查看当前工程的启用状态，以及源仓中的版本与依赖。" />;
  if (!catalog.data) return <>{heading}<ReadState label={catalog.error ? "无法读取插件目录" : "正在读取插件目录…"}
    error={catalog.error} retry={catalog.retry} /></>;
  const data = catalog.data;
  const visible = filterPlugins(data.plugins, query).filter(plugin => {
    const status = profile.get(plugin.name);
    if (filter === "all") return true;
    return filter === "unknown" ? !status || !states.includes(status) : status === filter;
  });
  const target = data.plugins.find(plugin => plugin.name === preview && !data.basePlugins.includes(plugin.name));
  const configHref = href("config");
  return <>
    {heading}
    {project.pluginIssue && <div className="mb-4"><Notice error>{project.pluginIssue}</Notice></div>}
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 sm:w-64 sm:flex-none"><SearchField inputRef={search} label="搜索插件" placeholder="搜索名称、标识或用途"
        value={query} onChange={q => nav.replace({ q, preview: undefined })} /></div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label={`筛选工程状态：${stateLabel(filter)}`}>
            <ListFilter aria-hidden="true" /> {stateLabel(filter)} <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={filter} onValueChange={state => nav.replace({ state: state === "all" ? undefined : state, preview: undefined })}>
            {states.map(state => <DropdownMenuRadioItem key={state} value={state}>{stateLabel(state)}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p role="status" className="ml-auto text-sm text-muted-foreground tabular-nums">
        {visible.length === data.plugins.length ? `共 ${visible.length} 项` : `${visible.length} / ${data.plugins.length} 项`}
      </p>
    </div>
    <PluginTable states={profile} catalog={data} plugins={visible} configHref={configHref}
      onReset={() => { nav.replace({ q: undefined, state: undefined }); search.current?.focus(); }}
      onOpen={(name, button) => { opener.current = button; nav.replace({ preview: name }); }} />
    {data.unavailable.length > 0 && <div className="mt-4"><Details title={`${data.unavailable.length} 个目录缺少插件清单`}>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">{data.unavailable.map(name => <li key={name}>{name}</li>)}</ul>
    </Details></div>}
    <PluginPreview plugin={target} project={project} catalog={data} configHref={configHref}
      actions={target && (project.pluginIssue ? <div className="mt-4"><Notice error>{project.pluginIssue}</Notice></div>
        : <PluginActions key={target.name} name={target.name} onChange={refresh} onInit={() => {
          nav.replace({ preview: undefined });
          onHandoff(target.name);
        }} />)}
      onClose={() => nav.replace({ preview: undefined })}
      onRestoreFocus={event => {
        event.preventDefault();
        (opener.current?.isConnected ? opener.current : search.current)?.focus();
        opener.current = null;
      }} />
    {preview && !target && <div className="mt-4"><Notice>此插件没有管理预览，请从列表选择按需插件。</Notice></div>}
  </>;
}
