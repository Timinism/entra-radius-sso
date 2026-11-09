"use client";

import { useState } from "react";

import { usePoll } from "@/components/api";
import { ErrorNote, PageIntro, ResultText, VendorMark } from "@/components/bits";
import { formatCtDate } from "@/lib/time";
import type { AuthEvent } from "@/lib/types";

export default function AuditPage() {
  const { data, error, loading } = usePoll<{ events: AuthEvent[] }>("/api/audit", 3000);
  const [result, setResult] = useState("all");
  const [vendor, setVendor] = useState("all");
  const events = (data?.events ?? []).filter((event) => {
    if (result !== "all" && event.result !== result) return false;
    if (vendor !== "all" && event.vendor !== vendor) return false;
    return true;
  });
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageIntro kicker="Who got on, and why" title="Audit" />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Filter value={result} onChange={setResult} options={[["all", "All results"], ["accept", "Accepted"], ["reject", "Rejected"], ["accounted", "Accounting"]]} />
        <Filter value={vendor} onChange={setVendor} options={[["all", "All vendors"], ["cisco", "Cisco"], ["paloalto", "Palo Alto"]]} />
      </div>
      {error ? <ErrorNote>{error.message}</ErrorNote> : null}
      {loading && !data ? <p className="text-sm text-muted-foreground">Loading the audit…</p> : null}
      <div className="overflow-x-auto rounded-xl border border-border bg-card/80">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Device</th>
              <th className="px-4 py-3 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{formatCtDate(event.at)}</td>
                <td className="px-4 py-3"><ResultText result={event.result} /></td>
                <td className="px-4 py-3 font-mono text-[13px]">{event.username}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2">
                    <VendorMark vendor={event.vendor} />
                    {event.deviceName}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{event.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && events.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No events match.</p> : null}
      </div>
    </main>
  );
}

function Filter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[][];
}) {
  return (
    <select className="h-8 rounded-lg border border-input bg-background/40 px-2" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([option, label]) => (
        <option key={option} value={option}>{label}</option>
      ))}
    </select>
  );
}
