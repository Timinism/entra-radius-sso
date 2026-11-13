"use client";

import { useState } from "react";

import { HarborError, harborFetch, usePoll } from "@/components/api";
import { ErrorNote, PageIntro, Panel, fieldClass } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Directory = {
  redirectPath: string;
  users: {
    id: string;
    upn: string;
    displayName: string;
    title: string;
    groups: string[];
    emergency: boolean;
    local: boolean;
    localPassword: string | null;
    ssl: boolean;
    sslFingerprint: string | null;
    sslExportPassword: string | null;
  }[];
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
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
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

  async function changeLogin(userId: string, action: string, password?: string) {
    setLoginError(null);
    setBusyUser(userId);
    try {
      await harborFetch("/api/directory/logins", {
        method: "POST",
        body: JSON.stringify({ userId, action, password }),
      });
      setPasswords((current) => ({ ...current, [userId]: "" }));
      await reload();
    } catch (caught) {
      setLoginError(caught instanceof HarborError ? caught.message : "Could not update that login.");
    } finally {
      setBusyUser(null);
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
          <h2 className="mt-6 font-display text-2xl">SSL, SSO, and local</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            SSL is a client certificate on the TLS port. SSO holds the RADIUS request for the browser. Local checks a
            password kept here and never sends it to Entra. Each device chooses which of the three it allows. A matching
            local password answers immediately, so it does not open a browser sign-in.
          </p>
          <a href="/api/directory/ca" className="mt-3 inline-flex text-sm text-primary">
            Download the Harbor CA
          </a>
        </Panel>
      </div>
      <Panel className="mt-4 p-4">
        <h2 className="font-display text-2xl">People</h2>
        {loginError ? <div className="mt-3"><ErrorNote>{loginError}</ErrorNote></div> : null}
        <ul className="mt-2 divide-y divide-border">
          {data?.users.filter((user) => !user.emergency).map((user) => (
            <li key={user.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <p className="font-medium">{user.displayName}</p>
                <p className="font-mono text-xs text-muted-foreground">{user.upn}</p>
                <p className="text-sm text-muted-foreground">{user.title} · {user.groups.join(", ")}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm">
                  Local: {user.localPassword ? <span className="font-mono">{user.localPassword}</span> : user.local ? "password set" : "not set"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    value={passwords[user.id] ?? ""}
                    autoComplete="off"
                    placeholder="New local password"
                    onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                  />
                  <Button
                    variant="outline"
                    disabled={busyUser === user.id}
                    onClick={() => changeLogin(user.id, "set-local", passwords[user.id] ?? "")}
                  >
                    Save
                  </Button>
                  <Button variant="outline" disabled={busyUser === user.id} onClick={() => changeLogin(user.id, "generate-local")}>
                    Generate
                  </Button>
                  {user.local ? (
                    <Button variant="outline" disabled={busyUser === user.id} onClick={() => changeLogin(user.id, "clear-local")}>
                      Remove
                    </Button>
                  ) : null}
                </div>
                <p className="text-sm">
                  SSL: {user.sslFingerprint ? <span className="font-mono text-xs">{user.sslFingerprint.slice(0, 16)}</span> : "no certificate"}
                  {user.sslExportPassword ? <span className="ml-2 font-mono text-xs">{user.sslExportPassword}</span> : null}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={busyUser === user.id} onClick={() => changeLogin(user.id, "issue-ssl")}>
                    {user.ssl ? "Reissue certificate" : "Issue certificate"}
                  </Button>
                  {user.ssl ? (
                    <a href={`/api/directory/certificate/${user.id}`} className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm">
                      Download .p12
                    </a>
                  ) : null}
                  {user.ssl ? (
                    <Button variant="outline" disabled={busyUser === user.id} onClick={() => changeLogin(user.id, "revoke-ssl")}>
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
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
