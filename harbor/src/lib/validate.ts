import type { AdminService, Device, DeviceOs, Policy, Service, Vendor } from "./types";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/;
const SECRET = /^[A-Za-z0-9_.:@%+=/-]{8,64}$/;
const TEXT = /^[^\x00-\x1f\x7f]{0,120}$/;
const GROUP = /^[^\x00-\x1f\x7f]{1,120}$/;

export function ipv4(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return false;
  return match.slice(1).every((part) => {
    const number = Number(part);
    return number <= 255 && String(number) === part;
  });
}

export function hostName(value: string): boolean {
  if (!value) return true;
  if (ipv4(value)) return true;
  return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(
    value,
  );
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > max || /[\x00-\x1f\x7f]/.test(trimmed)) return null;
  return trimmed;
}

function requiredText(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : null;
}

export function sampleSecret(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let out = "sample-";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

export function parseDevice(body: unknown, existing?: Device): { device: Device } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Send a device." };
  const input = body as Record<string, unknown>;
  const name = requiredText(input.name, NAME);
  if (!name) return { error: "Use a device name of letters, numbers, dots, or dashes." };
  const vendor: Vendor | null = input.vendor === "cisco" || input.vendor === "paloalto" ? input.vendor : null;
  if (!vendor) return { error: "Vendor must be Cisco or Palo Alto." };
  const os: DeviceOs | null =
    input.os === "ios-xe" || input.os === "panos" || input.os === "panorama" ? input.os : null;
  if (!os) return { error: "Choose IOS-XE, PAN-OS, or Panorama." };
  if (vendor === "cisco" && os !== "ios-xe") return { error: "Cisco gear uses IOS-XE in Harbor." };
  if (vendor === "paloalto" && os === "ios-xe") return { error: "Palo Alto gear uses PAN-OS or Panorama." };
  const service: Service | null =
    input.service === "device-admin" || input.service === "globalprotect" || input.service === "both"
      ? input.service
      : null;
  if (!service) return { error: "Choose what this device asks Harbor to authenticate." };
  if (vendor === "cisco" && service !== "device-admin") {
    return { error: "Cisco devices in Harbor authenticate administrators." };
  }
  const nasIp = typeof input.nasIp === "string" ? input.nasIp.trim() : "";
  if (!ipv4(nasIp)) return { error: "Enter the IPv4 address the device uses as its RADIUS source." };
  const model = text(input.model, 80);
  const location = text(input.location, 80);
  const notes = text(input.notes, 280);
  if (model === null || location === null || notes === null) {
    return { error: "Model, location, and notes must be single-line text." };
  }
  let sharedSecret = existing?.sharedSecret ?? "";
  if (!existing || input.rotateSecret === true) {
    sharedSecret = sampleSecret();
  } else if (typeof input.sharedSecret === "string" && input.sharedSecret.trim()) {
    const next = input.sharedSecret.trim();
    if (!SECRET.test(next)) {
      return { error: "Shared secrets are 8 to 64 characters, without spaces." };
    }
    sharedSecret = next;
  }
  if (!SECRET.test(sharedSecret)) return { error: "Shared secret is not valid." };
  const now = new Date().toISOString();
  const device: Device = {
    id: existing?.id ?? name.toLowerCase(),
    name,
    vendor,
    os,
    model,
    nasIp,
    location,
    service,
    sharedSecret,
    enabled: input.enabled === undefined ? (existing?.enabled ?? true) : input.enabled === true,
    notes,
    lastSeenAt: existing?.lastSeenAt ?? null,
    createdAt: existing?.createdAt ?? now,
  };
  return { device };
}

const ROLES = new Set([
  "superuser",
  "superreader",
  "deviceadmin",
  "devicereader",
  "vsysadmin",
  "vsysreader",
]);

export function parsePolicy(body: unknown, existing?: Policy): { policy: Policy } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Send a policy." };
  const input = body as Record<string, unknown>;
  const name = text(input.name, 80);
  if (!name) return { error: "Name the policy." };
  const entraGroup = requiredText(input.entraGroup, GROUP);
  if (!entraGroup) return { error: "Enter the Entra group name or object ID." };
  const vendor: Vendor | null = input.vendor === "cisco" || input.vendor === "paloalto" ? input.vendor : null;
  if (!vendor) return { error: "Choose Cisco or Palo Alto." };
  const service: AdminService | null =
    input.service === "device-admin" || input.service === "globalprotect" ? input.service : null;
  if (!service) return { error: "Choose device admin or GlobalProtect." };
  if (vendor === "cisco" && service !== "device-admin") {
    return { error: "Cisco policies grant an exec privilege, not GlobalProtect." };
  }
  const description = text(input.description, 240) ?? "";
  const priority = Number(input.priority);
  const policy: Policy = {
    id: existing?.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
    name,
    entraGroup,
    vendor,
    service,
    priority: Number.isFinite(priority) ? Math.max(1, Math.min(999, Math.trunc(priority))) : (existing?.priority ?? 100),
    enabled: input.enabled === undefined ? (existing?.enabled ?? true) : input.enabled === true,
    description,
    ciscoPrivLevel: null,
    ciscoRole: null,
    paAdminRole: null,
    paAccessDomain: null,
    paPanoramaRole: null,
    paPanoramaDomain: null,
    paUserGroup: null,
  };
  if (!policy.id) return { error: "Name the policy." };
  if (vendor === "cisco") {
    const privilege = Number(input.ciscoPrivLevel);
    if (!Number.isInteger(privilege) || privilege < 0 || privilege > 15) {
      return { error: "Cisco privilege is a whole number from 0 to 15." };
    }
    policy.ciscoPrivLevel = privilege;
    const role = text(input.ciscoRole, 40);
    if (input.ciscoRole && role === null) return { error: "Cisco role must be a single line." };
    policy.ciscoRole = role || null;
  } else if (service === "globalprotect") {
    const group = requiredText(input.paUserGroup, GROUP);
    if (!group) return { error: "Enter the GlobalProtect user group to return." };
    policy.paUserGroup = group;
  } else {
    const role = requiredText(input.paAdminRole, TEXT);
    if (!role) return { error: "Enter the Palo Alto admin role." };
    policy.paAdminRole = ROLES.has(role) ? role : role;
    const domain = text(input.paAccessDomain, 64);
    if (input.paAccessDomain && domain === null) return { error: "Access domain must be a single line." };
    policy.paAccessDomain = domain || null;
    const panorama = text(input.paPanoramaRole, 64);
    if (input.paPanoramaRole && panorama === null) return { error: "Panorama role must be a single line." };
    policy.paPanoramaRole = panorama || null;
    const panoramaDomain = text(input.paPanoramaDomain, 64);
    policy.paPanoramaDomain = panoramaDomain || null;
  }
  return { policy };
}

export function parseSettings(body: unknown): {
  tenantId?: string;
  clientId?: string;
  breakglassEnabled?: boolean;
  requireMessageAuthenticator?: boolean;
  timeoutSeconds?: number;
  radiusHost?: string;
  rotateBreakglass?: boolean;
} | { error: string } {
  if (!body || typeof body !== "object") return { error: "Send settings." };
  const input = body as Record<string, unknown>;
  const next: {
    tenantId?: string;
    clientId?: string;
    breakglassEnabled?: boolean;
    requireMessageAuthenticator?: boolean;
    timeoutSeconds?: number;
    radiusHost?: string;
    rotateBreakglass?: boolean;
  } = {};
  if (input.tenantId !== undefined) {
    const tenantId = text(input.tenantId, 253) ?? "";
    if (input.tenantId !== "" && tenantId === null) return { error: "Tenant ID is not valid." };
    next.tenantId = typeof input.tenantId === "string" ? input.tenantId.trim() : "";
  }
  if (input.clientId !== undefined) {
    next.clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
    if (next.clientId.length > 80) return { error: "Application ID is too long." };
  }
  if (input.breakglassEnabled !== undefined) next.breakglassEnabled = input.breakglassEnabled === true;
  if (input.requireMessageAuthenticator !== undefined) {
    next.requireMessageAuthenticator = input.requireMessageAuthenticator === true;
  }
  if (input.timeoutSeconds !== undefined) {
    const timeout = Number(input.timeoutSeconds);
    if (!Number.isFinite(timeout)) return { error: "Timeout must be a number of seconds." };
    next.timeoutSeconds = Math.max(15, Math.min(90, Math.trunc(timeout)));
  }
  if (input.radiusHost !== undefined) {
    const host = typeof input.radiusHost === "string" ? input.radiusHost.trim() : "";
    if (!hostName(host)) return { error: "RADIUS host must be a hostname or IPv4 address." };
    next.radiusHost = host;
  }
  if (input.rotateBreakglass === true) next.rotateBreakglass = true;
  return next;
}
