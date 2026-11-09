"use client";

import Link from "next/link";
import { useState } from "react";

import { HarborError, harborFetch, usePoll } from "@/components/api";
import { AttrTable, ErrorNote, PageIntro, Panel, fieldClass } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Device } from "@/lib/types";

type BenchResponse = {
  pending: boolean;
  approval: { id: string; status: string; result: { code: string; reason: string; attributes: { name: string; value: string; id: string }[] } | null } | null;
  request: { code: string; attributes: { name: string; value: string; id: string }[] };
  response: { code: string; attributes: { name: string; value: string; id: string }[]; reason: string } | null;
};

const SAMPLES = [
  ["maya.chen", "Network admin"],
  ["luis.ortiz", "NOC operator"],
  ["priya.shah", "Read only"],
  ["jordan.hale", "Firewall engineer"],
  ["avery.nguyen", "Remote staff"],
  ["sam.okonkwo", "Contractor"],
  ["breakglass", "Emergency"],
];

export default function BenchPage() {
  const devices = usePoll<{ devices: Device[] }>("/api/devices", 0);
  const [deviceId, setDeviceId] = useState("core-sw01");
  const [username, setUsername] = useState("maya.chen");
  const [service, setService] = useState("device-admin");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<BenchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const device = devices.data?.devices.find((item) => item.id === deviceId) ?? devices.data?.devices[0];

  async function send() {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      const response = await harborFetch<BenchResponse>("/api/bench", {
        method: "POST",
        body: JSON.stringify({
          deviceId: device.id,
          username,
          service: device.service === "both" ? service : device.service === "globalprotect" ? "globalprotect" : "device-admin",
          password: password || undefined,
        }),
      });
      setResult(response);
    } catch (caught) {
      setError(caught instanceof HarborError ? caught.message : "The test request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageIntro kicker="Same code as the UDP listener" title="Test bench" />
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Build an Access-Request as if it came from the device. Harbor either answers immediately, for break-glass and
        for rejects, or opens an approval you finish in the browser.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="space-y-3 p-4">
          <Label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Device</span>
            <select className={fieldClass()} value={device?.id ?? ""} onChange={(event) => setDeviceId(event.target.value)}>
              {devices.data?.devices.map((item) => (
                <option key={item.id} value={item.id}>{item.name} · {item.nasIp}</option>
              ))}
            </select>
          </Label>
          {device?.service === "both" ? (
            <Label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Service</span>
              <select className={fieldClass()} value={service} onChange={(event) => setService(event.target.value)}>
                <option value="device-admin">Administrator</option>
                <option value="globalprotect">GlobalProtect</option>
              </select>
            </Label>
          ) : null}
          <Label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Username</span>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} />
          </Label>
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map(([value, label]) => (
              <button key={value} type="button" className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setUsername(value)}>
                {label}
              </button>
            ))}
          </div>
          <Label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Password, only for break-glass</span>
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
          </Label>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button onClick={send} disabled={busy || !device}>{busy ? "Sending…" : "Send Access-Request"}</Button>
        </Panel>
        <div className="space-y-4">
          <Panel className="p-4">
            <h2 className="mb-2 font-serif text-2xl">Request</h2>
            {result ? <AttrTable rows={result.request.attributes} /> : <p className="text-sm text-muted-foreground">Nothing sent yet.</p>}
          </Panel>
          <Panel className="p-4">
            <h2 className="mb-2 font-serif text-2xl">Reply</h2>
            {result?.pending && result.approval ? (
              <div>
                <p className="text-sm">The device would be waiting. Finish the sign-in, then the listener sends this reply.</p>
                <Link href={`/approvals/${result.approval.id}`} className="mt-3 inline-flex text-sm text-primary">
                  Open the approval
                </Link>
              </div>
            ) : null}
            {result?.response ? (
              <div>
                <p className="mb-2 font-mono text-xs text-muted-foreground">{result.response.code} · {result.response.reason}</p>
                <AttrTable rows={result.response.attributes} />
              </div>
            ) : null}
            {!result ? <p className="text-sm text-muted-foreground">The Access-Accept or Access-Reject shows here.</p> : null}
          </Panel>
        </div>
      </div>
    </main>
  );
}
