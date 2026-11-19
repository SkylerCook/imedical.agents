import type { ReactNode } from "react";
import { ChevronDown, CircleAlert, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function PageHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0"><h2 id="page-heading" tabIndex={-1} className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-[78ch] text-sm leading-6 text-muted-foreground">{description}</p></div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

export function Panel({ title, hint, actions, children, className }: {
  title: string; hint?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string;
}) {
  return <section className={cn("min-w-0 rounded-lg border bg-muted", className)}>
    <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0"><h3 className="font-semibold">{title}</h3>
        {hint && <div className="mt-1 break-words text-sm leading-6 text-muted-foreground">{hint}</div>}</div>
      {actions}
    </header>
    {children && <div className="min-w-0 border-t px-4 py-4 sm:px-5">{children}</div>}
  </section>;
}

export function Status({ children, emphasis = false }: { children: ReactNode; emphasis?: boolean }) {
  return <Badge variant="outline" className={cn(!emphasis && "text-muted-foreground")}>{children}</Badge>;
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? "alert" : "status"} className={cn("min-w-0 rounded-md border bg-background px-3 py-2.5 text-sm leading-6 wrap-anywhere",
    error ? "border-destructive/45 text-destructive" : "text-muted-foreground")}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <section className="rounded-lg border bg-muted px-5 py-8">
    <h3 className="font-medium">{title}</h3>
    {children && <div className="mt-2 flex flex-wrap items-center gap-3 text-sm leading-6 text-muted-foreground">{children}</div>}
  </section>;
}

export function ReadState({ error, retry, label }: { error?: string; retry?: () => void; label: string }) {
  return error ? <Empty title={label}>
    <div role="alert" className="flex w-full items-start gap-2 text-destructive"><CircleAlert className="mt-1 size-4 shrink-0" />{error}</div>
    {retry && <Button variant="outline" onClick={retry}>重新读取</Button>}
  </Empty> : <div role="status" aria-label={label} className="space-y-3 rounded-lg border bg-muted p-5">
    <span className="text-sm text-muted-foreground">{label}</span>
    <Skeleton className="h-8 w-4/5 max-w-80" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" />
  </div>;
}

export function GridTable({ label, headers, rows, className }: {
  label: string; headers: string[]; rows: (readonly ReactNode[])[]; className?: string;
}) {
  return <div className={cn("min-w-0 rounded-md border bg-background", className)}>
    <Table aria-label={label}>
      <TableHeader className="bg-muted"><TableRow>{headers.map((name, index) =>
        <TableHead scope="col" key={index} className="h-10 px-3 text-muted-foreground">{name}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((cells, index) => <TableRow key={index} className="align-top">{cells.map((cell, i) =>
        <TableCell key={i} className="px-3 py-2.5 whitespace-normal wrap-anywhere">{cell}</TableCell>)}</TableRow>)}</TableBody>
    </Table>
  </div>;
}

export function Details({ title, children, open }: { title: ReactNode; children: ReactNode; open?: boolean }) {
  return <details open={open} className="group/details min-w-0 border-b last:border-b-0">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm px-1 py-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
      {title}<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-open/details:rotate-180" />
    </summary>
    <div className="min-w-0 px-1 pb-4">{children}</div>
  </details>;
}

export function SearchField({ label, placeholder, value, onChange, inputRef }: {
  label: string; placeholder?: string; value: string; onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return <div className="relative min-w-0">
    <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
    <Input ref={inputRef} type="search" aria-label={label} placeholder={placeholder || label} className="pl-8" value={value}
      onChange={event => onChange(event.target.value)} />
  </div>;
}

export const selectClass = "h-9 min-w-0 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring";
export const textareaClass = "w-full rounded-md border border-input bg-background p-3 text-sm leading-6 focus-visible:outline-2 focus-visible:outline-ring";

export function WorkbenchDialog({ title, description, children, actions, onClose, busy = false }: {
  title: string; description: string; children?: ReactNode; actions?: ReactNode; onClose: () => void; busy?: boolean;
}) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={false}
      className="max-h-[calc(100dvh-1.5rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-popover p-0 sm:max-w-[48rem]">
      <DialogHeader className="border-b px-4 py-4 text-left sm:px-6">
        <DialogTitle className="leading-7 wrap-anywhere">{title}</DialogTitle>
        <DialogDescription className="leading-6">{description}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 min-w-0 space-y-4 overflow-auto px-4 py-4 text-sm leading-6 sm:px-6">{children}</div>
      <DialogFooter className="flex flex-row flex-wrap items-center justify-between gap-2 border-t px-4 py-3 sm:justify-between sm:px-6">
        <DialogClose asChild><Button variant="outline" disabled={busy}>关闭</Button></DialogClose>
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
