export type Stage = "production" | "preview";

export type Vendor = "cisco" | "paloalto";

export type DeviceOs = "ios-xe" | "panos" | "panorama";

export type Service = "device-admin" | "globalprotect" | "both";

export type LoginMethod = "ssl" | "sso" | "local";

export type AdminService = "device-admin" | "globalprotect";

export type Device = {
  id: string;
  name: string;
  vendor: Vendor;
  os: DeviceOs;
  model: string;
  nasIp: string;
  location: string;
  service: Service;
  sharedSecret: string;
  logins: LoginMethod[];
  enabled: boolean;
  notes: string;
  lastSeenAt: string | null;
  createdAt: string;
};

export type Policy = {
  id: string;
  name: string;
  entraGroup: string;
  vendor: Vendor;
  service: AdminService;
  priority: number;
  enabled: boolean;
  description: string;
  ciscoPrivLevel: number | null;
  ciscoRole: string | null;
  paAdminRole: string | null;
  paAccessDomain: string | null;
  paPanoramaRole: string | null;
  paPanoramaDomain: string | null;
  paUserGroup: string | null;
};

export type SslCredential = {
  serial: string;
  fingerprint: string;
  certPem: string;
  keyPem: string;
  exportPassword: string;
};

export type DirectoryUser = {
  id: string;
  upn: string;
  displayName: string;
  title: string;
  groups: string[];
  emergency: boolean;
  passwordHash: string | null;
  ssl: SslCredential | null;
};

export type DisplayAttr = {
  name: string;
  value: string;
  id: string;
};

export type AuthResult = {
  code: "accept" | "reject";
  reason: string;
  replyMessage: string;
  policyName: string | null;
  method: "entra" | "sample" | "break-glass" | "local" | "ssl" | "none";
  attributes: DisplayAttr[];
};

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type Approval = {
  id: string;
  username: string;
  deviceId: string;
  deviceName: string;
  vendor: Vendor;
  os: DeviceOs;
  service: AdminService;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  signedInUpn: string | null;
  groups: string[];
  method: "entra" | "sample" | "break-glass" | "local" | "ssl" | null;
  groupSource: "graph" | "token" | "sample" | null;
  denyReason: string | null;
  radiusIdentifier: number | null;
  source: "radius" | "bench";
  sourceIp: string;
  requestAttributes: DisplayAttr[];
  requestAuthenticatorHex: string;
  includeMessageAuthenticator: boolean;
  responsePacketHex: string | null;
  result: AuthResult | null;
};

export type AuthEvent = {
  id: string;
  at: string;
  username: string;
  deviceId: string;
  deviceName: string;
  vendor: Vendor;
  service: AdminService | "accounting";
  result: "accept" | "reject" | "accounted";
  reason: string;
  method: string;
  latencyMs: number;
  attributes: DisplayAttr[];
  source: "radius" | "bench";
};

export type Settings = {
  tenantId: string;
  clientId: string;
  breakglassEnabled: boolean;
  breakglassPassword: string;
  requireMessageAuthenticator: boolean;
  timeoutSeconds: number;
  radiusHost: string;
  cookieKey: string;
  caCertPem: string;
  caKeyPem: string;
  serverCertPem: string;
  serverKeyPem: string;
  shownLocalPasswords: Record<string, string>;
  loginSamplesBootstrapped: boolean;
};

export type Database = {
  version: 1;
  seeded: boolean;
  devices: Device[];
  policies: Policy[];
  users: DirectoryUser[];
  approvals: Approval[];
  events: AuthEvent[];
  settings: Settings;
};
