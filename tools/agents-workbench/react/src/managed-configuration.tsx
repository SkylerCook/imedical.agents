import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { settingsRequest, type SettingsPlan } from "./api";
import { Notice, Panel, selectClass } from "./ui";

type Value = string | number | boolean | Value[] | { [key: string]: Value } | null;
type Fields = { [key: string]: Field };
type Field = {
  type: string;
  label: string;
  description: string;
  readOnly?: boolean;
  properties?: Fields;
  items?: Field;
  options?: string[];
  min?: number;
  max?: number;
  integer?: boolean;
};
type Section = {
  id: string;
  path?: (string | number)[];
  source: string;
  value?: { [key: string]: Value };
  pending?: boolean;
  conflict?: string;
  editable: boolean;
  definition: Field;
};
type Model = { revision: string; installed: boolean; scope: string; sections: Section[] };
const visible = new Set(["projectContext", "documentationLayout", "irisRemotePolicy", "irisSessionBackend", "mcp"]);
const ownerReview = new Set(["irisRemotePolicy", "irisSessionBackend", "mcp", "frontendEncoding"]);
const object = (value?: Value): { [key: string]: Value } =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const previewValue = (value?: string | number | boolean) =>
  value === true ? "启用" : value === false ? "关闭" : String(value ?? "未配置");

function FormField({ field, value, update, disabled }: {
  field: Field; value?: Value; update: (value: Value) => void; disabled?: boolean;
}) {
  if (field.properties) return <fieldset className="min-w-0 space-y-3 rounded-md border p-3">
    <legend className="px-1 text-sm font-medium">{field.label}</legend>
    <p className="text-xs text-muted-foreground">{field.description}</p>
    {Object.entries(field.properties).map(([key, child]) =>
      <FormField key={key} field={child} value={object(value)[key]} disabled={disabled}
        update={next => update({ ...object(value), [key]: next })} />)}
  </fieldset>;
  if (field.items) {
    const items = Array.isArray(value) ? value : [];
    const template = field.items;
    const locked = disabled || template.readOnly;
    function edit(index: number, next: Value) {
      update(items.map((item, i) => i === index ? next : item));
    }
    return <fieldset className="min-w-0 space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{field.label}</legend>
      <p className="text-xs text-muted-foreground">{field.description}</p>
      {items.map((item, index) => <div key={index} className="space-y-2 border-b pb-3">
        <FormField field={template} value={item} update={next => edit(index, next)} disabled={locked} />
        {!locked && <Button type="button" size="sm" variant="outline"
          onClick={() => update(items.filter((_, i) => i !== index))}>移除此项</Button>}
      </div>)}
      {!locked && <Button type="button" size="sm" variant="outline"
        onClick={() => update([...items, template.properties ? {} : ""])}>添加{template.label}</Button>}
      {locked && items.length === 0 && <p className="text-sm text-muted-foreground">未配置</p>}
    </fieldset>;
  }
  if (disabled || field.readOnly) return <div className="min-w-0 break-words text-sm">
    <p className="text-muted-foreground">{field.label}</p>
    <p>{value === true ? "是" : value === false ? "否" : String(value ?? "未配置")}</p>
  </div>;
  const choices = field.options ?? (field.type === "boolean" ? ["true", "false"] : undefined);
  return <label className="grid min-w-0 gap-1.5 text-sm">
    <span>{field.label}</span>
    {choices ? <select className={selectClass} value={String(value ?? "")}
      onChange={event => update(field.type === "boolean" ? event.target.value === "true" : event.target.value)}>
      <option value="" disabled>未配置</option>
      {choices.map(choice => <option key={choice} value={choice}>{choice === "true" ? "启用" : choice === "false" ? "关闭" : choice}</option>)}
    </select> : <Input type={field.type === "number" ? "number" : "text"}
      value={value == null ? "" : String(value)} min={field.min} max={field.max} step={field.integer ? 1 : "any"}
      onChange={event => update(field.type === "number"
        ? event.target.value === "" ? null : Number(event.target.value)
        : event.target.value)} />}
    <span className="text-xs text-muted-foreground">{field.description}</span>
  </label>;
}

function SectionForm({ section, model, onSaved, onReview }: {
  section: Section; model: Model; onSaved: () => void; onReview: (id: string) => void;
}) {
  const [draft, setDraft] = useState(section.value ?? {});
  const [plan, setPlan] = useState<SettingsPlan>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const enabled = model.installed && section.editable;
  const fields = section.definition.properties ?? {};
  const edits = Object.entries(fields).filter(([key, field]) => !field.readOnly && key in draft &&
      JSON.stringify(draft[key]) !== JSON.stringify(section.value?.[key]))
    .map(([key]) => ({ path: [...(section.path ?? [section.id]), key], value: draft[key] }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !enabled || edits.length === 0) return;
    setBusy(true);
    setMessage("");
    try {
      const signal = AbortSignal.timeout(15000);
      if (plan) {
        await settingsRequest("apply", signal, { planId: plan.planId });
        onSaved();
      } else {
        setPlan(await settingsRequest<SettingsPlan>("plan/managed", signal, { revision: model.revision, edits }));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法保存工程配置");
      setPlan(undefined);
    } finally {
      setBusy(false);
    }
  }

  return <details className="rounded-lg border p-3 sm:p-4">
    <summary className="cursor-pointer font-medium">{section.definition.label}{section.pending ? " · 待迁移" : ""}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">{section.definition.description}</p>
      <p className="text-xs text-muted-foreground">{model.scope === "workspace-overlay" ? "当前工作区" : "当前工程"} · {section.source}</p>
      {section.conflict && <Notice error>请核对配置来源。{section.conflict}</Notice>}
      {section.pending && <Notice>沿原更新流程完成此分节的迁移后即可维护。</Notice>}
      {message && <Notice error>{message}</Notice>}
      <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={busy || !!plan} className="grid gap-3 sm:grid-cols-2">
          {Object.entries(fields).map(([key, field]) =>
            <FormField key={key} field={field} value={draft[key]} disabled={!enabled}
              update={value => setDraft(previous => ({ ...previous, [key]: value }))} />)}
        </fieldset>
        {plan && <div role="status" className="space-y-2 rounded-md border p-3 text-sm">
          <p>将保存到 {section.source}</p>
          <ul className="list-disc space-y-1 pl-5">
            {plan.changes.map(change => <li key={change.field}>
              <span>{change.label ?? change.field}</span>
              <p className="break-words text-muted-foreground">{previewValue(change.before)} → {previewValue(change.after)}</p>
            </li>)}
          </ul>
        </div>}
        {enabled && <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy || edits.length === 0}>{plan ? "确认保存" : "预览修改"}</Button>
          {plan && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPlan(undefined)}>返回编辑</Button>}
        </div>}
      </form>
      {(section.pending || section.conflict || ownerReview.has(section.id)) && <Button type="button" size="sm" variant="outline"
        onClick={() => onReview(section.id.startsWith("menuSync.") ? "menuSync" : section.id)}>准备 Agent 核对请求</Button>}
    </div>
  </details>;
}

export function ManagedConfiguration({ onReview }: { onReview: (id: string) => void }) {
  const [model, setModel] = useState<Model>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    settingsRequest<Model>("managed",controller.signal).then(result => {
      setModel(result);
      setError("");
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [reload]);

  return <Panel title="工程设置" hint="查看当前工程的 JSONC 分节。高级项按用途展开。">
    <div className="space-y-3">
      {error && <Notice error>{error}</Notice>}
      {!model && !error && <p role="status" className="text-sm text-muted-foreground">正在读取工程配置…</p>}
      {saved && <p role="status" className="text-sm">已保存并读回配置。</p>}
      {model && !model.installed && <Notice>更新当前工程的框架后即可从这里保存配置。</Notice>}
      {model?.sections.filter(section => visible.has(section.id) || section.path).map(section =>
        <SectionForm key={section.id + model.revision} section={section} model={model}
          onReview={onReview}
          onSaved={() => { setSaved(true); setReload(value => value + 1); }} />)}
      {(model || error) && <Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>读取当前配置</Button>}
    </div>
  </Panel>;
}
