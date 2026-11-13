import { entraConfig } from "./entra";
import type { Approval, AuthEvent, Device, DirectoryUser, Policy, Settings } from "./types";

export function presentApproval(approval: Approval) {
  return {
    id: approval.id,
    username: approval.username,
    deviceId: approval.deviceId,
    deviceName: approval.deviceName,
    vendor: approval.vendor,
    os: approval.os,
    service: approval.service,
    status: approval.status,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    resolvedAt: approval.resolvedAt,
    signedInUpn: approval.signedInUpn,
    groups: approval.groups,
    method: approval.method,
    groupSource: approval.groupSource,
    denyReason: approval.denyReason,
    source: approval.source,
    requestAttributes: approval.requestAttributes,
    result: approval.result,
  };
}

export function presentUser(user: DirectoryUser, shownLocalPassword: string | null = null) {
  return {
    id: user.id,
    upn: user.upn,
    displayName: user.displayName,
    title: user.title,
    groups: user.groups,
    emergency: user.emergency,
    local: Boolean(user.passwordHash) && !user.emergency,
    localPassword: shownLocalPassword,
    ssl: Boolean(user.ssl),
    sslFingerprint: user.ssl?.fingerprint ?? null,
    sslExportPassword: user.ssl?.exportPassword ?? null,
  };
}

export function presentSettings(settings: Settings) {
  const config = entraConfig(settings);
  return {
    mode: config.ready ? ("entra" as const) : ("sample" as const),
    tenantId: config.tenantId,
    clientId: config.clientId,
    tenantFromEnv: config.tenantFromEnv,
    clientFromEnv: config.clientFromEnv,
    secretSet: config.secretSet,
    breakglassEnabled: settings.breakglassEnabled,
    breakglassPassword: settings.breakglassPassword,
    requireMessageAuthenticator: settings.requireMessageAuthenticator,
    timeoutSeconds: settings.timeoutSeconds,
    radiusHost: settings.radiusHost,
    sslReady: Boolean(settings.caCertPem && settings.serverCertPem),
  };
}

export function presentDevice(device: Device): Device {
  return device;
}

export function presentEvent(event: AuthEvent): AuthEvent {
  return event;
}

export function presentPolicy(policy: Policy): Policy {
  return policy;
}
