import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  buildAccessRequest,
  buildResponse,
  decodePacket,
  hidePassword,
  messageAuthenticatorStatus,
  responseAuthenticatorValid,
  revealPassword,
  usernameOf,
} from "./radius";

test("PAP password round-trips with the shared secret", () => {
  const secret = "testing123";
  const authenticator = randomBytes(16);
  const hidden = hidePassword("correct horse", secret, authenticator);
  assert.equal(revealPassword(hidden, secret, authenticator), "correct horse");
  assert.notEqual(revealPassword(hidden, "other-secret", authenticator), "correct horse");
});

test("access request and accept verify on the wire", () => {
  const secret = "sample-northline";
  const authenticator = randomBytes(16);
  const request = buildAccessRequest({
    identifier: 7,
    username: "maya.chen",
    password: "ignored-by-sso",
    secret,
    nasIp: "10.20.0.11",
    nasIdentifier: "core-sw01",
    globalProtect: false,
    authenticator,
  });
  const decoded = decodePacket(request);
  assert.ok(!("error" in decoded));
  if ("error" in decoded) return;
  assert.equal(decoded.code, 1);
  assert.equal(decoded.identifier, 7);
  assert.equal(usernameOf(decoded.attributes), "maya.chen");
  assert.equal(messageAuthenticatorStatus(request, secret), "valid");
  assert.equal(messageAuthenticatorStatus(request, "wrong-secret"), "invalid");

  const response = buildResponse({
    code: 2,
    identifier: decoded.identifier,
    requestAuthenticator: decoded.authenticator,
    secret,
    attributes: decoded.attributes.filter((attr) => attr.type === 1),
    messageAuthenticator: true,
  });
  assert.equal(responseAuthenticatorValid(response, secret, authenticator), true);
  const check = Buffer.from(response);
  authenticator.copy(check, 4);
  assert.equal(messageAuthenticatorStatus(check, secret), "valid");
});
