"use client";

import { useState } from "react";

import { HarborError, harborFetch, usePoll } from "@/components/api";
import { ErrorNote, PageIntro, VendorMark, fieldClass } from "@/components/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCtDate } from "@/lib/time";
import type { Device, DeviceOs, LoginMethod, Service, Vendor } from "@/lib/types";

const EMPTY = {
  name: "",
  vendor: "cisco" as Vendor,
  os: "ios-xe" as DeviceOs,
  model: "",
  nasIp: "",
  location: "",
  service: "device-admin" as Service,
  notes: "",
  enabled: true,
  logins: ["ssl", "sso", "local"] as LoginMethod[],
};

export default function DevicesPage() {
  const { data, error, reload } = usePoll<{ devices: Device[] }>("/api/devices", 5000);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  function startCreate() {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setOpen(true);
  }

  function startEdit(device: Device) {
    setEditing(device);
    setForm({
      name: device.name,
      vendor: device.vendor,
      os: device.os,
      model: device.model,
      nasIp: device.nasIp,
      location: device.location,
      service: device.service,
      notes: device.notes,
      enabled: device.enabled,
      logins: device.logins?.length ? device.logins : ["ssl", "sso", "local"],
    });
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormError(null);
    try {
      const path = editing ? `/api/devices/${editing.id}` : "/api/devices";
      await harborFetch(path, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });
      setOpen(false);
      await reload();
    } catch (caught) {
      setFormError(caught instanceof HarborError ? caught.message : "Could not save the device.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(device: Device) {
    if (!window.confirm(`Remove ${device.name} from Harbor?`)) return;
    await harborFetch(`/api/devices/${device.id}`, { method: "DELETE" });
    await reload();
  }

  async function rotate(device: Device) {
    await harborFetch(`/api/devices/${device.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...device, rotateSecret: true }),
    });
    setRevealed((current) => ({ ...current, [device.id]: true }));
    await reload();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageIntro kicker="RADIUS clients" title="Devices">
        <Button onClick={startCreate}>Add device</Button>
      </PageIntro>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Register the address the gear uses as its RADIUS source. Harbor answers only those addresses. Secrets below are
        for the lab until you replace them.
      </p>
      {error ? <ErrorNote>{error.message}</ErrorNote> : null}
      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Device</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Asks for</th>
              <th className="px-4 py-3 font-medium">Logins</th>
              <th className="px-4 py-3 font-medium">Secret</th>
              <th className="px-4 py-3 font-medium">Last packet</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {data?.devices.map((device) => (
              <tr key={device.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <VendorMark vendor={device.vendor} />
                    <div>
                      <p className="font-medium">{device.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {device.model} · {device.location}
                        {device.enabled ? "" : " · disabled"}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-[13px]">{device.nasIp}</td>
                <td className="px-4 py-3">{labelService(device.service)}</td>
                <td className="px-4 py-3 text-muted-foreground">{loginLabels(device.logins)}</td>
                <td className="px-4 py-3 font-mono text-[13px]">
                  <button type="button" className="hover:text-primary" onClick={() => setRevealed((current) => ({ ...current, [device.id]: !current[device.id] }))}>
                    {revealed[device.id] ? device.sharedSecret : "Show secret"}
                  </button>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{device.lastSeenAt ? formatCtDate(device.lastSeenAt) : "None yet"}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="mr-3 text-muted-foreground hover:text-foreground" onClick={() => startEdit(device)}>
                    Edit
                  </button>
                  <button type="button" className="mr-3 text-muted-foreground hover:text-foreground" onClick={() => rotate(device)}>
                    New secret
                  </button>
                  <button type="button" className="text-destructive hover:underline" onClick={() => remove(device)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add a RADIUS client"}</DialogTitle>
            <DialogDescription>Harbor matches the packet’s source address to this list.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Name">
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="core-sw01" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vendor">
                <select
                  className={fieldClass()}
                  value={form.vendor}
                  onChange={(event) => {
                    const vendor = event.target.value as Vendor;
                    setForm({
                      ...form,
                      vendor,
                      os: vendor === "cisco" ? "ios-xe" : "panos",
                      service: "device-admin",
                    });
                  }}
                >
                  <option value="cisco">Cisco</option>
                  <option value="paloalto">Palo Alto</option>
                </select>
              </Field>
              <Field label="OS">
                <select className={fieldClass()} value={form.os} onChange={(event) => setForm({ ...form, os: event.target.value as DeviceOs })}>
                  {form.vendor === "cisco" ? <option value="ios-xe">IOS-XE</option> : null}
                  {form.vendor === "paloalto" ? <option value="panos">PAN-OS</option> : null}
                  {form.vendor === "paloalto" ? <option value="panorama">Panorama</option> : null}
                </select>
              </Field>
            </div>
            <Field label="Model">
              <Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="Catalyst 9300" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="RADIUS source IPv4">
                <Input value={form.nasIp} onChange={(event) => setForm({ ...form, nasIp: event.target.value })} placeholder="10.20.0.11" />
              </Field>
              <Field label="Location">
                <Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Equinix DA3" />
              </Field>
            </div>
            <Field label="What it authenticates">
              <select
                className={fieldClass()}
                value={form.service}
                onChange={(event) => setForm({ ...form, service: event.target.value as Service })}
              >
                <option value="device-admin">Administrators</option>
                {form.vendor === "paloalto" ? <option value="globalprotect">GlobalProtect</option> : null}
                {form.vendor === "paloalto" ? <option value="both">Administrators and GlobalProtect</option> : null}
              </select>
            </Field>
            <fieldset className="grid gap-2">
              <legend className="text-xs text-muted-foreground">Logins this device accepts</legend>
              {(["ssl", "sso", "local"] as LoginMethod[]).map((method) => (
                <label key={method} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.logins.includes(method)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...form.logins, method]
                        : form.logins.filter((item) => item !== method);
                      setForm({ ...form, logins: next });
                    }}
                  />
                  {method === "ssl" ? "SSL certificate" : method === "sso" ? "SSO in the browser" : "Local password"}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
              Answer this device
            </label>
            {formError ? <ErrorNote>{formError}</ErrorNote> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save device"}</Button>
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

function loginLabels(logins: LoginMethod[] | undefined): string {
  const held = logins?.length ? logins : ["ssl", "sso", "local"];
  return (["ssl", "sso", "local"] as LoginMethod[]).filter((method) => held.includes(method)).map((method) => (
    method === "ssl" ? "SSL" : method === "sso" ? "SSO" : "Local"
  )).join(" · ");
}

function labelService(service: Service): string {
  if (service === "globalprotect") return "GlobalProtect";
  if (service === "both") return "Admin and GlobalProtect";
  return "Administrators";
}
