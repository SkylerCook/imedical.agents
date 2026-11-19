import { projects as fixtures, state, save, reset, task, prompt } from "../../prototype/mock.js";
import type { DemoId } from "./routes";
import type { Catalog } from "./api";

export { save, reset };
export const projects: Record<DemoId, { name: string; kind: string; path: string; parent?: string }> = fixtures;
export type Library = "a" | "b";
export const libraries = { a: "开发库 A", b: "开发库 B" };
export type DemoConnection = { host: string; port: number; secret: boolean };
export type DemoDraft = { name: string; mode: string; library: Library; host: string; port: string; secret: string };
export type DemoTask = {
  id: string; title: string; type: string; status: string; steps: string[];
  answer: string; returned: boolean; plugin: string; required?: string[]; entry?: string;
};
export type DemoProject = {
  name: string; installed: boolean; environment: boolean; wizard: number; client: string;
  mode: string; activeLibrary: Library; connections: Record<Library, DemoConnection>;
  plugins: Record<string, boolean>; clients: Record<string, string>; tasks: DemoTask[];
  vector: number; updated: boolean; legacy: boolean; custom: boolean; conflict: boolean;
  purpose?: string; deployTask?: string; editorDraft?: DemoDraft; available?: string[];
  pendingPlugin?: string; needsReconnect?: boolean; tested?: boolean;
};

export const demoState = (id: DemoId) => state(id) as DemoProject;
export const demoTask = (id: DemoId, title: string, type: string, status: string) => task(id, title, type, status) as DemoTask;
export const demoPrompt = (id: DemoId, item: DemoTask) => prompt(id, item);
export const demoName = (id: DemoId) => demoState(id).name || projects[id].name;
export const activeConnection = (project: DemoProject) => project.connections[project.activeLibrary];
export const alias = (name: string) => ({
  "coding-iris-plugin": "iris", "bos-plugin": "bos", "imedical-ui": "ui",
} as Record<string, string>)[name] ?? name;

export function requiredPlugins(catalog: Catalog, pluginName: string) {
  const catalogByKey = new Map(catalog.plugins.map(item => [alias(item.name), item]));
  const visited = new Set<string>();
  function visit(key: string) {
    if (visited.has(key)) return;
    visited.add(key);
    catalogByKey.get(key)?.dependencies.forEach(name => visit(alias(name)));
  }
  visit(alias(pluginName));
  return [...visited];
}

export function defaults(id: DemoId): DemoDraft {
  const project = demoState(id), connection = activeConnection(project);
  return { name: demoName(id), mode: project.mode, library: project.activeLibrary,
    host: connection.host, port: String(connection.port), secret: "keep" };
}
