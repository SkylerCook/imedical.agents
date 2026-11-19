import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeftRight, BookOpen, Boxes, CircleHelp, ClipboardList, Database, FlaskConical,
  House, Link2, ListTree, Monitor, Network, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { DemoPages } from "./demo-pages";
import { demoName, projects } from "./demo-model";
import { AppearanceMenu } from "./appearance";
import { RealPages } from "./real-pages";
import { href, readRoute, type DemoId, type Navigation, type Page, type Params } from "./routes";
import { Status } from "./ui";
import "./theme.css";
import "./framework-api";

const navigation = [
  { title: "工程", items: [
    { page: "home", label: "总览", icon: House },
    { page: "config", label: "工程配置", icon: SlidersHorizontal },
    { page: "plugins", label: "插件", icon: Boxes },
    { page: "modules", label: "模块", icon: Network },
  ] },
  { title: "协作与资源", items: [
    { page: "clients", label: "Agent 客户端", icon: Monitor },
    { page: "connections", label: "MCP 与连接", icon: Link2 },
    { page: "knowledge", label: "知识与向量", icon: Database },
    { page: "manual", label: "使用手册", icon: BookOpen },
  ] },
  { title: "维护", items: [
    { page: "scope", label: "能力目录", icon: ListTree },
    { page: "tasks", label: "任务与恢复", icon: ClipboardList },
  ] },
] satisfies { title: string; items: { page: Page; label: string; icon: typeof House }[] }[];

function ProjectSidebar({ nav }: { nav: Navigation }) {
  const { setOpenMobile } = useSidebar();
  const { demo, page } = nav.route;
  return <Sidebar variant="inset" collapsible="icon">
    <SidebarHeader>
      <SidebarMenu><SidebarMenuItem>
        <SidebarMenuButton asChild tooltip="工程总览" className="data-[slot=sidebar-menu-button]:p-1.5!">
          <a href={href("home", demo)} aria-label=".agents 工程总览" onClick={() => setOpenMobile(false)}>
            <img src="/react/workbench-mark.svg" alt="" className="size-5!" /><span className="text-base font-semibold">.agents</span>
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem></SidebarMenu>
    </SidebarHeader>
    <SidebarContent className="gap-0">
      <nav aria-label="工程导航">
        {navigation.map(group => <SidebarGroup key={group.title}>
          <SidebarGroupLabel className="text-muted-foreground">{group.title}</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>
            {group.items.filter(item => item.page !== "modules" || demo === "root").map(item => {
              const label = demo && item.page === "scope" ? "完整能力与配置"
                : demo && item.page === "plugins" ? "能力与插件" : item.label;
              const Icon = item.icon;
              return <SidebarMenuItem key={item.page}>
                <SidebarMenuButton asChild isActive={page === item.page} tooltip={label}>
                  <a href={href(item.page, demo)} aria-label={label} aria-current={page === item.page ? "page" : undefined}
                    onClick={() => setOpenMobile(false)}><Icon aria-hidden="true" /><span>{label}</span></a>
                </SidebarMenuButton>
              </SidebarMenuItem>;
            })}
          </SidebarMenu></SidebarGroupContent>
        </SidebarGroup>)}
      </nav>
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu>
        {demo ? <>
          <SidebarMenuItem><SidebarMenuButton tooltip="演示控制"
            onClick={() => { setOpenMobile(false); nav.replace({ view: "demo", domain: undefined, target: undefined }); }}>
            <FlaskConical aria-hidden="true" /><span>演示控制</span>
          </SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton asChild tooltip="打开实际工程">
            <a href={href("home")} onClick={() => setOpenMobile(false)}><ArrowLeftRight aria-hidden="true" /><span>打开实际工程</span></a>
          </SidebarMenuButton></SidebarMenuItem>
        </> : <SidebarMenuItem><SidebarMenuButton asChild tooltip="打开本机演示">
          <a href={href("scope", "clinic")} onClick={() => setOpenMobile(false)}><FlaskConical aria-hidden="true" /><span>打开本机演示</span></a>
        </SidebarMenuButton></SidebarMenuItem>}
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>;
}

function Workbench() {
  const [route, setRoute] = useState(readRoute);
  const [boundName, setBoundName] = useState("");
  const demo = route.demo;
  const demoLabel = demo ? projects[demo] : null;

  useEffect(() => {
    const followHash = () => setRoute(readRoute());
    addEventListener("hashchange", followHash);
    return () => removeEventListener("hashchange", followHash);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.page, route.demo]);

  const name = demo ? demoName(demo) : boundName || "工程工作台";
  useEffect(() => { document.title = name + " · .agents"; }, [name]);
  const [, setDemoRevision] = useState(0);
  const refreshDemoTitle = useCallback(() => setDemoRevision(value => value + 1), []);

  function go(page: Page, params: Params = {}, target: DemoId | null = demo) {
    location.hash = href(page, target, params);
  }

  function replace(changes: Params) {
    const params = new URLSearchParams(location.hash.slice(1).split("?", 2)[1] ?? "");
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const next = href(route.page, demo, Object.fromEntries(params));
    history.replaceState(history.state, "", next);
    setRoute(readRoute());
  }

  const nav = { route, go, replace };
  return <SidebarProvider className="min-h-dvh" style={{ "--sidebar-width": "calc(var(--spacing) * 72)" } as React.CSSProperties}>
    <ProjectSidebar nav={nav} />
    <SidebarInset className="min-w-0">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-4 lg:px-6">
        <SidebarTrigger className="-ml-1 shrink-0" />
        <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
        <h1 className="min-w-0 truncate text-base font-medium" title={name}>{name}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {demo && <>
          {demoLabel?.parent && <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><a href={href("modules", "root")}>所属工作区</a></Button>}
          <Status>演示</Status>
          <Button variant="ghost" size="icon-sm" aria-label="帮助" onClick={() => nav.replace({ view: "help", domain: undefined, target: undefined })}><CircleHelp /></Button>
          </>}
          <AppearanceMenu />
        </div>
      </header>
      <section className="min-w-0 w-full px-4 py-6 lg:px-6">
        {demo ? <DemoPages key={demo} id={demo} nav={nav} onProject={refreshDemoTitle} />
          : <RealPages nav={nav} onProject={setBoundName} />}
      </section>
      {demo && <footer className="mt-auto border-t px-4 py-4 text-xs text-muted-foreground lg:px-6">
        {demoLabel?.kind} · {demoLabel?.path} · 演示数据按工程保存在本浏览器
        {demoLabel?.parent && <a className="ml-2 underline underline-offset-4 sm:hidden" href={href("modules", "root")}>所属工作区</a>}
      </footer>}
    </SidebarInset>
  </SidebarProvider>;
}

createRoot(document.getElementById("root")!).render(<Workbench />);
