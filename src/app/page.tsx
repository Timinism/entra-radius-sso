"use client";

import Link from "next/link";

import { usePoll } from "@/components/api";
import { AttrTable, Empty, ErrorNote, ModeBadge, PageIntro, Panel, ResultText, VendorMark } from "@/components/bits";
import { formatCt } from "@/lib/time";
import type { AuthEvent, DisplayAttr } from "@/lib/types";

type Overview = {
  settings: { mode: "entra" | "sample" };
  listener: { bound: boolean; authPort: number; tlsBound?: boolean; tlsPort?: number; error: string | null; tlsError?: string | null };
  counts: { accept: number; reject: number; pending: number; devices: number };
  pending: Array<{
    id: string;
    username: string;
    deviceName: string;
    vendor: "cisco" | "paloalto";
    service: string;
    expiresAt: string;
    location?: string;
  }>;
  events: AuthEvent[];
  devices: Array<{ id: string; name: string; vendor: "cisco" | "paloalto"; location: string; enabled: boolean }>;
};

export default function BoardPage() {
  const { data, error, loading } = usePoll<Overview>("/api/overview", 2000);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageIntro kicker="This shift, Chicago time" title="Sign-ins">
        <ModeBadge mode={data?.settings.mode} />
      </PageIntro>
      <p className="mb-6 max-w-2xl text-sm leading-6 text-muted-foreground">
        Cisco and Palo Alto keep sending RADIUS. SSO holds the request for a browser sign-in. A local password or an
        SSL certificate answers immediately. The reply carries the privilege level or admin role.
      </p>
      {error ? <ErrorNote>{error.message}</ErrorNote> : null}
      {data?.settings.mode === "sample" ? (
        <p className="mb-6 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
          Entra is not connected, so sign-ins use the sample Northline directory. The RADIUS reply is the real one a
          switch would get. Connect the tenant from Directory when you have an app registration.
        </p>
      ) : null}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Accepted today" value={data?.counts.accept} />
        <Stat label="Waiting" value={data?.counts.pending} />
        <Stat label="Rejected today" value={data?.counts.reject} />
        <Stat label="Devices" value={data?.counts.devices} />
      </div>
      {loading && !data ? <p className="text-sm text-muted-foreground">Loading the board…</p> : null}
      {data && data.pending.length > 0 ? (
        <div className="mb-6 space-y-2">
          {data.pending.map((approval) => (
            <Link
              key={approval.id}
              href={`/approvals/${approval.id}`}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-wait/40 bg-wait/10 px-4 py-3 hover:bg-wait/15"
            >
              <VendorMark vendor={approval.vendor} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {approval.deviceName} is waiting on {approval.username}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {approval.service === "globalprotect" ? "GlobalProtect" : "Device admin"} · until {formatCt(approval.expiresAt)}
                </p>
              </div>
              <span className="text-sm text-wait">Sign in</span>
            </Link>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Panel className="p-4">
          <h2 className="mb-3 font-display text-2xl">Recent decisions</h2>
          {data && data.events.length === 0 ? (
            <Empty title="Quiet so far">
              Nothing has authenticated today. Send a request from the test bench, or point a lab switch at the UDP listener.
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {data?.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 font-mono text-[13px]">
                  <span className="text-muted-foreground">{formatCt(event.at)}</span>
                  <ResultText result={event.result} />
                  <span>{event.username}</span>
                  <span className="text-muted-foreground">{event.deviceName}</span>
                  <span className="text-muted-foreground">{event.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel className="p-4">
            <h2 className="mb-3 font-display text-2xl">What the gear receives</h2>
            <AttrTable
              rows={
                [
                  { name: "Service-Type", value: "Administrative-User", id: "6" },
                  { name: "Cisco-AVPair", value: "shell:priv-lvl=15", id: "26:9:1" },
                  { name: "PaloAlto-Admin-Role", value: "superuser", id: "26:25461:1" },
                ] satisfies DisplayAttr[]
              }
            />
            <p className="mt-3 text-xs text-muted-foreground">
              A matched policy picks one vendor’s attributes. The password typed at the CLI is not sent to Entra.
            </p>
          </Panel>
          <Panel className="p-4">
            <h2 className="mb-2 font-display text-2xl">Listener</h2>
            <p className="text-sm text-muted-foreground">
              {data?.listener.bound
                ? `Accepting RADIUS on UDP ${data.listener.authPort}. Accounting is the next port.${data.listener.tlsBound ? ` SSL is TCP ${data.listener.tlsPort}.` : ""}`
                : data?.listener.error
                  ? data.listener.error
                  : "The UDP listener is not bound in this process. The test bench still runs the same decision."}
            </p>
          </Panel>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Panel className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{value ?? "–"}</p>
    </Panel>
  );
}
