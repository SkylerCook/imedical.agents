import { useEffect, useRef, useState, type FormEvent } from "react";
import { VerifyConnection } from "./project-owner-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { settingsRequest, type SettingsChange, type SettingsDraftResult, type SettingsDraftSecretActions, type SettingsField,
  type SettingsId, type SettingsModel, type SettingsPlan } from "./api";
import { href } from "./routes";
import { GridTable, Notice, ReadState, selectClass, WorkbenchDialog } from "./ui";

const titles: Record<SettingsId, string> = {
  project: "工程连接与路径", bos: "BOS 连接与凭据", knowledge: "知识提供方与 Key",
};
const labels: Record<string, string> = {
  developmentMode: "开发模式", environmentAlias: "环境别名", environmentType: "环境类型", host: "IRIS 主机", port: "Web 端口", scheme: "协议", namespace: "命名空间",
  alias: "VS Code 服务器名", description: "连接说明", tlsVerify: "验证 TLS 证书",
  username: "IRIS 账号", password: "IRIS 密码",
  "web.basePath": "Web 根路径", "web.cspBasePath": "CSP 根路径",
  "web.brokerPath": "Broker 相对路径", "web.cookie": "Web Cookie",
  "sftp.host": "SFTP 主机", "sftp.port": "SFTP 端口", "sftp.username": "SFTP 账号",
  "sftp.password": "SFTP 密码", "sftp.localPath": "本地前端目录", "sftp.remotePath": "远端 Web 目录",
  connectionMode: "连接方式", url: "自定义 HTTPS 地址", access_key: "统一访问 Key",
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
      irisConnections: "开发库档案", irisDevelopment: "IRIS 开发环境", deployment: "插件部署策略", web: "Web 路径与会话", sftp: "SFTP 文件连接", "bos-demand-query": "BOS 需求查询",
      "bos-code-update-log": "BOS 开发日志", "providers.company": "公司知识提供方",
      "providers.openai": "OpenAI 知识提供方",
    };
    if (section.startsWith("pluginSettings.")) return {title:section.slice(15),source:fields[0]?.source ?? "ContextRoot/config/project.jsonc",fields};
    const title = names[section] ?? (model.id === "project" ? "IRIS 开发连接" : "默认提供方");
    let source = model.id === "bos" ? "BOS_MCP_CONFIG" : "KNOWLEDGE_RAG_CONFIG";
    if (model.id === "project") {
      source = (section === "deployment" || section === "irisDevelopment" || section === "irisConnections") ? (fields[0]?.source ?? "ContextRoot/config/project.jsonc") : section ? `.agents/config/project-env.json · ${section}` : ".agents/config/project-env.json · VS Code · MCP/TOML";
    }
    return { title, source, fields };
  });
}

type ValueDraft = Record<string, string>;
type FieldDelta = { id: string; name: string; before: string; after: string };
type FieldConflict = { id: string; name: string; source?: SettingsField; local: string; canKeep: boolean };
type Phase = "loading" | "edit" | "preview" | "saved" | "read-error";
const displayAction = (action: string) => ({ replace: "替换", clear: "清除" })[action] ?? action;

function inputValue(field: SettingsField, text: string) {
  if (field.type === "number") return text === "" ? null : Number(text);
  if (field.type === "boolean") return text === "" ? null : text === "true";
  return text;
}

function readDraft(model: SettingsModel, form: FormData): ValueDraft {
  const draft: ValueDraft = {};
  for (const field of model.fields) {
    if (field.secret || field.readOnly) continue;
    const value = form.get(field.id);
    if (typeof value === "string" && value !== String(field.value ?? "") && inputValue(field, value) !== field.value) {
      draft[field.id] = value;
    }
  }
  return draft;
}

function rebaseDraft(previous: Pick<SettingsModel, "fields">, next: SettingsModel, draft: ValueDraft) {
  const values: ValueDraft = {};
  const conflicts: FieldConflict[] = [];
  const currentFields = new Map(next.fields.map(field => [field.id, field]));
  for (const field of previous.fields) {
    if (!Object.hasOwn(draft, field.id) || field.secret || field.readOnly) continue;
    const current = currentFields.get(field.id);
    const value = draft[field.id];
    const canKeep = !!current && !current.secret && !current.readOnly && current.type === field.type && current.source === field.source;
    if (canKeep && inputValue(current, value) === current.value) continue;
    values[field.id] = value;
    if (!canKeep || current.value !== field.value) {
      conflicts.push({ id: field.id, name: fieldLabel(field), source: current?.secret ? undefined : current, local: value, canKeep });
    }
  }
  return { values, conflicts };
}

function canClearSecret(id: SettingsId, field: SettingsField) {
  return id !== "project" && field.clearable !== false;
}

function readSecretAction(id: SettingsId, field: SettingsField, form: FormData) {
  const action = form.get(`action-${field.id}`);
  if (action === "replace" || (action === "clear" && canClearSecret(id, field))) return action;
}

function draftToStore(model: SettingsModel, form: FormData) {
  const values = readDraft(model, form);
  for (const field of model.fields) if (field.draftable === false) delete values[field.id];
  const secretActions: SettingsDraftSecretActions = {};
  for (const field of model.fields) {
    if (!field.secret || field.readOnly || field.draftable === false) continue;
    const action = readSecretAction(model.id, field, form);
    if (action) secretActions[field.id] = action;
  }
  return { values, secretActions };
}

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

function SettingsFields({ model, draft, handoff }: { model: SettingsModel; draft: ValueDraft; handoff:()=>void }) {
  return groupFields(model).map(group => <fieldset key={group.title} className="min-w-0 rounded-lg border p-3 sm:p-4">
    <legend className="px-2 font-medium">{group.title}</legend>
    <p className="mb-3 break-all text-xs text-muted-foreground">{model.scope} · {group.source}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {group.fields.map(field => {
        const label = fieldLabel(field);
        if (field.id==="irisConnections.status") return <VerifyConnection key={field.id} handoff={handoff} initial={String(field.value || "")} />;
        if (field.readOnly) return <div key={field.id}><p>{label} · {field.type === "boolean" ? (field.value ? "是" : "否") : String(field.value ?? "")}（只读）</p>
          </div>;
        const initial = draft[field.id] ?? String(field.value ?? "");
        const options = field.options ?? (field.id === "irisDevelopment.developmentMode" ? ["offline","connected"] : field.id === "irisDevelopment.environmentType" ? ["test","development","production"] : field.id === "scheme" ? ["http", "https"] : field.id === "defaultProvider" ? ["company", "openai"]
          : field.id.endsWith(".method") ? ["POST", "GET"] : []);
        const port = field.id === "port" || field.id === "sftp.port";
        const dimensions = field.id.endsWith(".dimensions");
        if (field.secret) return <SecretField key={field.id} field={field} allowClear={canClearSecret(model.id, field)} />;
        return <div key={field.id} className="grid min-w-0 content-start gap-2">
          <label htmlFor={`field-${field.id}`}>{label}</label>
          {options.length > 0
            ? <select id={`field-${field.id}`} name={field.id} className={selectClass} defaultValue={initial}>
              {[...new Set([initial, ...options])].map(value => <option key={value} value={value}>{value || "未设置"}</option>)}
            </select>
            : field.type === "boolean"
            ? <select id={`field-${field.id}`} name={field.id} className={selectClass} defaultValue={initial}>
              {field.value == null && <option value="">未设置</option>}
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

export function SettingsDialog({ id, onClose, onSaved, handoff }: { handoff:()=>void; id: SettingsId; onClose: () => void; onSaved: (id: SettingsId) => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [model, setModel] = useState<SettingsModel>();
  const [draft, setDraft] = useState<ValueDraft>({});
  const [conflicts, setConflicts] = useState<FieldConflict[]>([]);
  const [delta, setDelta] = useState<FieldDelta[]>([]);
  const [plan, setPlan] = useState<SettingsPlan>();
  const [error, setError] = useState("");
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedDraft, setSavedDraft] = useState<SettingsDraftResult>();
  const [draftOperation, setDraftOperation] = useState<"save" | "clear">();
  const [draftFeedback, setDraftFeedback] = useState<{ message: string; error?: boolean }>();
  const [reviewDraftCredentials, setReviewDraftCredentials] = useState(false);
  const [generation, setGeneration] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const rereadFrom = useRef<{ model: SettingsModel; draft: ValueDraft } | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const phaseFocus = useRef<HTMLDivElement>(null);
  const shared = id !== "project";
  const canStoreDraft = savedDraft?.status === "missing" || savedDraft?.status === "ready";
  const draftPath = `draft/${id}`;

  useEffect(() => {
    const controller = new AbortController();
    const previous = rereadFrom.current;
    const local = !previous ? settingsRequest<SettingsDraftResult>(draftPath, controller.signal, { action: "read" })
      .catch(() => undefined) : undefined;
    Promise.all([settingsRequest<SettingsModel>(id, controller.signal), local]).then(([result, stored]) => {
      if (controller.signal.aborted) return;
      if (previous) {
        const next = rebaseDraft(previous.model, result, previous.draft);
        setDraft(next.values);
        setConflicts(next.conflicts);
        rereadFrom.current = undefined;
      } else {
        setSavedDraft(stored);
        if (!stored) setDraftFeedback({ message: "暂时无法读取本机草稿。可以继续编辑配置。", error: true });
        if (stored?.status === "ready" && stored.draft) {
          const next = rebaseDraft(stored.draft, result, stored.draft.values);
          setDraft(next.values);
          setConflicts(next.conflicts);
          setReviewDraftCredentials(Object.keys(stored.draft.secretActions).length > 0);
          setDraftFeedback({ message: "已恢复本机草稿，请核对后重新预览。" });
        }
      }
      setModel(result);
      setPhase("edit");
    }).catch(err => {
      if (controller.signal.aborted) return;
      setError(err.message);
      setPhase("read-error");
    });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [draftPath, id, generation]);

  useEffect(() => { phaseFocus.current?.focus(); }, [phase]);

  function reload() {
    if (model) {
      const values = formRef.current ? readDraft(model, new FormData(formRef.current)) : draft;
      rereadFrom.current = { model, draft: values };
    }
    setError("");
    setRecoveryRequired(false);
    setDelta([]);
    setPlan(undefined);
    setModel(undefined);
    setPhase("loading");
    setGeneration(value => value + 1);
  }

  function resolveConflict(field: FieldConflict, keep: boolean) {
    if (!keep) setDraft(current => {
      const next = { ...current };
      delete next[field.id];
      return next;
    });
    setConflicts(current => current.filter(item => item.id !== field.id));
  }

  async function clearStoredDraft(tag: string, signal: AbortSignal) {
    const result = await settingsRequest<SettingsDraftResult>(draftPath, signal, { action: "clear", tag });
    signal.throwIfAborted();
    if (result.status !== "missing") throw new Error("draft-clear-unconfirmed");
    setSavedDraft(result);
    setReviewDraftCredentials(false);
  }

  async function updateStoredDraft(action: "save" | "clear") {
    if (busy || !model || !savedDraft) return;
    setDraftFeedback(undefined);
    const form = formRef.current;
    const candidate = action === "save" && canStoreDraft && !conflicts.length && form
      ? draftToStore(model, new FormData(form)) : undefined;
    if (action === "save" && !candidate || action === "clear" && !savedDraft.tag) return;
    if (candidate && !Object.keys(candidate.values).length && !Object.keys(candidate.secretActions).length) {
      setDraftFeedback({ message: "没有可保存到本机草稿的修改。" });
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setDraftOperation(action);
    setBusy(true);
    try {
      if (candidate) {
        const result = await settingsRequest<SettingsDraftResult>(draftPath, controller.signal,
          { action, tag: savedDraft.tag, revision: model.revision, ...candidate });
        if (controller.signal.aborted) return;
        setSavedDraft(result);
        if (result.status === "ready") {
          setReviewDraftCredentials(false);
          setDraftFeedback({ message: "本机草稿已保存。" });
        }
      } else if (savedDraft.tag) {
        await clearStoredDraft(savedDraft.tag, controller.signal);
        setDraftFeedback({ message: "本机草稿已清除。当前编辑内容仍可继续处理。" });
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      const code = failure instanceof Error && "code" in failure ? failure.code : "";
      if (code === "draft-changed") {
        setSavedDraft(undefined);
        setDraftFeedback({ error: true, message: "本机草稿已在另一窗口发生变化。可继续编辑配置，重开编辑器可查看最新草稿。" });
      } else if (code === "draft-busy") {
        setDraftFeedback({ error: true, message: "另一窗口正在处理本机草稿，请稍后重试。" });
      } else if (code === "stale-observation") {
        setError("配置来源已变化，请重新读取来源后再保存本机草稿。");
      } else {
        setDraftFeedback({ error: true, message: action === "save" ? "本机草稿保存失败。" : "无法确认本机草稿已清除。" });
      }
    } finally {
      if (!controller.signal.aborted) {
        setDraftOperation(undefined);
        setBusy(false);
      }
    }
  }

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!model || busy || conflicts.length) return;
    const form = new FormData(event.currentTarget);
    const nextDraft = readDraft(model, form);
    const changes: Record<string, SettingsChange> = {};
    const requested: FieldDelta[] = [];
    for (const field of model.fields) {
      if (field.readOnly) continue;
      const value = String(form.get(field.id) ?? "");
      if (field.secret) {
        const action = readSecretAction(model.id, field, form);
        if (!action) continue;
        changes[field.id] = action === "replace" ? { action, value } : { action };
        requested.push({
          id: field.id, name: fieldLabel(field), before: field.configured ? "已设置" : "未设置", after: displayAction(action),
        });
      } else {
        if (Object.hasOwn(nextDraft, field.id)) {
          const control = event.currentTarget.elements.namedItem(field.id);
          if (control instanceof HTMLInputElement && !control.reportValidity()) return;
          const typed = inputValue(field, value);
          if (typed === null) return;
          changes[field.id] = { value: typed };
          requested.push({ id: field.id, name: fieldLabel(field), before: String(field.value ?? ""), after: String(typed) });
        }
      }
    }
    setDraft(nextDraft);
    setError("");
    setRecoveryRequired(false);
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
    const stored = savedDraft?.draft;
    const appliedDraftTag = stored && savedDraft?.tag &&
      Object.entries(stored.values).every(([field, value]) => draft[field] === value) &&
      Object.entries(stored.secretActions).every(([field, action]) =>
        delta.some(item => item.id === field && item.after === displayAction(action))) ? savedDraft.tag : undefined;
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
      setDraftFeedback(undefined);
      if (appliedDraftTag) {
        try {
          await clearStoredDraft(appliedDraftTag, controller.signal);
        } catch (failure) {
          if (!controller.signal.aborted) {
            const changed = failure instanceof Error && "code" in failure && failure.code === "draft-changed";
            setDraftFeedback({ message: changed
              ? "本机草稿已在另一窗口更改，已保留该草稿。"
              : "无法确认本机草稿已清除。下次打开可核对草稿状态。", error: true });
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "保存失败，请重新读取。");
        setRecoveryRequired(err instanceof Error && "code" in err && err.code === "project-recovery-required");
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
  if (phase === "edit" && model) actions = <>
    {savedDraft?.tag && <Button variant="outline" type="button" disabled={busy} onClick={() => void updateStoredDraft("clear")}>
      {draftOperation === "clear" ? "正在清除草稿…" : "清除本机草稿"}
    </Button>}
    {(model.fields.length > 0 || conflicts.length > 0) && <>
      <Button variant="outline" type="button" disabled={busy || !canStoreDraft || conflicts.length > 0} onClick={() => void updateStoredDraft("save")}>
        {draftOperation === "save" ? "正在保存草稿…" : "保存本机草稿"}
      </Button>
      <Button form="settings-form" type="submit" disabled={busy || conflicts.length > 0}>
        {busy && !draftOperation ? "正在预览…" : "预览修改"}
      </Button>
    </>}
  </>;
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
      {savedDraft?.status === "unreadable" && <Notice error>本机草稿无法读取，可继续编辑配置或清除本机草稿。</Notice>}
      {savedDraft?.status === "source-changed" && <Notice error>本机草稿的配置来源或字段已变化，可继续编辑配置或清除本机草稿。</Notice>}
      {reviewDraftCredentials && <Notice>草稿记录了凭据操作。请重新选择操作，替换时重新输入凭据。</Notice>}
      <p className="text-muted-foreground">{shared ? "凭据及可能含访问参数的地址仅显示设置状态。"
        : "IRIS 账号与密码需成对替换，其余字段可单独修改。凭据仅显示设置状态。"}</p>
      {canStoreDraft && <p className="text-muted-foreground">本机草稿只保存非敏感修改和凭据的替换、清除意图。重开时需重新选择凭据设置。</p>}
      {conflicts.length > 0 ? <div className="space-y-3">
        <Notice>以下字段在编辑期间发生变化，请逐项确认后再预览。重新读取后需重新输入替换凭据。</Notice>
        {conflicts.map(field => <fieldset key={field.id} className="min-w-0 space-y-2 rounded-lg border p-3">
          <legend className="px-2 font-medium">{field.name}</legend>
          <p className="break-all">来源值 · {field.source ? String(field.source.value ?? "未设置") || "空值" : "此字段已不可编辑"}</p>
          <p className="break-all">我的修改 · {field.local || "空值"}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => resolveConflict(field, false)}>使用来源值</Button>
            {field.canKeep && <Button variant="outline" onClick={() => resolveConflict(field, true)}>保留我的修改</Button>}
          </div>
        </fieldset>)}
      </div> : model.fields.length ? <form ref={formRef} noValidate id="settings-form" onSubmit={preview} autoComplete="off" className="space-y-4">
        <fieldset disabled={busy} className="min-w-0 space-y-4"><SettingsFields model={model} draft={draft} handoff={handoff} /></fieldset>
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
    {phase === "saved" && <div tabIndex={-1} ref={phaseFocus} className="outline-none"><Notice>{message}</Notice>{delta.some(d=>d.id.startsWith("irisConnections.")) && <VerifyConnection handoff={handoff} />}</div>}
    {draftFeedback && (phase === "edit" || phase === "saved") && <Notice error={draftFeedback.error}>{draftFeedback.message}</Notice>}
    {error && phase !== "read-error" && <Notice error>{error} {recoveryRequired
      ? <Button asChild variant="outline" size="sm" className="ml-1"><a href={href("tasks")}>查看保存回执</a></Button>
      : <Button variant="outline" size="sm" className="ml-1" onClick={reload}>重新读取来源</Button>}
    </Notice>}
  </WorkbenchDialog>;
}
