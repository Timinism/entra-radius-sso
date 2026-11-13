import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { before } from "node:test";
import { createServer } from "node:tls";

import { handlePacket, newAuthenticator } from "./engine";
import { exchangeTls, takeRadiusPackets, tlsIdentity } from "./radsec";
import { buildAccessRequest, decodePacket } from "./radius";
import { readState, withState } from "./store";

before(() => {
  process.env.HARBOR_DATA_DIR = mkdtempSync(path.join(tmpdir(), "harbor-logins-"));
  delete process.env.DATABASE_URL;
});

test("RADIUS frames split on the packet length", () => {
  const first = Buffer.alloc(20);
  first[0] = 1;
  first.writeUInt16BE(20, 2);
  const second = Buffer.alloc(20);
  second[0] = 2;
  second.writeUInt16BE(20, 2);
  const partial = takeRadiusPackets(Buffer.concat([first, second.subarray(0, 6)]));
  assert.equal(partial.error, null);
  assert.equal(partial.packets.length, 1);
  assert.equal(partial.rest.length, 6);
  const rest = takeRadiusPackets(Buffer.concat([partial.rest, second.subarray(6)]));
  assert.equal(rest.packets.length, 1);
  assert.equal(rest.packets[0]?.[0], 2);
  const broken = Buffer.alloc(4);
  broken.writeUInt16BE(4, 2);
  assert.equal(takeRadiusPackets(broken).error, "RADIUS length is not valid.");
});

test("Maya's local password is accepted immediately", async () => {
  const db = await readState("production");
  const device = db.devices.find((item) => item.id === "core-sw01");
  const password = db.settings.shownLocalPasswords.maya;
  assert.ok(device);
  assert.ok(password);
  if (!device || !password) return;
  const authenticator = newAuthenticator();
  const packet = buildAccessRequest({
    identifier: 21,
    username: "maya.chen",
    password,
    secret: device.sharedSecret,
    nasIp: device.nasIp,
    nasIdentifier: device.name,
    globalProtect: false,
    authenticator,
  });
  const result = await handlePacket("production", packet, device.nasIp, "bench");
  assert.equal(result.kind, "reply");
  if (result.kind !== "reply") return;
  assert.equal(result.result.code, "accept");
  assert.equal(result.result.method, "local");
  assert.ok(result.result.attributes.some((attr) => attr.value === "shell:priv-lvl=15"));
});

test("a device that allows only local rejects an SSO password", async () => {
  await withState("production", (db) => {
    const device = db.devices.find((item) => item.id === "dist-sw02");
    if (device) device.logins = ["local"];
  });
  const db = await readState("production");
  const device = db.devices.find((item) => item.id === "dist-sw02");
  assert.ok(device);
  if (!device) return;
  const authenticator = newAuthenticator();
  const packet = buildAccessRequest({
    identifier: 22,
    username: "maya.chen",
    password: "not-a-local-password",
    secret: device.sharedSecret,
    nasIp: device.nasIp,
    nasIdentifier: device.name,
    globalProtect: false,
    authenticator,
  });
  const result = await handlePacket("production", packet, device.nasIp, "bench");
  assert.equal(result.kind, "reply");
  if (result.kind !== "reply") return;
  assert.equal(result.result.code, "reject");
  await withState("production", (state) => {
    const restored = state.devices.find((item) => item.id === "dist-sw02");
    if (restored) restored.logins = ["ssl", "sso", "local"];
  });
});

test("an SSL certificate over TLS accepts Maya", async () => {
  const db = await readState("production");
  const device = db.devices.find((item) => item.id === "core-sw01");
  const maya = db.users.find((item) => item.id === "maya");
  assert.ok(device && maya?.ssl && db.settings.caCertPem);
  if (!device || !maya?.ssl) return;
  const server = createServer(
    {
      cert: db.settings.serverCertPem,
      key: db.settings.serverKeyPem,
      ca: db.settings.caCertPem,
      requestCert: true,
      rejectUnauthorized: false,
    },
    (socket) => {
      let buffer: Buffer = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const taken = takeRadiusPackets(buffer);
        if (taken.error || !taken.packets[0]) {
          buffer = taken.rest;
          return;
        }
        buffer = taken.rest;
        const packet = taken.packets[0];
        const identity = tlsIdentity(socket.getPeerCertificate(), socket.authorized);
        void handlePacket("production", packet, "127.0.0.1", "bench", { tlsUserUpn: identity.userUpn }).then((result) => {
          if (result.kind === "reply") socket.write(result.packet);
        });
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  if (!address || typeof address !== "object") return;
  const authenticator = newAuthenticator();
  const packet = buildAccessRequest({
    identifier: 23,
    username: "maya.chen",
    password: "certificate",
    secret: device.sharedSecret,
    nasIp: device.nasIp,
    nasIdentifier: device.name,
    globalProtect: false,
    authenticator,
  });
  try {
    const response = await exchangeTls({
      host: "127.0.0.1",
      port: address.port,
      caPem: db.settings.caCertPem,
      certPem: maya.ssl.certPem,
      keyPem: maya.ssl.keyPem,
      packet,
    });
    const decoded = decodePacket(response);
    assert.equal("error" in decoded, false);
    if ("error" in decoded) return;
    assert.equal(decoded.code, 2);
  } finally {
    server.close();
  }
});
