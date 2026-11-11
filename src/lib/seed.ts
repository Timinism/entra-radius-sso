import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { Database, Device, DirectoryUser, Policy, Settings } from "./types";

function token(length: number): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function sampleSecret(): string {
  return `sample-${token(14)}`;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [kind, saltB64, keyB64] = stored.split("$");
  if (kind !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64url");
  const salt = Buffer.from(saltB64, "base64url");
  if (expected.length === 0 || salt.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function emptyDatabase(): Database {
  return {
    version: 1,
    seeded: false,
    devices: [],
    policies: [],
    users: [],
    approvals: [],
    events: [],
    settings: {
      tenantId: "",
      clientId: "",
      breakglassEnabled: true,
      breakglassPassword: "",
      requireMessageAuthenticator: false,
      timeoutSeconds: 45,
      radiusHost: "",
      cookieKey: "",
    },
  };
}

export function seedDatabase(base: Database = emptyDatabase()): Database {
  const breakglassPassword = `sample-${token(10)}`;
  const settings: Settings = {
    ...base.settings,
    breakglassEnabled: true,
    breakglassPassword,
    requireMessageAuthenticator: false,
    timeoutSeconds: 45,
    radiusHost: base.settings.radiusHost || "",
    cookieKey: base.settings.cookieKey || randomBytes(32).toString("base64url"),
    tenantId: base.settings.tenantId || "",
    clientId: base.settings.clientId || "",
  };
  return {
    version: 1,
    seeded: true,
    devices: devices(),
    policies: policies(),
    users: users(hashPassword(breakglassPassword)),
    approvals: [],
    events: [],
    settings,
  };
}

function devices(): Device[] {
  const now = new Date().toISOString();
  const rows: Array<Omit<Device, "sharedSecret" | "createdAt" | "lastSeenAt" | "enabled" | "notes">> = [
    {
      id: "core-sw01",
      name: "core-sw01",
      vendor: "cisco",
      os: "ios-xe",
      model: "Catalyst 9500-48Y4C",
      nasIp: "10.20.0.11",
      location: "Equinix DA3",
      service: "device-admin",
    },
    {
      id: "dist-sw02",
      name: "dist-sw02",
      vendor: "cisco",
      os: "ios-xe",
      model: "Catalyst 9400",
      nasIp: "10.20.0.12",
      location: "Equinix DA3",
      service: "device-admin",
    },
    {
      id: "idf3-sw01",
      name: "idf3-sw01",
      vendor: "cisco",
      os: "ios-xe",
      model: "Catalyst 9300-48P",
      nasIp: "10.20.4.31",
      location: "HQ Austin, 3rd floor",
      service: "device-admin",
    },
    {
      id: "edge-rtr01",
      name: "edge-rtr01",
      vendor: "cisco",
      os: "ios-xe",
      model: "ISR 4431",
      nasIp: "10.20.1.1",
      location: "Equinix DA3 edge",
      service: "device-admin",
    },
    {
      id: "pa-edge-01",
      name: "pa-edge-01",
      vendor: "paloalto",
      os: "panos",
      model: "PA-5410",
      nasIp: "10.30.0.21",
      location: "Equinix DA3",
      service: "device-admin",
    },
    {
      id: "panorama-01",
      name: "panorama-01",
      vendor: "paloalto",
      os: "panorama",
      model: "M-600",
      nasIp: "10.30.0.5",
      location: "Equinix DA3",
      service: "device-admin",
    },
    {
      id: "pa-branch-aus",
      name: "pa-branch-aus",
      vendor: "paloalto",
      os: "panos",
      model: "PA-460",
      nasIp: "10.30.7.7",
      location: "Austin branch",
      service: "both",
    },
  ];
  return rows.map((row) => ({
    ...row,
    sharedSecret: sampleSecret(),
    enabled: true,
    notes: "",
    lastSeenAt: null,
    createdAt: now,
  }));
}

function policies(): Policy[] {
  return [
    policy("breakglass-cisco", "Break-glass Cisco", "Break-Glass", "cisco", "device-admin", 10, {
      description: "Emergency account. Every use is audited.",
      ciscoPrivLevel: 15,
      ciscoRole: "network-admin",
    }),
    policy("breakglass-pa", "Break-glass Palo Alto", "Break-Glass", "paloalto", "device-admin", 11, {
      description: "Emergency account for firewall and Panorama admin.",
      paAdminRole: "superuser",
      paPanoramaRole: "superuser",
    }),
    policy("fw-super", "Firewall superusers", "Firewall-Superusers", "paloalto", "device-admin", 20, {
      description: "Firewall engineers get superuser. Network admins do not.",
      paAdminRole: "superuser",
      paPanoramaRole: "superuser",
    }),
    policy("netops-cisco", "Network admins on Cisco", "NetOps-Admins", "cisco", "device-admin", 30, {
      description: "Full exec on switches and routers.",
      ciscoPrivLevel: 15,
      ciscoRole: "network-admin",
    }),
    policy("netops-pa", "Network admins on Palo Alto", "NetOps-Admins", "paloalto", "device-admin", 40, {
      description: "Device admin, not superuser. They can operate, not change admin accounts.",
      paAdminRole: "deviceadmin",
      paAccessDomain: "all",
      paPanoramaRole: "deviceadmin",
    }),
    policy("noc-cisco", "NOC operators", "NetOps-Operators", "cisco", "device-admin", 50, {
      description: "Privilege 7. The switch still needs privilege exec commands for that level.",
      ciscoPrivLevel: 7,
    }),
    policy("audit-cisco", "Read-only Cisco", "NetOps-ReadOnly", "cisco", "device-admin", 60, {
      description: "User exec. Show commands that are not privileged.",
      ciscoPrivLevel: 1,
    }),
    policy("audit-pa", "Read-only Palo Alto", "NetOps-ReadOnly", "paloalto", "device-admin", 70, {
      description: "superreader on the firewall and Panorama.",
      paAdminRole: "superreader",
      paPanoramaRole: "superreader",
    }),
    policy("gp-users", "Remote staff", "GP-Users", "paloalto", "globalprotect", 80, {
      description: "GlobalProtect users land in the gp-remote group.",
      paUserGroup: "gp-remote",
    }),
    policy("gp-fw", "Firewall staff VPN", "Firewall-Superusers", "paloalto", "globalprotect", 90, {
      description: "Firewall engineers on GlobalProtect.",
      paUserGroup: "gp-firewall",
    }),
  ];
}

function policy(
  id: string,
  name: string,
  entraGroup: string,
  vendor: Policy["vendor"],
  service: Policy["service"],
  priority: number,
  extra: Partial<Policy>,
): Policy {
  return {
    id,
    name,
    entraGroup,
    vendor,
    service,
    priority,
    enabled: true,
    description: extra.description ?? "",
    ciscoPrivLevel: extra.ciscoPrivLevel ?? null,
    ciscoRole: extra.ciscoRole ?? null,
    paAdminRole: extra.paAdminRole ?? null,
    paAccessDomain: extra.paAccessDomain ?? null,
    paPanoramaRole: extra.paPanoramaRole ?? null,
    paPanoramaDomain: extra.paPanoramaDomain ?? null,
    paUserGroup: extra.paUserGroup ?? null,
  };
}

function users(breakglassHash: string): DirectoryUser[] {
  return [
    person("maya", "maya.chen@northline.example", "Maya Chen", "Network architect", [
      "NetOps-Admins",
      "Employees",
    ]),
    person("luis", "luis.ortiz@northline.example", "Luis Ortiz", "NOC operator", [
      "NetOps-Operators",
      "Employees",
    ]),
    person("priya", "priya.shah@northline.example", "Priya Shah", "Change auditor", [
      "NetOps-ReadOnly",
      "Employees",
    ]),
    person("jordan", "jordan.hale@northline.example", "Jordan Hale", "Firewall engineer", [
      "Firewall-Superusers",
      "Employees",
    ]),
    person("avery", "avery.nguyen@northline.example", "Avery Nguyen", "Remote staff", [
      "GP-Users",
      "Employees",
    ]),
    person("sam", "sam.okonkwo@northline.example", "Sam Okonkwo", "Contractor", ["Contractors"]),
    {
      id: "breakglass",
      upn: "breakglass@northline.example",
      displayName: "Break glass",
      title: "Emergency local account",
      groups: ["Break-Glass"],
      emergency: true,
      passwordHash: breakglassHash,
    },
  ];
}

function person(
  id: string,
  upn: string,
  displayName: string,
  title: string,
  groups: string[],
): DirectoryUser {
  return { id, upn, displayName, title, groups, emergency: false, passwordHash: null };
}
