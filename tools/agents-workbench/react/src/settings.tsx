import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { settingsRequest, type SettingsChange, type SettingsField, type SettingsId, type SettingsModel, type SettingsPlan } from "./api";
import { GridTable, Notice, ReadState, selectClass, WorkbenchDialog } from "./ui";

const titles: Record<SettingsId, string> = {
  project: "工程连接与路径", bos: "BOS 连接与凭据", knowledge: "知识提供方与 Key",
};
const labels: Record<string, string> = {
  host: "IRIS 主机", port: "Web 端口", scheme: "协议", namespace: "命名空间",
  alias: "VS Code 服务器名", description: "连接说明", tlsVerify: "验证 TLS 证书",
  username: "IRIS 账号", password: "IRIS 密码",
  "web.basePath": "Web 根路径", "web.cspBasePath": "CSP 根路径",
  "web.brokerPath": "Broker 相对路径", "web.cookie": "Web Cookie",
  "sftp.host": "SFTP 主机", "sftp.port": "SFTP 端口", "sftp.username": "SFTP 账号",
  "sftp.password": "SFTP 密码", "sftp.localPath": "本地前端目录", "sftp.remotePath": "远端 Web 目录",
  connection: "服务连接地址", access_key: "统一访问 Key",
  "X-Gateway-Upstream-BOS-MCP-TOKEN": "查询个人 Token",
  cuser: "人员标识", cgroup: "组标识", token: "日志个人 Token", linkProject: "关联工程",
  timeout: "请求超时", defaultProvider: "默认提供方", type: "提供方类型", model: "模型",
  dimensions: "向量维度", baseUrl: "服务地址", method: "请求方法",
  appId: "应用标识", appKey: "应用 Key", apiKey: "API Key",
};

function fieldLabel(field: SettingsField) { return labels[field.label] ?? field.label; }

function groupFields(model: SettingsModel) {
  const groups = new Map<string, SettingsField[]>();
  for (const field of model.fields) {
    const parts = field.id.split(".");
    const section = model.id === "bos" ? parts[0] : parts.slice(0, -1).join(".");
    const fields = groups.get(section) ?? [];
    fields.push(field);
    groups.set(section, fields);
  }
  return [...groups].map(([section, fields]) => {
    const names: Record<string, string> = {
      web: "Web 路径与会话", sftp: "SFTP 文件连接", "bos-demand-query": "BOS 需求查询",
      "bos-code-update-log": "BOS 开发日志", "providers.company": "公司知识提供方",
      "providers.openai": "OpenAI 知识提供方",
    };
    const title = names[section] ?? (model.id === "project" ? "IRIS 开发连接" : "默认提供方");
    let source = model.id === "bos" ? "BOS_MCP_CONFIG" : "KNOWLEDGE_RAG_CONFIG";
    if (model.id === "project") {
      source = section ? `.agents/config/project-env.json · ${section}` : ".agents/config/project-env.json · VS Code · MCP/TOML";
    }
    return { title, source, fields };
  });
}

type ValueDraft = Record<string, string>;
type FieldDelta = { id: string; name: string; before: string; after: string };
type Phase = "loading" | "edit" | "preview" | "saved" | "read-error";
const displayAction = (action: string) => ({ replace: "替换", clear: "清除" })[action] ?? action;

function SecretField({ field, allowClear }: { field: SettingsField; allowClear: boolean }) {
  const [action, setAction] = useState("keep");
  const label = fieldLabel(field);
  return <div className="grid min-w-0 content-start gap-2">
    <label htmlFor={`action-${field.id}`}>{label}</label>
    <select id={`action-${field.id}`} name={`action-${field.id}`} className={selectClass} value={action}
      onChange={event => setAction(event.target.value)}>
      <option value="keep">保留 · {field.configured ? "已设置" : "未设置"}</option>
      <option value="replace">替换</option>
      {allowClear && <option value="clear">清除</option>}
    </select>
    {action === "replace" && <Input name={field.id} type="password" autoComplete="new-password" aria-label={`${label}新值`}
      placeholder="输入替换值" required maxLength={8192} />}
  </div>;
}

function SettingsFields({ model, draft }: { model: SettingsModel; draft: ValueDraft }) {
  return groupFields(model).map(group => <fieldset key={group.title} className="min-w-0 rounded-lg border p-3 sm:p-4">
    <legend className="px-2 font-medium">{group.title}</legend>
    <p className="mb-3 break-all text-xs text-muted-foreground">{model.scope} · {group.source}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {group.fields.map(field => {
        const label = fieldLabel(field);
        const initial = draft[field.id] ?? String(field.value ?? "");
        const options = field.id === "scheme" ? ["http", "https"] : field.id === "defaultProvider" ? ["company", "openai"]
          : field.id.endsWith(".method") ? ["POST", "GET"] : [];
        const port = field.id === "port" || field.id === "sftp.port";
        const dimensions = field.id.endsWith(".dimensions");
        if (field.secret) return <SecretField key={field.id} field={field} allowClear={model.id !== "project"} />;
        return <div key={field.id} className="grid min-w-0 content-start gap-2">
          <label htmlFor={`field-${field.id}`}>{label}</label>
          {options.length > 0
            ? <select id={`field-${field.id}`} name={field.id} className={selectClass} defaultValue={initial}>
              {[...new Set([initial, ...options])].map(value => <option key={value} value={value}>{value || "未设置"}</option>)}
            </select>
            : field.type === "boolean"
            ? <select id={`field-${field.id}`} name={field.id} className={selectClass} defaultValue={initial}>
              <option value="true">是</option><option value="false">否</option>
            </select>
            : <Input id={`field-${field.id}`} name={field.id} defaultValue={initial} autoComplete="off"
              type={field.type === "number" ? "number" : "text"}
              required={field.type === "number"} min={port || dimensions ? 1 : undefined}
              max={port ? 65535 : dimensions ? 65536 : undefined}
              step={port || dimensions ? 1 : field.type === "number" ? "any" : undefined} maxLength={8192} />}
        </div>;
      })}
    </div>
  </fieldset>);
}

export function SettingsDialog({ id, onClose, onSaved }: { id: SettingsId; onClose: () => void; onSaved: (id: SettingsId) => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [model, setModel] = useState<SettingsModel>();
  const [draft, setDraft] = useState<ValueDraft>({});
  const [delta, setDelta] = useState<FieldDelta[]>([]);
  const [plan, setPlan] = useState<SettingsPlan>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const phaseFocus = useRef<HTMLDivElement>(null);
  const shared = id !== "project";

  useEffect(() => {
    const controller = new AbortController();
    settingsRequest<SettingsModel>(id, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setModel(result);
      setPhase("edit");
    }).catch(err => {
      if (controller.signal.aborted) return;
      setError(err.message);
      setPhase("read-error");
    });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [id, generation]);

  useEffect(() => { phaseFocus.current?.focus(); }, [phase]);

  function reload() {
    setError("");
    setDraft({});
    setDelta([]);
    setPlan(undefined);
    setModel(undefined);
    setPhase("loading");
    setGeneration(value => value + 1);
  }

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!model || busy) return;
    const form = new FormData(event.currentTarget);
    const nextDraft: ValueDraft = {};
    const changes: Record<string, SettingsChange> = {};
    const requested: FieldDelta[] = [];
    for (const field of model.fields) {
      const value = String(form.get(field.id) ?? "");
      if (field.secret) {
        const action = form.get(`action-${field.id}`);
        if (action === "replace") changes[field.id] = { action, value };
        if (action === "clear") changes[field.id] = { action };
        if (action === "replace" || action === "clear") requested.push({
          id: field.id, name: fieldLabel(field), before: field.configured ? "已设置" : "未设置", after: displayAction(action),
        });
      } else {
        nextDraft[field.id] = value;
        const typed = field.type === "number" ? Number(value) : field.type === "boolean" ? value === "true" : value;
        if (typed !== field.value) {
          changes[field.id] = { value: typed };
          requested.push({ id: field.id, name: fieldLabel(field), before: String(field.value ?? ""), after: String(typed) });
        }
      }
    }
    setDraft(nextDraft);
    setError("");
    setBusy(true);
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = await settingsRequest<SettingsPlan>(`plan/${id}`, controller.signal, { revision: model.revision, changes });
      if (controller.signal.aborted) return;
      setDelta(shared ? requested.filter(item => result.changes.some(change => change.field === item.id)) : requested);
      setPlan(result);
      setPhase("preview");
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "无法生成预览。");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function apply() {
    if (busy || !plan?.changes.length) return;
    setBusy(true);
    setError("");
    // The backend consumes the preview once. Any failure requires a new preview.
    const { planId } = plan;
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = await settingsRequest<{ message: string }>("apply", controller.signal, { planId });
      if (controller.signal.aborted) return;
      setMessage(result.message);
      setDraft({});
      setPhase("saved");
      onSaved(id);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "保存失败，请重新读取。");
        setPlan(undefined);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const description = shared
    ? "共享个人配置 · 保存影响引用同一来源的所有工程。"
    : "当前工程 · 预览列出涉及文件，保存后逐文件读回。";
  const title = phase === "preview" ? shared ? "确认共享配置修改" : "确认工程配置修改"
    : phase === "saved" ? "保存结果" : titles[id];
  let actions;
  if (phase === "edit" && model?.fields.length) actions = <Button form="settings-form" type="submit" disabled={busy}>
    {busy ? "正在预览…" : "预览修改"}
  </Button>;
  if (phase === "preview") actions = <>
    <Button variant="outline" disabled={busy} onClick={() => { setPhase("edit"); setPlan(undefined); setError(""); }}>重新编辑</Button>
    {plan?.changes.length ? <Button disabled={busy} onClick={apply}>
      {busy ? "保存并读回中…" : shared ? "保存到共享个人配置" : "保存到当前工程"}
    </Button> : null}
  </>;

  return <WorkbenchDialog title={title} description={description} actions={actions} onClose={onClose} busy={busy}>
    {phase === "loading" && <ReadState label="正在读取已绑定来源…" />}
    {phase === "read-error" && <ReadState label="配置暂不可编辑" error={error} retry={reload} />}
    {phase === "edit" && model && <>
      <p className="text-muted-foreground">{shared ? "凭据及可能含访问参数的地址仅显示设置状态。"
        : "IRIS 账号与密码需成对替换，其余字段可单独修改。凭据仅显示设置状态。"}</p>
      {model.fields.length ? <form id="settings-form" onSubmit={preview} autoComplete="off" className="space-y-4">
        <fieldset disabled={busy} className="min-w-0 space-y-4"><SettingsFields model={model} draft={draft} /></fieldset>
      </form> : <Notice>当前来源没有工作台支持的字段，请核对文件结构。</Notice>}
    </>}
    {phase === "preview" && plan && <div tabIndex={-1} ref={phaseFocus} className="space-y-3 outline-none">
      <Notice>{plan.scope}</Notice>
      {plan.changes.length > 0 && delta.length > 0 && <GridTable label="字段变更" headers={["将改的字段", "当前值", "候选值"]}
        rows={delta.map(field => [field.name, field.before || "未填写", field.after || "清空"])} />}
      <p className="text-muted-foreground">{plan.warning}</p>
      {plan.warnings?.map(warning => <Notice key={warning}>{warning}</Notice>)}
      {plan.changes.length ? <GridTable label="修改预览" headers={[shared ? "字段" : "涉及文件", "修改"]}
        rows={plan.changes.map(change => [change.field, displayAction(change.action)])} />
        : <Notice>没有实际变更。</Notice>}
      <p className="text-xs text-muted-foreground">预览有效期 5 分钟。返回编辑时需重新输入替换凭据。</p>
    </div>}
    {phase === "saved" && <div tabIndex={-1} ref={phaseFocus} className="outline-none"><Notice>{message}</Notice></div>}
    {error && phase !== "read-error" && <Notice error>{error} <Button variant="outline" size="sm" className="ml-1" onClick={reload}>重新读取来源</Button></Notice>}
  </WorkbenchDialog>;
}
