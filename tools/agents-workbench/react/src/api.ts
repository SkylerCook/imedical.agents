import { useEffect, useState } from "react";

export type Catalog = Omit<import("../../prototype/plugin-directory.mjs").Catalog, "plugins"> & {
  groups: { id: string; name: string; plugins: string[] }[];
  plugins: (import("../../prototype/plugin-directory.mjs").Plugin & { directory: string })[];
};
export type Guide = { file: string; title: string };
export type Domain = {
  name: string; status: string; scope: string; source: string;
  fields: { key: string; status: string; sensitive: boolean }[];
};
export type ProjectSummary = {
  name: string;
  checkedAt: string;
  hasFramework: boolean;
  domains: Domain[];
  plugins: import("../../prototype/plugin-directory.mjs").PluginState[];
  profiles: { name: string; exists: boolean }[];
  clients: { name: string; entries: string[]; status: string }[];
  indexes: { name: string; exists: boolean; bytes?: number; updated?: string }[];
  receipts: { id: string; state: string; files: number; updated: string }[];
};

async function json<T>(response: Response, unavailable: string): Promise<T> {
  if (!response.ok) throw new Error(unavailable);
  const value: T & { error?: string } = await response.json();
  if (value.error) throw new Error(value.error);
  return value;
}

export const readProject = (signal: AbortSignal) =>
  fetch("/project.json", { signal, cache: "no-store" }).then(r => json<ProjectSummary>(r, "工程状态暂时无法读取。"));
export const readCatalog = (signal: AbortSignal) =>
  fetch("/catalog.json", { signal, cache: "no-store" }).then(r => json<Catalog>(r, "插件目录暂时无法读取。"));
export const readGuides = (signal: AbortSignal) =>
  fetch("/manuals.json", { signal }).then(r => json<Guide[]>(r, "手册目录暂时无法读取。"));

export async function readGuide(file: string, signal: AbortSignal) {
  const response = await fetch("/manual/" + encodeURIComponent(file), { signal });
  if (!response.ok) throw new Error("无法读取本地手册。");
  return response.text();
}

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [result, setResult] = useState<{ data?: T; error?: string }>({});
  const [revision, setRevision] = useState(0);
  const retry = () => { setResult({}); setRevision(current => current + 1); };
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    load(controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ data }); },
      error => { if (!controller.signal.aborted) setResult({ error: error instanceof Error ? error.message : "读取失败。" }); },
    );
    return () => controller.abort();
  }, [load, enabled, revision]);
  return { ...result, retry, refresh: () => setRevision(current => current + 1), loading: enabled && !result.data && !result.error };
}

export type SettingsId = "project" | "bos" | "knowledge";
export type SettingsField = {
  id: string; label: string; type: string; secret?: boolean; configured?: boolean;
  value?: string | number | boolean | null;
};
export type SettingsModel = { id: SettingsId; revision: string; scope: string; fields: SettingsField[] };
export type SettingsChange = { action?: "replace" | "clear"; value?: string | number | boolean };
export type SettingsPlan = {
  planId: string; scope: string; warning: string; warnings?: string[];
  changes: { field: string; action: string }[];
};

export async function settingsRequest<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const headers: Record<string, string> = { "X-Workbench-Request": "1" };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch("/settings/" + path, {
    method: body ? "POST" : "GET", headers, signal, cache: "no-store",
    body: body && JSON.stringify(body),
  });
  const value: T & { error?: string } = await response.json();
  if (!response.ok) throw new Error(value.error || "无法完成配置请求。");
  return value;
}
