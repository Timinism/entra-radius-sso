"use client";

import Link from "next/link";

import { usePoll } from "@/components/api";
import { Empty, ErrorNote, PageIntro, ResultText, VendorMark } from "@/components/bits";
import { formatCt } from "@/lib/time";

type Row = {
  id: string;
  username: string;
  deviceName: string;
  vendor: "cisco" | "paloalto";
  service: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  result: { code: string; reason: string } | null;
};

export default function ApprovalsPage() {
  const { data, error, loading } = usePoll<{ approvals: Row[] }>("/api/approvals", 2000);
  const rows = data?.approvals ?? [];
  const waiting = rows.filter((row) => row.status === "pending");
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageIntro kicker="Live queue" title="Approvals" />
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        A switch or firewall sits on the RADIUS request until someone finishes this page. Open the row on the phone
        you have next to the CLI.
      </p>
      {error ? <ErrorNote>{error.message}</ErrorNote> : null}
      {loading && !data ? <p className="text-sm text-muted-foreground">Loading approvals…</p> : null}
      {data && waiting.length === 0 ? (
        <Empty title="No one is waiting">
          When a device sends an Access-Request, it shows up here with the username and a countdown.
        </Empty>
      ) : null}
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`/approvals/${row.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/60">
              <VendorMark vendor={row.vendor} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {row.username} <span className="text-muted-foreground">on {row.deviceName}</span>
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {row.service === "globalprotect" ? "GlobalProtect" : "Device admin"} · {formatCt(row.createdAt)}
                  {row.status === "pending" ? ` · until ${formatCt(row.expiresAt)}` : ""}
                </p>
              </div>
              <ResultText result={row.result?.code ?? row.status} />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
