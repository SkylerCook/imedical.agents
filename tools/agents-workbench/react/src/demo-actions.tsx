import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Catalog } from "./api";
import {
  activeConnection, alias, demoName, demoPrompt, demoState, demoTask, projects, requiredPlugins, reset, save, type DemoTask,
} from "./demo-model";
import type { OpenDemo } from "./demo-pages";
import { demoIds, href, type DemoId, type Navigation } from "./routes";
import { Empty, GridTable, Notice, Status, textareaClass, WorkbenchDialog } from "./ui";
import { pluginName } from "../../prototype/plugin-directory.mjs";

type Args = {
  id: DemoId; view: string; target: string | null; catalog?: Catalog; nav: Navigation; open: OpenDemo;
  close: () => void; redraw: () => void; setFeedback: (message: string) => void; newTask: (title: string, type?: string) => void;
};

function Deployment({ id, done }: { id: DemoId; done: () => void }) {
  useEffect(() => {
    const project = demoState(id);
    const item = project.tasks.find(item => item.id === project.deployTask && item.status === "执行中")
      ?? demoTask(id, "首次部署与入口准备", "工具执行", "执行中");
    project.deployTask = item.id;
    save();
    const timer = setTimeout(() => {
      item.status = "已完成";
      project.wizard = 3;
      delete project.deployTask;
      save();
      done();
    }, 650);
    return () => clearTimeout(timer);
  }, [id]); // The active operation is scoped to this scenario.
  return <WorkbenchDialog title="正在模拟部署" description="保留已有配置，准备能力并生成客户端入口。" busy onClose={() => {}}>
    <Notice>正在处理演示工程。</Notice>
  </WorkbenchDialog>;
}

function TaskView({ id, item, close, redraw }: { id: DemoId; item: DemoTask; close: () => void; redraw: () => void }) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const project = demoState(id);
  const completed = item.status === "已完成";
  const prompt = demoPrompt(id, item);
  function change(update: Partial<DemoTask>) { Object.assign(item, update); save(); redraw(); }
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setFeedback("已复制，执行后返回检查。"); }
    catch { setFeedback("剪贴板不可用，可选中文本手动复制。"); }
  }
  function verify() {
    if (!item.returned) { setFeedback("尚无返回结果，请完成宿主或人工步骤后再检查。"); return; }
    if (item.required?.length) {
      for (const key of item.required) project.plugins[key] = true;
      if (project.pendingPlugin === item.plugin) delete project.pendingPlugin;
    }
    change({ status: "已完成" });
    setFeedback("演示读回一致，任务已完成。");
  }
  return <WorkbenchDialog title={item.title} description={`${item.type} · ${item.status}`} onClose={close}
    actions={!completed && item.type !== "共享更新" && item.type !== "工具执行"
      ? <><Button variant="outline" onClick={copy}>复制提示词</Button><Button onClick={verify}>重新检查结果</Button></>
      : undefined}>
    <ol className="flex flex-wrap gap-2">{item.steps.map((step, index) => <li key={step}><Status emphasis={index === 0 || completed}>{step}</Status></li>)}</ol>
    {item.type === "共享更新" ? <>
      <Notice>共享能力包已模拟更新一次。各模块独立记录刷新结果。</Notice>
      <GridTable label="模块刷新结果" headers={["模块", "刷新结果", "操作"]} rows={[
        [demoName("dental"), "刷新成功", <Status>完成</Status>],
        [demoName("nursing"), demoState("nursing").updated ? "重试成功" : "刷新失败：演示冲突",
          demoState("nursing").updated ? <Status>完成</Status> : <Button size="sm" onClick={() => {
            demoState("nursing").updated = true; change({ status: "已完成" });
          }}>仅重试此模块</Button>],
      ]} />
    </> : item.type === "工具执行" ? <Notice>当前状态 {item.status}</Notice> : <>
      <p className="text-muted-foreground">{item.type === "人工操作" ? "完成客户端信任或重载后返回检查。" : "使用交接请求核对工程语义。"}</p>
      <textarea className={textareaClass} aria-label="交接提示词" value={prompt} rows={8} readOnly />
      {item.status === "待补充回答" && <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault();
        if (!answer.trim()) { setFeedback("请先填写任务范围。"); return; }
        change({ answer: answer.trim(), status: "等待 Agent 返回" }); setFeedback("");
      }}>
        <label className="grid min-w-0 flex-1 gap-2">Agent 需要确认：本次范围是什么？
          <Input value={answer} onChange={event => setAnswer(event.target.value)} required />
        </label>
        <Button type="submit">提交回答</Button>
      </form>}
      {!completed && <div className="flex flex-wrap gap-2">
        {item.type === "Agent 执行" && item.status === "待接续" && <Button variant="outline" onClick={() => change({ status: "待补充回答" })}>模拟派发</Button>}
        <Button variant="outline" onClick={() => { change({ returned: true, status: "结果待验证" }); setFeedback("已标记返回，下一步检查结果。"); }}>模拟宿主/人工已返回</Button>
      </div>}
    </>}
    {feedback && <Notice>{feedback}</Notice>}
  </WorkbenchDialog>;
}

function PluginAction({ id, view, target, catalog, close, redraw, nav }: Args) {
  const project = demoState(id);
  const plugin = catalog?.plugins.find(plugin => plugin.name === target);
  if (!catalog || !plugin) return <WorkbenchDialog title="能力目录" description="请确认插件清单已加载。" onClose={close}>
    <Empty title="当前能力暂不可用">从插件页重新读取后选择。</Empty>
  </WorkbenchDialog>;
  const key = alias(plugin.name);
  const name = pluginName(plugin);
  const needed = requiredPlugins(catalog, plugin.name);
  const base = catalog.basePlugins.includes(plugin.name);
  const installs = needed.filter(key => !catalog.basePlugins.some(name => alias(name) === key));
  const dependents = catalog.plugins.filter(candidate => candidate.name !== plugin.name && project.plugins[alias(candidate.name)]
    && requiredPlugins(catalog, candidate.name).includes(key));
  const names = (keys: string[]) => keys.map(key => {
    const found = catalog.plugins.find(plugin => alias(plugin.name) === key);
    return found ? pluginName(found) : key;
  }).join("、");
  if (view === "dependency" || base) return <WorkbenchDialog title="能力依赖与来源"
    description={`${name} · ${plugin.version}`} onClose={close}>
    <p>{plugin.description}</p>
    <GridTable label="能力来源" headers={["字段", "内容"]} rows={[
      ["必需依赖", plugin.dependencies.join("、") || "无"],
      ["来源", `plugins/${plugin.directory}/.agents-plugin/plugin.json`],
      ["初始化入口", plugin.initSkill || "按 owner 接入说明检查"],
      ["作用域", projects[id].parent ? "共享 CapabilityRoot 持有物料，当前模块单独启用" : "当前工程"],
    ]} />
  </WorkbenchDialog>;
  if (project.plugins[key]) return <WorkbenchDialog title="停用影响" description={name} onClose={close}
    actions={dependents.length ? undefined : <Button onClick={() => {
      project.plugins[key] = false;
      demoTask(id, `停用 ${plugin.name}（保留配置）`, "工具执行", "已完成"); close(); redraw();
    }}>确认停用</Button>}>
    <Notice error={!!dependents.length}>{dependents.length
      ? `${dependents.map(pluginName).join("、")} 仍依赖此插件。请先处理依赖它的能力。`
      : "停用范围为当前工程，连接与共享物料保留。"}</Notice>
  </WorkbenchDialog>;
  return <WorkbenchDialog title="接入能力" description={name} onClose={close}
    actions={<Button onClick={() => {
      project.pendingPlugin = key;
      project.available = [...new Set([...(project.available ?? []), ...needed])];
      demoTask(id, `补装 ${plugin.name} 及必需依赖`, "工具执行", "已完成");
      const next = demoTask(id, `配置并初始化 ${name}`, "提示词交接", "待接续");
      next.plugin = key;
      next.required = needed;
      next.entry = plugin.initSkill ? `plugins/${plugin.directory}/skills/${plugin.initSkill}/SKILL.md` : `plugins/${plugin.directory}/AGENTS.md`;
      save(); redraw(); nav.go("tasks", { view: "task", target: next.id });
    }}>模拟补装并配置</Button>}>
    <Notice>准备 {names(installs)}。配置与依赖核对完成后启用。</Notice>
  </WorkbenchDialog>;
}

export function DemoActions(args: Args) {
  const { id, view, target, nav, open, close, redraw, newTask, setFeedback } = args;
  const project = demoState(id);
  const info = (title: string, description: string, actions?: React.ReactNode) =>
    <WorkbenchDialog title={title} description={description} actions={actions} onClose={close} />;
  switch (view) {
    case "demo":
      return <WorkbenchDialog title="演示控制" description="所有演示场景在本浏览器按工程隔离。" onClose={close}
        actions={<Button variant="outline" onClick={() => { reset(); redraw(); nav.go("home", {}, "clinic"); }}>重置全部演示</Button>}>
        <div className="flex flex-wrap gap-2">{demoIds.map(item => <Button variant={id === item ? "default" : "outline"} key={item}
          onClick={() => nav.go("home", {}, item)}>{projects[item].name}</Button>)}</div>
        <h3 className="font-medium">当前工程异常场景</h3>
        <div className="flex flex-wrap gap-2">{([
          ["legacy", "旧框架接口缺失"], ["custom", "自定义域只读"], ["conflict", "下次保存发生冲突"],
        ] as const).map(([key, label]) => <Button key={key} variant="outline" aria-pressed={project[key]}
          onClick={() => { project[key] = !project[key]; save(); redraw(); nav.go("config"); }}>{label}</Button>)}</div>
      </WorkbenchDialog>;
    case "help": return info("围绕目标开始工作", "从首页或能力目录选择目标，遇到失败可在任务页接续。", <Button asChild><a href={href("manual", id)}>阅读使用手册</a></Button>);
    case "check": return info("模拟检查完成", "本地入口存在，真实宿主与连接仍待验证。");
    case "environment": return info("准备基础环境", "安装助手负责 Node 24 与 Git。此处演示环境准备后的流程。",
      <Button onClick={() => { project.environment = true; save(); close(); redraw(); }}>模拟环境已准备</Button>);
    case "deploy": return <Deployment id={id} done={() => { close(); redraw(); }} />;
    case "start":
      return <WorkbenchDialog title="开始一项工作" description="选择需要工作台协助完成的目标。" onClose={close}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => {
            project.installed = true; project.plugins.iris = true; project.clients[project.client] = "入口已生成";
            save(); newTask("补全首次接入的工程事实");
          }}>接入 IRIS 开发</Button>
          <Button variant="outline" onClick={() => newTask("诊断当前工程接入问题")}>诊断工程问题</Button>
          <Button variant="outline" onClick={() => newTask("客户端信任与重载", "人工操作")}>模拟人工重载</Button>
        </div>
      </WorkbenchDialog>;
    case "dependency":
    case "plugin": return <PluginAction {...args} />;
    case "user-scope": return info("用户级配置影响", "所有引用同一个人来源的工程都可能受影响。");
    case "secret": return <WorkbenchDialog title="演示凭据" description="选择对当前开发库档案的演示操作。" onClose={close}>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={close}>保留现状</Button>
        <Button variant="outline" onClick={() => {
          activeConnection(project).secret = true; project.tested = false; project.needsReconnect = true; save(); close(); redraw();
        }}>替换为虚构凭据</Button>
        <Button variant="outline" onClick={() => {
          activeConnection(project).secret = false; project.tested = false; project.needsReconnect = true; save(); close(); redraw();
        }}>明确清除</Button></div>
    </WorkbenchDialog>;
    case "update":
      if (projects[id].parent) return info("此操作影响共享框架", "查看 Root 中所有模块的更新影响。",
        <Button onClick={() => nav.go("modules", { view: "update" }, "root")}>前往 Root 预览</Button>);
      return info("更新影响预览", id === "root" ? "共享物料更新一次，然后刷新口腔和护理。演示会产生一个模块冲突。"
        : "只更新当前演示工程，保留既有连接、显式禁用和自定义内容。",
        <Button onClick={() => {
          project.updated = true;
          project.legacy = false;
          if (id === "root") {
            demoState("dental").updated = true;
            demoState("nursing").updated = false;
            const item = demoTask(id, "共享框架更新与模块刷新", "共享更新", "部分完成");
            nav.go("tasks", { view: "task", target: item.id });
          } else {
            demoTask(id, "更新当前工程框架", "工具执行", "已完成");
            close();
          }
          redraw();
        }}>模拟应用更新</Button>);
    case "task": {
      const item = project.tasks.find(task => task.id === target);
      return item ? <TaskView id={id} item={item} close={close} redraw={redraw} /> : info("任务未找到", "返回任务列表选择当前工程的记录。");
    }
    case "vector-preview": return info("向量构建预览", "范围为演示手册，提供方为模拟服务。",
      <Button onClick={() => {
        project.vector = 45; demoTask(id, "向量构建", "工具执行", "已中断，可续建"); close(); redraw();
      }}>模拟构建并中断</Button>);
    case "vector-resume": return info("续建向量索引", "保留已完成批次，从模拟断点继续。",
      <Button onClick={() => {
        project.vector = 100;
        const item = project.tasks.find(task => task.title === "向量构建");
        if (item) item.status = "已完成";
        save(); close(); redraw(); setFeedback("模拟续建完成，已完成批次保留。");
      }}>模拟续建</Button>);
    case "vector-export": return info("导出摘要", "演示索引已完整。原框架负责核对资料与模型并执行正式导出。");
    default: return info("演示操作未找到", "请从当前页面重新选择操作。", <Button onClick={() => open("help")}>查看帮助</Button>);
  }
}
