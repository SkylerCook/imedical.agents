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
export async function frameworkPost(route: string, body: object, signal?: AbortSignal) {
  const csrf = await session ?? await exchange();
  session = Promise.resolve(csrf);
  return fetch("/framework/" + route, {
    method: "POST", headers: { ...headers, "X-Workbench-CSRF": csrf },
    body: JSON.stringify(body), signal,
  });
}

export type FrameworkUpdateNote = {
  status: "update-available" | "current" | "unavailable" | "upstream-changed" | "recovery-required";
  scope: "standard" | "overlay";
  revision: string | null;
  targetRevision?: string;
  reason?: string;
  prompt?: string;
};

export async function readFrameworkUpdateNote(projectId: string, revision: string | null, signal?: AbortSignal): Promise<FrameworkUpdateNote> {
  const response = await frameworkPost("update-note", { projectId, revision }, signal);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export async function openOverlayWorkbench(projectId: string, revision: string | null, overlayPlanId: string, memberId?: string) {
  const response = await frameworkPost("overlay/open", { projectId, revision, overlayPlanId, ...(memberId ? { memberId } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as { address: string };
}

export async function frameworkAction(action: "verify-connection" | "discover-iris-mcp" | `plugin-${"inspect"|"install"|"enable"|"disable"}:${string}` | "refresh" | "check" | "install" | "install-index" | "remove-index", projectId: string, revision: string | null) {
  const response = await frameworkPost("action", { action, projectId, revision: revision ?? null });
  const result = await response.json();
  if (!response.ok && !result.before) throw new Error(result.error);
  return result;
}

export type KnowledgeBuildCommand = { action: "preview" } | { action: "start"; planId: string } | { action: "stop"; runId: string };

export async function knowledgeBuildAction(body: (KnowledgeBuildCommand | { action: "status" }) & { projectId: string; revision: string | null }) {
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

export type AgentTaskSelection = { purpose: "task" } & (
  { task: "plugin-init" | "manual" | "config-review"; item: string } |
  { task: "recovery-diagnosis"; item?: string } |
  { task: "iris-connection" | "iris-mcp" | "knowledge-index"; item?: never }
);
export type AgentHandoffSelection = { host: string } | { purpose: "project-check" } | AgentTaskSelection;

export async function prepareAgentHandoff(selection: AgentHandoffSelection, signal?: AbortSignal): Promise<{ name: string; prompt: string }> {
  const state = await fetch("/framework.json", { headers: { "X-Workbench-Request": "1" }, signal });
  if (!state.ok) throw new Error("handoff-unavailable");
  const { projectId } = await state.json();
  const response = await frameworkPost("agent-handoff", { ...selection, projectId }, signal);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

async function readOperationBinding(unavailable: string): Promise<{ projectId: string; revision: string | null }> {
  const state = await fetch("/framework.json", { headers: { "X-Workbench-Request": "1" }, cache: "no-store" });
  if (!state.ok) throw new Error(unavailable);
  const { projectId, revision } = await state.json();
  return { projectId, revision };
}

export type ProjectRecoveryIntent = "restore" | "verify" | "rollback";

export async function recoverProjectConfiguration(receiptId: string, recoveryToken: string, intent: ProjectRecoveryIntent) {
  const binding = await readOperationBinding("project-recovery-unavailable");
  const response = await frameworkPost("recover-project-config", { ...binding, receiptId, recoveryToken, ...(intent !== "restore" && { intent }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  const expectedState = { restore: "reverted-after-interruption", verify: "applied", rollback: "rolled-back" }[intent];
  if (result.receiptId !== receiptId || result.state !== expectedState)
    throw new Error("project-recovery-unavailable");
}

export async function exportProjectState(): Promise<Blob> {
  const unavailable = "project-export-unavailable";
  const binding = await readOperationBinding(unavailable);
  const response = await frameworkPost("export-state", binding);
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw new Error(unavailable);

  const result: unknown = await response.json();
  if (!result || typeof result !== "object") throw new Error(unavailable);
  if (!response.ok)
    throw new Error("error" in result && typeof result.error === "string" ? result.error : unavailable);
  if (!("schema" in result) || result.schema !== "agents-workbench-state/v1") throw new Error(unavailable);

  return new Blob([JSON.stringify(result, null, 2), "\n"], { type: "application/json;charset=utf-8" });
}

export async function workbenchReleaseAction(action: "open" | "rollback", projectId: string, revision: string | null) {
  const response = await frameworkPost("release-update", { action, projectId, revision: revision ?? null });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as { cancelled: true } | { version: string; address: string; selectionSaved: boolean; canRollback: boolean };
}
