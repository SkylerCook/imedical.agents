const headers = { "X-Workbench-Request": "1", "Content-Type": "application/json" };
const prefix = "#bootstrap=";
const token = location.hash.startsWith(prefix) ? location.hash.slice(prefix.length) : undefined;
if (token) history.replaceState(null, "", location.pathname + location.search + "#home");

async function exchange(bootstrap?: string): Promise<string> {
  const response = await fetch("/framework/session", {
    method: "POST", headers, body: JSON.stringify(bootstrap ? { token: bootstrap } : {}),
  });
  if (!response.ok) throw new Error("请从工作台启动器重新打开当前工程。");
  return (await response.json()).csrf;
}

// Start the one-time exchange before route rendering. Reloads can resume via the session cookie.
let session = token ? exchange(token).catch(() => undefined) : undefined;
async function frameworkPost(route: string, body: object) {
  const csrf = await session ?? await exchange();
  session = Promise.resolve(csrf);
  return fetch("/framework/" + route, {
    method: "POST", headers: { ...headers, "X-Workbench-CSRF": csrf },
    body: JSON.stringify(body),
  });
}

export type OverlaySelection = { overlayPlanId: string; memberIds: string[] };

export async function openOverlayWorkbench(projectId: string, revision: string | null, overlayPlanId: string, memberId?: string) {
  const response = await frameworkPost("overlay/open", { projectId, revision, overlayPlanId, ...(memberId ? { memberId } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as { address: string };
}

export async function refreshOverlayWorkbench(projectId: string, revision: string | null, overlayPlanId: string) {
  const response = await frameworkPost("overlay/refresh", { projectId, revision, overlayPlanId });
  const result = await response.json();
  if (!response.ok && !result.memberUpdate) throw new Error(result.error);
  return result;
}

export async function frameworkAction(action: "verify-connection" | "discover-iris-mcp" | `plugin-${"inspect"|"install"|"enable"|"disable"}:${string}` | "refresh" | "check" | "preview" | "install" | "fetch-preview" | "apply" | "refresh-overlay" | "install-index" | "remove-index", projectId: string, revision: string | null, selection?: OverlaySelection) {
  const response = await frameworkPost("action", { action, projectId, revision: revision ?? null, ...selection });
  const result = await response.json();
  if (!response.ok && !result.before) throw new Error(result.error);
  return result;
}

export async function knowledgeBuildAction(body: { action: "preview" | "start" | "status"; projectId: string; revision: string | null; planId?: string }) {
  const response = await frameworkPost("knowledge-build", body);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export type OfflinePlan = { selectionId: string; revision: string; ref: string; install: boolean };

export async function offlineFrameworkAction(action: "select" | "apply", projectId: string, revision: string | null, selectionId?: string) {
  const response = await frameworkPost("offline", { action, projectId, revision: revision ?? null,
    ...(action === "apply" ? { selectionId } : {}) });
  const result = await response.json();
  if (!response.ok && !result.before) throw new Error(result.error);
  return result;
}

export type AgentHandoffSelection = { host: string } | { purpose: "project-check" };

export async function prepareAgentHandoff(selection: AgentHandoffSelection): Promise<{ name: string; prompt: string }> {
  const state = await fetch("/framework.json", { headers: { "X-Workbench-Request": "1" } });
  if (!state.ok) throw new Error("handoff-unavailable");
  const { projectId } = await state.json();
  const response = await frameworkPost("agent-handoff", { ...selection, projectId });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export async function workbenchReleaseAction(action: "open" | "rollback", projectId: string, revision: string | null) {
  const response = await frameworkPost("release-update", { action, projectId, revision: revision ?? null });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as { cancelled: true } | { version: string; address: string; selectionSaved: boolean; canRollback: boolean };
}
