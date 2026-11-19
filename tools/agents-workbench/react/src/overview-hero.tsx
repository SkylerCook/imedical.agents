import type { ReactNode } from "react";

export function OverviewHero({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className="overview-hero relative isolate mb-5 overflow-hidden rounded-lg border bg-muted">
    <img className="overview-art" src="/react/workbench-overview.webp" alt="" width={1440} height={480} />
    <div className="overview-copy relative px-4 py-5 sm:px-6">
      <h2 id="page-heading" tabIndex={-1} className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </div>
  </header>;
}
