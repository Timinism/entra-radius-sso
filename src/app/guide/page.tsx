"use client";

import { useState } from "react";

import { HarborError, harborFetch, usePoll } from "@/components/api";
import { ErrorNote, PageIntro, Panel, fieldClass } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ciscoSnippet, paloAltoSteps } from "@/lib/snippets";
import type { Device } from "@/lib/types";

type Directory = { settings: { radiusHost: string; timeoutSeconds: number } };
type Session = { listener: { authPort: number; acctPort: number; bound: boolean } };

export default function GuidePage() {
  const devices = usePoll<{ devices: Device[] }>("/api/devices", 0);
  const directory = usePoll<Directory>("/api/directory", 0);
  const session = usePoll<Session>("/api/session", 0);
  const [deviceId, setDeviceId] = useState("core-sw01");
  const [hostDraft, setHostDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const device = devices.data?.devices.find((item) => item.id === deviceId) ?? devices.data?.devices[0];
  const authPort = session.data?.listener.authPort ?? 11812;
  const acctPort = session.data?.listener.acctPort ?? 11813;
  const host = hostDraft ?? directory.data?.settings.radiusHost ?? "";

  async function saveHost() {
    setError(null);
    setNotice(null);
    try {
      await harborFetch("/api/settings", { method: "PATCH", body: JSON.stringify({ radiusHost: host }) });
      await directory.reload();
      setHostDraft(null);
      setNotice("Saved the host the snippets use.");
    } catch (caught) {
      setError(caught instanceof HarborError ? caught.message : "Could not save the host.");
    }
  }

  const snippetHost = host || "10.20.0.5";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageIntro kicker="Keep the protocol, change the sign-in" title="Gear setup" />
      <p className="mb-6 max-w-3xl text-sm leading-6 text-muted-foreground">
        Point the device at Harbor with PAP. The password someone types at the CLI is not checked against Entra. Harbor
        holds the RADIUS request, for {directory.data?.settings.timeoutSeconds ?? 45} seconds by default, while that
        person finishes the approval in the browser. Raise the device timeout so the CLI waits that long, and leave a
        local admin on the box before you cut over.
      </p>
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Label className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">Device</span>
          <select className={fieldClass()} value={device?.id ?? ""} onChange={(event) => setDeviceId(event.target.value)}>
            {devices.data?.devices.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </Label>
        <Label className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">Host the gear can route to</span>
          <Input value={host} onChange={(event) => setHostDraft(event.target.value)} placeholder="10.20.0.5" />
        </Label>
        <Button onClick={saveHost}>Save host</Button>
      </div>
      {error ? <div className="mb-4"><ErrorNote>{error}</ErrorNote></div> : null}
      {notice ? <p className="mb-4 text-sm text-good">{notice}</p> : null}
      {session.data && !session.data.listener.bound ? (
        <p className="mb-4 text-sm text-muted-foreground">
          This process is not answering UDP right now. Run Harbor on a host your switches can reach, then use that
          address above. The test bench still exercises the same policy.
        </p>
      ) : null}
      <Tabs defaultValue="cisco">
        <TabsList>
          <TabsTrigger value="cisco">Cisco IOS-XE</TabsTrigger>
          <TabsTrigger value="paloalto">Palo Alto</TabsTrigger>
        </TabsList>
        <TabsContent value="cisco" className="pt-4">
          <Panel className="p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              <code className="font-mono">aaa authorization exec</code> is what applies <code className="font-mono">shell:priv-lvl</code>.
              Privilege 15 is unrestricted exec. Privilege 1 and 7 only do what you have already permitted at those levels.
              CHAP and MS-CHAPv2 will not work. IOS login uses PAP for this RADIUS server.
            </p>
            {device && device.vendor === "cisco" ? (
              <pre className="overflow-x-auto rounded-lg bg-background/70 p-4 font-mono text-[13px] leading-6">{ciscoSnippet(device, snippetHost, authPort, acctPort)}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">Choose a Cisco device to fill in its secret and source address.</p>
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="paloalto" className="pt-4">
          <Panel className="p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              Set the server profile authentication protocol to PAP. A role Harbor returns has to exist on the firewall.
              Built-ins include superuser, superreader, and deviceadmin. Leave the access domain blank unless you have
              created that domain.
            </p>
            {device && device.vendor === "paloalto" ? (
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                {paloAltoSteps(device, snippetHost, authPort).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">Choose a Palo Alto device to see the steps for it.</p>
            )}
            {device?.vendor === "paloalto" ? (
              <p className="mt-4 font-mono text-xs text-muted-foreground">Shared secret for {device.name}: {device.sharedSecret}</p>
            ) : null}
          </Panel>
        </TabsContent>
      </Tabs>
    </main>
  );
}
