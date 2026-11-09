"use client";

import { useState } from "react";

import { HarborError, harborFetch, usePoll } from "@/components/api";
import { ErrorNote, PageIntro, VendorMark, fieldClass } from "@/components/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AdminService, Policy, Vendor } from "@/lib/types";

const BLANK: Omit<Policy, "id"> = {
  name: "",
  entraGroup: "",
  vendor: "cisco",
  service: "device-admin",
  priority: 100,
  enabled: true,
  description: "",
  ciscoPrivLevel: 15,
  ciscoRole: "",
  paAdminRole: "deviceadmin",
  paAccessDomain: "",
  paPanoramaRole: "",
  paPanoramaDomain: "",
  paUserGroup: "",
};

export default function PoliciesPage() {
  const { data, error, reload } = usePoll<{ policies: Policy[] }>("/api/policies", 0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [form, setForm] = useState(BLANK);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const policies = data?.policies ?? [];

  function start(policy?: Policy) {
    setEditing(policy ?? null);
    setForm(policy ? { ...policy, ciscoRole: policy.ciscoRole ?? "", paAdminRole: policy.paAdminRole ?? "deviceadmin", paAccessDomain: policy.paAccessDomain ?? "", paPanoramaRole: policy.paPanoramaRole ?? "", paPanoramaDomain: policy.paPanoramaDomain ?? "", paUserGroup: policy.paUserGroup ?? "" } : BLANK);
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormError(null);
    try {
      await harborFetch(editing ? `/api/policies/${editing.id}` : "/api/policies", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          ...form,
          ciscoPrivLevel: form.vendor === "cisco" ? Number(form.ciscoPrivLevel) : null,
        }),
      });
      setOpen(false);
      await reload();
    } catch (caught) {
      setFormError(caught instanceof HarborError ? caught.message : "Could not save the policy.");
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const next = policies.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    await harborFetch("/api/policies/reorder", {
      method: "POST",
      body: JSON.stringify({ ids: next.map((policy) => policy.id) }),
    });
    await reload();
  }

  async function remove(policy: Policy) {
    if (!window.confirm(`Remove the policy “${policy.name}”?`)) return;
    await harborFetch(`/api/policies/${policy.id}`, { method: "DELETE" });
    await reload();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageIntro kicker="Group to privilege" title="Policies">
        <Button onClick={() => start()}>Add policy</Button>
      </PageIntro>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Harbor walks this list from the top. The first enabled row whose Entra group, vendor, and service match is the
        reply. A person can be a firewall superuser and still have no Cisco privilege.
      </p>
      {error ? <ErrorNote>{error.message}</ErrorNote> : null}
      <ol className="space-y-2">
        {policies.map((policy, index) => (
          <li key={policy.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/80 px-4 py-3">
            <span className="w-8 font-mono text-xs text-muted-foreground">{policy.priority}</span>
            <VendorMark vendor={policy.vendor} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {policy.name}
                {policy.enabled ? "" : " · disabled"}
              </p>
              <p className="text-sm text-muted-foreground">
                {policy.entraGroup} · {grant(policy)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => move(index, -1)} disabled={index === 0}>Up</Button>
              <Button variant="outline" size="sm" onClick={() => move(index, 1)} disabled={index === policies.length - 1}>Down</Button>
              <Button variant="ghost" size="sm" onClick={() => start(policy)}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => remove(policy)}>Remove</Button>
            </div>
          </li>
        ))}
      </ol>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit policy" : "Add policy"}</DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
            <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Entra group name or object ID">
              <Input value={form.entraGroup} onChange={(event) => setForm({ ...form, entraGroup: event.target.value })} placeholder="NetOps-Admins" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vendor">
                <select className={fieldClass()} value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value as Vendor, service: "device-admin" })}>
                  <option value="cisco">Cisco</option>
                  <option value="paloalto">Palo Alto</option>
                </select>
              </Field>
              <Field label="Service">
                <select className={fieldClass()} value={form.service} onChange={(event) => setForm({ ...form, service: event.target.value as AdminService })}>
                  <option value="device-admin">Device admin</option>
                  {form.vendor === "paloalto" ? <option value="globalprotect">GlobalProtect</option> : null}
                </select>
              </Field>
            </div>
            {form.vendor === "cisco" ? (
              <>
                <Field label="Privilege level">
                  <Input type="number" min={0} max={15} value={form.ciscoPrivLevel ?? 1} onChange={(event) => setForm({ ...form, ciscoPrivLevel: Number(event.target.value) })} />
                </Field>
                <Field label="shell:roles (optional)">
                  <Input value={form.ciscoRole ?? ""} onChange={(event) => setForm({ ...form, ciscoRole: event.target.value })} placeholder="network-admin" />
                </Field>
              </>
            ) : null}
            {form.vendor === "paloalto" && form.service === "device-admin" ? (
              <>
                <Field label="Admin role">
                  <Input value={form.paAdminRole ?? ""} onChange={(event) => setForm({ ...form, paAdminRole: event.target.value })} placeholder="superuser" />
                </Field>
                <Field label="Access domain">
                  <Input value={form.paAccessDomain ?? ""} onChange={(event) => setForm({ ...form, paAccessDomain: event.target.value })} placeholder="all" />
                </Field>
                <Field label="Panorama admin role">
                  <Input value={form.paPanoramaRole ?? ""} onChange={(event) => setForm({ ...form, paPanoramaRole: event.target.value })} placeholder="superuser" />
                </Field>
              </>
            ) : null}
            {form.vendor === "paloalto" && form.service === "globalprotect" ? (
              <Field label="PaloAlto-User-Group">
                <Input value={form.paUserGroup ?? ""} onChange={(event) => setForm({ ...form, paUserGroup: event.target.value })} placeholder="gp-remote" />
              </Field>
            ) : null}
            <Field label="Note">
              <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
              Enabled
            </label>
            {formError ? <ErrorNote>{formError}</ErrorNote> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save policy"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function grant(policy: Policy): string {
  if (policy.vendor === "cisco") return `Cisco privilege ${policy.ciscoPrivLevel ?? "unset"}`;
  if (policy.service === "globalprotect") return `GlobalProtect group ${policy.paUserGroup}`;
  return `Palo Alto role ${policy.paAdminRole ?? policy.paPanoramaRole}`;
}
