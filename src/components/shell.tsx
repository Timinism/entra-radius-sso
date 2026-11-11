"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { usePoll } from "@/components/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Board" },
  { href: "/approvals", label: "Approvals" },
  { href: "/devices", label: "Devices" },
  { href: "/policies", label: "Policies" },
  { href: "/directory", label: "Directory" },
  { href: "/audit", label: "Audit" },
  { href: "/bench", label: "Test bench" },
  { href: "/guide", label: "Gear setup" },
  { href: "/components", label: "Components" },
] as const;

type Session = {
  viewer: { name: string; email: string; simulated: boolean; stage: "production" | "preview" };
  mode: "entra" | "sample";
  pending: number;
  listener: { bound: boolean; authPort: number; acctPort: number; error: string | null };
};

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = usePoll<Session>("/api/session", 4000);
  const signedOut = session.error?.status === 401;

  return (
    <div className="min-h-full md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b border-border md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center gap-3 px-4 py-4 md:px-5">
          <span className="relative grid size-9 place-items-center">
            <span className="absolute size-7 rounded-full border-2 border-primary" />
            <span className="h-0.5 w-4 rounded-full bg-primary" />
          </span>
          <div>
            <p className="font-serif text-2xl leading-none tracking-tight">Harbor</p>
            <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
              Entra for RADIUS
            </p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible md:px-3">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex shrink-0 items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                  active && "bg-muted text-foreground",
                )}
              >
                <span>{item.label}</span>
                {item.href === "/approvals" && session.data && session.data.pending > 0 ? (
                  <span className="rounded-full bg-wait px-1.5 font-mono text-[11px] text-primary-foreground">
                    {session.data.pending}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="hidden space-y-2 px-5 py-4 text-xs text-muted-foreground md:block">
          <p className="flex items-center gap-2">
            <span className={cn("size-1.5 rounded-full", session.data?.listener.bound ? "bg-good" : "bg-wait")} />
            {session.data?.listener.bound
              ? `UDP ${session.data.listener.authPort} / ${session.data.listener.acctPort}`
              : "UDP listener idle"}
          </p>
          <p>{session.data?.mode === "entra" ? "Microsoft Entra" : "Sample directory"}</p>
          <p className="truncate">{session.data?.viewer.name ?? "Operator"}</p>
        </div>
      </aside>
      <div className="min-w-0">
        {session.data?.viewer.stage === "preview" ? (
          <p className="bg-wait/15 px-4 py-2 text-center text-sm text-wait md:px-8">
            Preview copy. Changes here stay out of the published directory.
          </p>
        ) : null}
        {signedOut ? (
          <main className="mx-auto max-w-lg px-4 py-24">
            <h1 className="font-serif text-4xl">Sign in to open Harbor</h1>
            <p className="mt-3 text-muted-foreground">
              The console is for the operator who manages Cisco and Palo Alto sign-in. Your Cursor session is what
              opens it.
            </p>
          </main>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
