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
export async function frameworkAction(action: "refresh" | "check" | "preview", projectId: string, revision: string | null) {
  const csrf = await session ?? await exchange();
  session = Promise.resolve(csrf);
  const response = await fetch("/framework/action", {
    method: "POST", headers: { ...headers, "X-Workbench-CSRF": csrf },
    body: JSON.stringify({ action, projectId, revision }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
