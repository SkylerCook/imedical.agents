import { useRef } from "react";
import {
  ArrowUpRight, ChevronDown, CircleCheck, CircleMinus, Clock3, Ellipsis, LockKeyhole, PackageSearch,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pluginName, pluginStatus, previewPluginDependencies } from "../../prototype/plugin-directory.mjs";
import type { Catalog, ProjectSummary } from "./api";

type Plugin = import("../../prototype/plugin-directory.mjs").Plugin;

function StatusBadge({ status }: { status?: string }) {
  const Icon = status === "enabled" ? CircleCheck : status === "pending" ? Clock3
    : status === "disabled" ? CircleMinus : null;
  return (
    <Badge variant="outline" className={status === "enabled" ? "gap-1.5" : "gap-1.5 text-muted-foreground"}>
      {Icon && <Icon aria-hidden="true" />}
      {pluginStatus(status)}
    </Badge>
  );
}

function PluginDetails({ plugin }: { plugin: Plugin }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm leading-6">
      {plugin.displayName && plugin.displayName !== pluginName(plugin) && (
        <>
          <dt className="text-muted-foreground">清单名称</dt>
          <dd className="min-w-0 wrap-anywhere">{plugin.displayName}</dd>
        </>
      )}
      <dt className="text-muted-foreground">用途</dt>
      <dd className="min-w-0 wrap-anywhere">{plugin.description || "清单未填写"}</dd>
      <dt className="text-muted-foreground">直接依赖</dt>
      <dd className="min-w-0 wrap-anywhere">
        {plugin.dependencies.length === 0 ? "无" : (
          <ul>
            {plugin.dependencies.map(name => {
              const range = plugin.dependencyVersions?.[name];
              return (
                <li key={name}>
                  {name}
                  {range?.minVersion && <span className="ml-2 text-muted-foreground">≥{range.minVersion}</span>}
                  {range?.maxVersionExclusive && <span className="ml-2 text-muted-foreground">&lt;{range.maxVersionExclusive}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </dd>
      {plugin.initSkill && (
        <>
          <dt className="text-muted-foreground">初始化入口</dt>
          <dd className="min-w-0 wrap-anywhere">{plugin.initSkill}</dd>
        </>
      )}
    </dl>
  );
}

type PluginTableProps = {
  states: ReadonlyMap<string, string>;
  catalog: Catalog;
  plugins: Plugin[];
  configHref: string;
  onReset: () => void;
  onOpen: (name: string, trigger: HTMLButtonElement) => void;
};

function PluginRowMenu({ plugin, configHref, onOpen }: {
  plugin: Plugin;
  configHref: string;
  onOpen: PluginTableProps["onOpen"];
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const opensDialog = useRef(false);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon-sm" aria-label={`${pluginName(plugin)} 操作`}>
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={event => {
        if (opensDialog.current) event.preventDefault();
        opensDialog.current = false;
      }}>
        <DropdownMenuItem onSelect={() => {
          if (trigger.current) {
            opensDialog.current = true;
            onOpen(plugin.name, trigger.current);
          }
        }}>管理预览</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={configHref}>打开工程配置<ArrowUpRight aria-hidden="true" className="ml-auto" /></a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PluginTable({ states, catalog, plugins, configHref, onReset, onOpen }: PluginTableProps) {
  if (!plugins.length) {
    return (
      <section className="grid justify-items-center gap-3 rounded-lg border bg-background px-5 py-12 text-center">
        <PackageSearch className="size-6 text-muted-foreground" aria-hidden="true" />
        <h3 className="font-semibold">{catalog.plugins.length ? "没有匹配的插件" : "目录没有可用插件"}</h3>
        {catalog.plugins.length > 0 && <Button variant="outline" onClick={onReset}>清除筛选</Button>}
      </section>
    );
  }

  return (
    <div className="rounded-lg border bg-background">
      <Table aria-label="插件目录" className="min-w-[36rem]">
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="h-10 px-4 text-muted-foreground">插件</TableHead>
            <TableHead scope="col" className="w-29 px-4 text-muted-foreground">工程状态</TableHead>
            <TableHead scope="col" className="w-28 px-4 text-muted-foreground">源仓版本</TableHead>
            <TableHead scope="col" className="w-27 px-4 text-right text-muted-foreground">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plugins.map(plugin => {
            const isBase = catalog.basePlugins.includes(plugin.name);
            return (
              <TableRow key={plugin.name} className="align-top hover:bg-accent/55">
                <TableCell className="px-4 py-1.5 whitespace-normal">
                  <details className="group/details">
                    <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={`${pluginName(plugin)}，用途与依赖`}>
                      <span className="min-w-0 font-medium wrap-anywhere">{pluginName(plugin)}</span>
                      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground group-open/details:rotate-180" />
                    </summary>
                    <div className="mt-2 max-w-[72ch] pb-1">
                      <PluginDetails plugin={plugin} />
                    </div>
                  </details>
                  <span className="block font-mono text-xs leading-4 text-muted-foreground wrap-anywhere">{plugin.name}</span>
                </TableCell>
                <TableCell className="px-4 py-3"><StatusBadge status={states.get(plugin.name)} /></TableCell>
                <TableCell className="px-4 py-3 font-mono text-sm leading-5 tabular-nums">{plugin.version}</TableCell>
                <TableCell className="px-4 py-2 text-right">
                  {isBase ? (
                    <span className="inline-flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground">
                      <LockKeyhole aria-hidden="true" className="size-3.5" /> 框架内置
                    </span>
                  ) : (
                    <PluginRowMenu plugin={plugin} configHref={configHref} onOpen={onOpen} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

type PluginPreviewProps = {
  plugin?: Plugin;
  project: ProjectSummary;
  catalog: Catalog;
  configHref: string;
  onClose: () => void;
  onRestoreFocus: (event: Event) => void;
  actions?: React.ReactNode;
  onHandoff?: () => void;
};

export function PluginPreview({ plugin, project, catalog, configHref, onClose, onRestoreFocus, onHandoff, actions }: PluginPreviewProps) {
  const affected = plugin ? previewPluginDependencies(catalog.plugins, project.plugins, plugin.name) : [];
  return (
    <Dialog open={Boolean(plugin)} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={onRestoreFocus}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-popover p-0 sm:max-w-[42rem]">
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle className="leading-7">管理预览 · {plugin && pluginName(plugin)}</DialogTitle>
          <DialogDescription>根据源仓依赖和当前工程状态计算。操作前可核对依赖和工程状态。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
          <h3 className="mb-2 text-sm font-semibold">影响范围</h3>
          <div className="rounded-md border">
            <Table aria-label="插件影响范围" className="min-w-[26rem]">
              <TableHeader className="bg-muted/65">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className="px-3 text-muted-foreground">插件</TableHead>
                  <TableHead scope="col" className="px-3 text-muted-foreground">工程状态</TableHead>
                  <TableHead scope="col" className="px-3 text-muted-foreground">计划影响</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affected.map(row => (
                  <TableRow key={row.name}>
                    <TableCell className="px-3 font-medium whitespace-normal">{row.label}</TableCell>
                    <TableCell className="px-3"><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="px-3 text-sm whitespace-normal text-muted-foreground">{row.impact}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {plugin && <div className="mt-4"><PluginDetails plugin={plugin} /></div>}{actions}
        </div>
        <DialogFooter className="flex-row flex-wrap justify-between gap-2 border-t px-5 py-3 sm:justify-between sm:px-6">
          <DialogClose asChild><Button variant="outline" autoFocus>关闭预览</Button></DialogClose>
          <Button asChild variant="ghost">
            <a href={configHref}>打开工程配置<ArrowUpRight aria-hidden="true" /></a>
          </Button>
          {onHandoff && <Button variant="outline" onClick={onHandoff}>生成安装或启用请求</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
