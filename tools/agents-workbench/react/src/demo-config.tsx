import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { activeConnection, defaults, demoState, demoTask, libraries, save, type DemoDraft, type Library } from "./demo-model";
import { ScopeActions } from "./demo-scope";
import type { DemoId, Navigation } from "./routes";
import { Details, GridTable, Notice, PageHeading, Panel, ReadState, selectClass } from "./ui";

const reviewStates = [
  ["ready", "正常"], ["loading", "加载"], ["empty", "空态"],
  ["failed", "失败"], ["partial", "部分完成"],
] as const;
type Review = typeof reviewStates[number][0] | "saved";

const credentials: Record<string, string> = {
  keep: "沿用目标档案的凭据设置", replace: "模拟替换目标档案的凭据", clear: "清除目标档案的演示凭据",
};

export function DemoConfig({ id, nav, redraw, start, diagnose }: {
  id: DemoId; nav: Navigation; redraw: () => void; start: () => void; diagnose: () => void;
}) {
  const project = demoState(id);
  const draft = { ...defaults(id), ...project.editorDraft };
  const [review, setReview] = useState<Review>("ready");
  const [preview, setPreview] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const target = project.connections[draft.library];
  const current = activeConnection(project);
  const dirty = Boolean(project.editorDraft);
  const switching = draft.library !== project.activeLibrary;
  const scope = id === "dental" || id === "nursing" ? "当前模块" : "当前工程";

  function update(patch: Partial<DemoDraft>) {
    const next = { ...draft, ...patch };
    const baseline = defaults(id);
    if ((Object.keys(baseline) as (keyof DemoDraft)[]).some(key => next[key] !== baseline[key])) project.editorDraft = next;
    else delete project.editorDraft;
    save();
    setPreview(false);
    setConflict(false);
    setError("");
    setInvalid("");
    if (review === "saved") setReview("ready");
    redraw();
  }

  function chooseLibrary(library: Library) {
    if (draft.host !== target.host || draft.port !== String(target.port) || draft.secret !== "keep") {
      setError("请先保存或放弃所选档案的连接修改，再选择另一套开发库。");
      return;
    }
    const selected = project.connections[library];
    update({ library, host: selected.host, port: String(selected.port), secret: "keep" });
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    const port = Number(draft.port);
    const field = !draft.name.trim() ? "name" : !draft.host.trim() ? "host" : !Number.isInteger(port) || port < 1 || port > 65535 ? "port" : "";
    if (field) {
      setInvalid(field);
      setError(field === "port" ? "Web 端口请输入 1–65535 的整数。" : "项目名称和连接地址不能为空。");
      (form.current?.elements.namedItem(field) as HTMLInputElement | null)?.focus();
      return;
    }
    setError("");
    setInvalid("");
    setPreview(true);
    requestAnimationFrame(() => heading.current?.focus());
  }

  function apply(partial = false) {
    if (project.conflict) {
      setPreview(false);
      setConflict(true);
      return;
    }
    const host = draft.host.trim(), port = Number(draft.port);
    const secret = draft.secret === "keep" ? target.secret : draft.secret === "replace";
    if (switching || target.host !== host || target.port !== port || target.secret !== secret) {
      project.tested = false;
      project.needsReconnect = true;
    }
    Object.assign(target, { host, port, secret });
    project.name = draft.name.trim();
    project.mode = draft.mode;
    project.activeLibrary = draft.library;
    delete project.editorDraft;
    demoTask(id, switching ? "切换开发库" : "保存工程配置并读回", "工具执行", partial ? "验证未完成" : "已完成");
    save();
    setReview(partial ? "partial" : "saved");
    setPreview(false);
    redraw();
  }

  function verify() {
    project.tested = true;
    project.needsReconnect = false;
    const pending = project.tasks.find(item => item.status === "验证未完成" && item.title === "保存工程配置并读回");
    if (pending) pending.status = "已完成";
    save();
    setReview("saved");
    redraw();
  }

  const options = {
    ready: dirty ? "有未保存的修改" : "配置已读取",
    loading: "正在读取配置",
    empty: "尚未配置开发连接",
    failed: "模拟写入失败，原开发库和草稿保留。",
    partial: "配置已保存，验证未完成",
    saved: "配置已保存，演示值已读回。",
  };

  if (project.legacy || project.custom) return <>
    <PageHeading title="工程配置" description="核对当前工程的可用写入入口。" />
    <div className="space-y-4">
      {project.legacy && <Notice error>当前演示旧框架缺少配置写接口，可预览升级或准备 Agent 请求。</Notice>}
      {project.custom && <Notice error>发现自定义配置，此域保持只读。</Notice>}
      <Panel title="现有连接" hint={`${current.host}:${current.port}`} actions={<Button onClick={start}>生成处理请求</Button>} />
    </div>
  </>;

  return <>
    <PageHeading title="工程配置" description="保存的名称、连接档案和草稿仅用于本浏览器演示。" />
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
        <p role="status" className={review === "failed" ? "text-destructive" : "text-muted-foreground"}>{options[review]}</p>
        <div className="flex flex-wrap gap-2">
          {review === "empty" || review === "loading"
            ? <Button variant="outline" size="sm" onClick={() => setReview("ready")}>{review === "loading" ? "完成模拟读取" : "创建演示连接"}</Button>
            : review === "partial" && !project.needsReconnect ? <Button variant="outline" size="sm" onClick={verify}>重新检查演示结果</Button> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm">状态验收<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {reviewStates.map(([state, label]) => <DropdownMenuItem key={state}
                onSelect={() => { setReview(state); setPreview(false); setConflict(false); }}>{label}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {review === "loading" && <ReadState label="正在核对工程信息和连接来源…" />}
      {review === "empty" && <Notice>请先创建一组演示开发连接。</Notice>}
      {review !== "loading" && review !== "empty" && <>
        <form ref={form} onSubmit={prepare} noValidate className="space-y-4">
          <Panel title="工程信息">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">项目显示名称
                <Input name="name" value={draft.name} aria-invalid={invalid === "name"} onChange={event => update({ name: event.target.value })} />
              </label>
              <label className="grid gap-2 text-sm">开发方式
                <select className={selectClass} value={draft.mode} onChange={event => update({ mode: event.target.value })}>
                  <option value="connected">连接开发</option><option value="offline">离线开发</option>
                </select>
              </label>
            </div>
          </Panel>
          <Panel title="IRIS 开发连接" hint={`${scope} · 切换开发方式会保留开发库档案。`}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <label className="grid gap-2 text-sm">开发库档案
                <select className={selectClass} value={draft.library} onChange={event => chooseLibrary(event.target.value as Library)}>
                  {Object.entries(libraries).map(([key, name]) => <option value={key} key={key}>{name}</option>)}
                </select>
              </label>
              <label className="grid min-w-0 gap-2 text-sm">连接地址
                <Input name="host" value={draft.host} aria-invalid={invalid === "host"} onChange={event => update({ host: event.target.value })} />
              </label>
              <label className="grid min-w-0 gap-2 text-sm">Web 端口
                <Input name="port" type="number" min={1} max={65535} value={draft.port} aria-invalid={invalid === "port"} onChange={event => update({ port: event.target.value })} />
              </label>
              <label className="grid min-w-0 gap-2 text-sm">档案凭据
                <select className={selectClass} value={draft.secret} onChange={event => update({ secret: event.target.value })}>
                  <option value="keep">保留档案凭据</option><option value="replace">模拟替换凭据</option><option value="clear">清除演示凭据</option>
                </select>
                <small className="text-muted-foreground">{target.secret ? "已设置（演示）" : "未设置（演示）"}</small>
              </label>
            </div>
            <div className="my-3 flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
              <span role="status">当前开发库 {libraries[project.activeLibrary]} · {project.needsReconnect ? "客户端待重连核验"
                : project.tested ? `客户端模拟已连到${libraries[project.activeLibrary]}` : "客户端尚未核验"}</span>
              {project.needsReconnect && <Button type="button" variant="outline" size="sm" onClick={verify}>模拟重连并核验</Button>}
            </div>
            <Details title="来源与影响范围">
              <p className="text-sm text-muted-foreground">VS Code ObjectScript、IRIS MCP 和框架脚本跟随当前档案。Web / SFTP 按各自绑定处理。</p>
            </Details>
          </Panel>
          {error && <Notice error>{error}</Notice>}
          {conflict && <Panel title="配置发生外部变化" hint={`当前端口 ${current.port} · 模拟外部值 57773 · 候选 ${draft.port}`}>
            <p className="mb-3 text-sm text-muted-foreground">待应用草稿仍在。重新读取后核对再提交。</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => {
                current.port = 57773; project.conflict = false; project.tested = false; project.needsReconnect = true;
                save(); setConflict(false); redraw();
              }}>重新读取并保留草稿</Button>
              <Button type="button" variant="outline" onClick={diagnose}>生成冲突分析请求</Button>
            </div>
          </Panel>}
          {preview && <Panel title={switching ? "核对切库影响" : "核对本次修改"}>
            <h4 ref={heading} tabIndex={-1} className="mb-3 text-sm font-medium outline-none">修改预览</h4>
            <GridTable label="修改预览" headers={["范围", "候选"]}
              rows={[
                ["影响范围", scope], ["开发库", `${libraries[project.activeLibrary]} → ${libraries[draft.library]}`],
                ["连接", `${current.host}:${current.port} → ${draft.host}:${draft.port}`],
                ["跟随入口", "VS Code ObjectScript、IRIS MCP、框架脚本"], ["凭据", credentials[draft.secret]],
              ]} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={() => apply()}>{switching ? "模拟应用切换" : "模拟保存并检查"}</Button>
              <Button type="button" variant="outline" onClick={() => { setReview("failed"); setPreview(false); }}>模拟保存失败</Button>
              {!switching && <Button type="button" variant="outline" onClick={() => apply(true)}>模拟部分完成</Button>}
              <Button type="button" variant="ghost" onClick={() => setPreview(false)}>返回编辑</Button>
            </div>
          </Panel>}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm">
            <span role="status" className="text-muted-foreground">{dirty ? "未保存 · 草稿仅保存在本浏览器" : "没有待保存的修改"}</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={!dirty} onClick={() => { delete project.editorDraft; save(); setPreview(false); setConflict(false); setError(""); setInvalid(""); setReview("ready"); redraw(); }}>放弃修改</Button>
              <Button type="submit" disabled={!dirty}>{switching ? "预览切换" : "预览修改"}</Button>
            </div>
          </div>
        </form>
        <Details title="更多配置与共享连接"><ScopeActions ids={["identity", "web", "profiles", "bos", "embedding"]} nav={nav} /></Details>
      </>}
    </div>
  </>;
}
