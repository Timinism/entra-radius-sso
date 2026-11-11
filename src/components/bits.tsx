import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Vendor } from "@/lib/types";

export function VendorMark({ vendor }: { vendor: Vendor }) {
  const cisco = vendor === "cisco";
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 font-mono text-[10px] font-medium",
        cisco ? "bg-cisco/15 text-cisco" : "bg-pa/15 text-pa",
      )}
    >
      {cisco ? "IOS" : "PA"}
    </span>
  );
}

export function ResultText({ result }: { result: string }) {
  const tone =
    result === "accept" || result === "accounted"
      ? "text-good"
      : result === "reject"
        ? "text-destructive"
        : "text-wait";
  return <span className={cn("font-mono text-xs tracking-wide uppercase", tone)}>{result}</span>;
}

export function ModeBadge({ mode }: { mode: "entra" | "sample" | undefined }) {
  if (mode === "entra") return <Badge>Microsoft Entra</Badge>;
  return <Badge variant="outline">Sample directory</Badge>;
}

export function PageIntro({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">{kicker}</p>
        <h1 className="mt-1 font-serif text-4xl tracking-tight">{title}</h1>
      </div>
      {children}
    </header>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border border-border bg-card/80", className)}>{children}</section>;
}

export function Empty({ title, children }: { title: string; children: string }) {
  return (
    <Panel className="px-5 py-8">
      <h2 className="font-serif text-2xl">{title}</h2>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{children}</p>
    </Panel>
  );
}

export function ErrorNote({ children }: { children: string }) {
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

export function AttrTable({ rows }: { rows: { name: string; value: string; id?: string }[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No attributes.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.name}-${index}`} className="border-t border-border first:border-t-0">
              <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{row.id ?? ""}</td>
              <td className="py-2 pr-4">{row.name}</td>
              <td className="py-2 font-mono text-[13px]">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function fieldClass() {
  return "h-9 w-full rounded-lg border border-input bg-background/40 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
}
