"use client";

import { useState } from "react";

import { HarborError, harborFetch, usePoll } from "@/components/api";
import { ErrorNote, PageIntro, Panel, fieldClass } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Directory = {
  redirectPath: string;
  users: { id: string; upn: string; displayName: string; title: string; groups: string[]; emergency: boolean }[];
  settings: {
    mode: "entra" | "sample";
    tenantId: string;
    clientId: string;
    tenantFromEnv: boolean;
    clientFromEnv: boolean;
    secretSet: boolean;
    breakglassEnabled: boolean;
    breakglassPassword: string;
    requireMessageAuthenticator: boolean;
    timeoutSeconds: number;
    radiusHost: string;
  };
};

export default function DirectoryPage() {
  const { data, error, reload } = usePoll<Directory>("/api/directory", 0);
  const [draft, setDraft] = useState<Partial<Directory["settings"]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const settings = data ? { ...data.settings, ...draft } : null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function save(extra?: Record<string, unknown>) {
    if (!settings) return;
    setFormError(null);
    setNotice(null);
    try {
      await harborFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          tenantId: settings.tenantFromEnv ? undefined : settings.tenantId,
          clientId: settings.clientFromEnv ? undefined : settings.clientId,
          breakglassEnabled: settings.breakglassEnabled,
          requireMessageAuthenticator: settings.requireMessageAuthenticator,
          timeoutSeconds: Number(settings.timeoutSeconds),
          radiusHost: settings.radiusHost,
          ...extra,
        }),
      });
      setDraft({});
      setNotice("Saved.");
      await reload();
    } catch (caught) {
      setFormError(caught instanceof HarborError ? caught.message : "Could not save.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageIntro kicker={data?.settings.mode === "entra" ? "Microsoft Entra" : "Sample Northline directory"} title="Directory" />
      {error ? <ErrorNote>{error.message}</ErrorNote> : null}
      {data?.settings.mode === "sample" ? (
        <p className="mb-6 max-w-3xl rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
          These people are sample data, not your tenant. Harbor uses them so you can prove a RADIUS reply before the
          Entra app registration exists. Add the tenant ID, application ID, and client secret in the secure form, then
          register the redirect URI below.
        </p>
      ) : (
        <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
          Sign-ins go to Microsoft. Policies match the group display name from Graph, or the group object ID if that
          is all the token contains.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="space-y-3 p-4">
          <h2 className="font-display text-2xl">Entra app</h2>
          <Field label="Tenant ID">
            <Input
              value={settings?.tenantId ?? ""}
              disabled={!settings || settings.tenantFromEnv}
              onChange={(event) => setDraft({ ...draft, tenantId: event.target.value })}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </Field>
          <Field label="Application (client) ID">
            <Input
              value={settings?.clientId ?? ""}
              disabled={!settings || settings.clientFromEnv}
              onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}
            />
          </Field>
          <p className="text-sm text-muted-foreground">
            Client secret: {settings?.secretSet ? "set in the environment" : "not set"}. Harbor never stores it.
            {settings?.tenantFromEnv ? " Tenant ID is coming from the environment." : ""}
            {settings?.clientFromEnv ? " Application ID is coming from the environment." : ""}
          </p>
          <Field label="Redirect URI">
            <Input readOnly value={origin ? `${origin}${data?.redirectPath ?? ""}` : data?.redirectPath ?? ""} />
          </Field>
          <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
            <li>App registrations, new app, accounts in this tenant only.</li>
            <li>Web redirect URI copied from above.</li>
            <li>A client secret. Put it in ENTRA_CLIENT_SECRET, not in this page.</li>
            <li>Delegated Microsoft Graph permissions: User.Read and GroupMember.Read.All, with admin consent.</li>
          </ol>
          <Field label="Sign-in wait, seconds">
            <Input
              className={fieldClass()}
              type="number"
              min={15}
              max={90}
              value={settings?.timeoutSeconds ?? 45}
              onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.requireMessageAuthenticator ?? false}
              onChange={(event) => setDraft({ ...draft, requireMessageAuthenticator: event.target.checked })}
            />
            Require Message-Authenticator on access requests
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.breakglassEnabled ?? false}
              onChange={(event) => setDraft({ ...draft, breakglassEnabled: event.target.checked })}
            />
            Allow the emergency break-glass password
          </label>
          {formError ? <ErrorNote>{formError}</ErrorNote> : null}
          {notice ? <p className="text-sm text-good">{notice}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save()}>Save directory settings</Button>
            <Button variant="outline" onClick={() => save({ rotateBreakglass: true })}>New break-glass password</Button>
          </div>
        </Panel>
        <Panel className="p-4">
          <h2 className="font-display text-2xl">Break glass</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Username <span className="font-mono">breakglass</span>. The password is checked inside Harbor and is never
            sent to Entra. Every use is an audit event. This sample password is not a tenant credential.
          </p>
          <p className="mt-3 font-mono text-sm">{settings?.breakglassPassword || "Generating…"}</p>
          <h2 className="mt-6 font-display text-2xl">Sample people</h2>
          <ul className="mt-3 divide-y divide-border">
            {data?.users.filter((user) => !user.emergency).map((user) => (
              <li key={user.id} className="py-3">
                <p className="font-medium">{user.displayName}</p>
                <p className="font-mono text-xs text-muted-foreground">{user.upn}</p>
                <p className="text-sm text-muted-foreground">{user.title} · {user.groups.join(", ")}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="grid gap-1.5 font-normal">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </Label>
  );
}
