import assert from "node:assert/strict";
import test from "node:test";

import { decideAccess, matchPolicy } from "./policy";
import type { Device, Policy } from "./types";

const device: Device = {
  id: "core-sw01",
  name: "core-sw01",
  vendor: "cisco",
  os: "ios-xe",
  model: "Catalyst 9500",
  nasIp: "10.20.0.11",
  location: "DA3",
  service: "device-admin",
  sharedSecret: "sample-testsecret",
  logins: ["ssl", "sso", "local"],
  enabled: true,
  notes: "",
  lastSeenAt: null,
  createdAt: "2026-11-09T00:00:00.000Z",
};

const firewall: Device = {
  ...device,
  id: "pa-edge-01",
  name: "pa-edge-01",
  vendor: "paloalto",
  os: "panos",
  nasIp: "10.30.0.21",
};

const policies: Policy[] = [
  {
    id: "admins",
    name: "Network admins on Cisco",
    entraGroup: "NetOps-Admins",
    vendor: "cisco",
    service: "device-admin",
    priority: 30,
    enabled: true,
    description: "",
    ciscoPrivLevel: 15,
    ciscoRole: "network-admin",
    paAdminRole: null,
    paAccessDomain: null,
    paPanoramaRole: null,
    paPanoramaDomain: null,
    paUserGroup: null,
  },
  {
    id: "fw",
    name: "Firewall superusers",
    entraGroup: "Firewall-Superusers",
    vendor: "paloalto",
    service: "device-admin",
    priority: 20,
    enabled: true,
    description: "",
    ciscoPrivLevel: null,
    ciscoRole: null,
    paAdminRole: "superuser",
    paAccessDomain: null,
    paPanoramaRole: "superuser",
    paPanoramaDomain: null,
    paUserGroup: null,
  },
];

test("the first matching group for that vendor wins", () => {
  const match = matchPolicy(policies, ["Employees", "netops-admins"], "cisco", "device-admin");
  assert.equal(match?.id, "admins");
  assert.equal(matchPolicy(policies, ["Firewall-Superusers"], "cisco", "device-admin"), null);
  assert.equal(matchPolicy(policies, ["Firewall-Superusers"], "paloalto", "device-admin")?.paAdminRole, "superuser");
});

test("an accept for Cisco carries privilege 15", () => {
  const decision = decideAccess({
    device,
    service: "device-admin",
    groups: ["NetOps-Admins"],
    policies,
    eventId: "evt-1",
    method: "sample",
  });
  assert.equal(decision.result.code, "accept");
  assert.ok(decision.result.attributes.some((attr) => attr.value === "shell:priv-lvl=15"));
  assert.ok(decision.result.attributes.some((attr) => attr.value === "Administrative-User"));
});

test("a firewall engineer is refused on the switch", () => {
  const decision = decideAccess({
    device,
    service: "device-admin",
    groups: ["Firewall-Superusers"],
    policies,
    eventId: "evt-2",
    method: "entra",
  });
  assert.equal(decision.result.code, "reject");
  const allowed = decideAccess({
    device: firewall,
    service: "device-admin",
    groups: ["Firewall-Superusers"],
    policies,
    eventId: "evt-3",
    method: "entra",
  });
  assert.equal(allowed.result.code, "accept");
  assert.ok(allowed.result.attributes.some((attr) => attr.name === "PaloAlto-Admin-Role" && attr.value === "superuser"));
});
