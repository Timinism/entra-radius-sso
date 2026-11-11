import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { before } from "node:test";

import { approveSample, handlePacket, newAuthenticator } from "./engine";
import { buildAccessRequest } from "./radius";
import { readState } from "./store";

before(() => {
  process.env.HARBOR_DATA_DIR = mkdtempSync(path.join(tmpdir(), "harbor-"));
  delete process.env.DATABASE_URL;
});

test("a sample network admin receives Cisco privilege 15", async () => {
  const db = await readState("production");
  const device = db.devices.find((item) => item.id === "core-sw01");
  const user = db.users.find((item) => item.upn.startsWith("maya.chen"));
  assert.ok(device);
  assert.ok(user);
  if (!device || !user) return;
  const authenticator = newAuthenticator();
  const packet = buildAccessRequest({
    identifier: 4,
    username: "maya.chen",
    password: "not-sent-to-entra",
    secret: device.sharedSecret,
    nasIp: device.nasIp,
    nasIdentifier: device.name,
    globalProtect: false,
    authenticator,
  });
  const pending = await handlePacket("production", packet, device.nasIp, "bench");
  assert.equal(pending.kind, "pending");
  if (pending.kind !== "pending") return;
  const approved = await approveSample("production", pending.approval.id, user.id);
  assert.ok("result" in approved && approved.result);
  if (!("result" in approved) || !approved.result) return;
  assert.equal(approved.result.code, "accept");
  assert.ok(approved.result.attributes.some((attr) => attr.value === "shell:priv-lvl=15"));
});

test("a firewall engineer is rejected by a Cisco switch", async () => {
  const db = await readState("production");
  const device = db.devices.find((item) => item.id === "core-sw01");
  const user = db.users.find((item) => item.upn.startsWith("jordan.hale"));
  assert.ok(device && user);
  if (!device || !user) return;
  const authenticator = newAuthenticator();
  const packet = buildAccessRequest({
    identifier: 5,
    username: "jordan.hale",
    password: "ignored",
    secret: device.sharedSecret,
    nasIp: device.nasIp,
    nasIdentifier: device.name,
    globalProtect: false,
    authenticator,
  });
  const pending = await handlePacket("production", packet, device.nasIp, "bench");
  assert.equal(pending.kind, "pending");
  if (pending.kind !== "pending") return;
  const approved = await approveSample("production", pending.approval.id, user.id);
  assert.ok("result" in approved && approved.result?.code === "reject");
});
