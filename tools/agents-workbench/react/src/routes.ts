export const pages = ["home", "config", "plugins", "clients", "connections", "knowledge", "manual", "scope", "tasks", "modules"] as const;
export type Page = typeof pages[number];
export const demoIds = ["clinic", "fresh", "root", "dental", "nursing"] as const;
export type DemoId = typeof demoIds[number];
export type Params = Record<string, string | undefined>;
export type Route = { page: Page; demo: DemoId | null; params: URLSearchParams };

export function readRoute(): Route {
  const [path, query] = location.hash.slice(1).split("?", 2);
  const parts = path.split("/");
  const startsInDemo = document.querySelector<HTMLMetaElement>('meta[name="workbench-mode"]')?.content === "demo";
  const demo = parts[0] === "" && parts.length > 1 ? demoIds.find(id => id === parts[1]) ?? "clinic"
    : !path && startsInDemo ? "clinic" : null;
  const page = pages.find(name => name === (demo ? parts[2] : parts[0]));
  return {
    page: page === "modules" && demo !== "root" ? "home" : page ?? "home",
    demo,
    params: new URLSearchParams(query),
  };
}

export function href(page: Page, demo: DemoId | null = null, params: Params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  return "#" + (demo ? `/${demo}/` : "") + page + (query.size ? "?" + query : "");
}

export type Navigation = {
  route: Route;
  go: (page: Page, params?: Params, demo?: DemoId | null) => void;
  replace: (changes: Params) => void;
};
