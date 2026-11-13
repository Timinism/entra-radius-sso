import { createHash, randomBytes } from "node:crypto";

import forge from "node-forge";

import { hashPassword } from "./seed";
import type { Database, SslCredential } from "./types";
import { sampleSecret } from "./validate";

const DAY = 24 * 60 * 60 * 1000;

function rsaPair(): forge.pki.rsa.KeyPair {
  return forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
}

function serial(): string {
  return randomBytes(8).toString("hex");
}

function fingerprint(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return createHash("sha256").update(Buffer.from(der, "binary")).digest("hex");
}

function dated(cert: forge.pki.Certificate, days: number): void {
  const start = new Date(Date.now() - 5 * 60 * 1000);
  cert.validity.notBefore = start;
  cert.validity.notAfter = new Date(start.getTime() + days * DAY);
}

export function createAuthority(): { certPem: string; keyPem: string } {
  const keys = rsaPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  dated(cert, 3650);
  const subject = [
    { name: "commonName", value: "Harbor CA" },
    { name: "organizationName", value: "Harbor" },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

export function createServerCertificate(caCertPem: string, caKeyPem: string): { certPem: string; keyPem: string } {
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);
  const keys = rsaPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  dated(cert, 825);
  cert.setSubject([
    { name: "commonName", value: "harbor" },
    { name: "organizationName", value: "Harbor" },
  ]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectKeyIdentifier" },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "harbor" },
        { type: 7, ip: "127.0.0.1" },
      ],
    },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

export function issueClientCertificate(caCertPem: string, caKeyPem: string, upn: string): SslCredential {
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);
  const keys = rsaPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  dated(cert, 825);
  cert.setSubject([
    { name: "commonName", value: upn },
    { name: "organizationName", value: "Harbor" },
  ]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, critical: true },
    { name: "extKeyUsage", clientAuth: true },
    { name: "subjectKeyIdentifier" },
    { name: "subjectAltName", altNames: [{ type: 1, value: upn }] },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return {
    serial: cert.serialNumber,
    fingerprint: fingerprint(cert),
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    exportPassword: sampleSecret(),
  };
}

export function pkcs12(credential: SslCredential, caCertPem: string): Buffer {
  const key = forge.pki.privateKeyFromPem(credential.keyPem);
  const cert = forge.pki.certificateFromPem(credential.certPem);
  const ca = forge.pki.certificateFromPem(caCertPem);
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, [cert, ca], credential.exportPassword, {
    algorithm: "3des",
    friendlyName: credential.serial,
  });
  const der = forge.asn1.toDer(asn1).getBytes();
  return Buffer.from(der, "binary");
}

export function ensureLoginMaterial(db: Database): boolean {
  let changed = false;
  if (!db.settings.caCertPem || !db.settings.caKeyPem) {
    const ca = createAuthority();
    db.settings.caCertPem = ca.certPem;
    db.settings.caKeyPem = ca.keyPem;
    db.settings.serverCertPem = "";
    db.settings.serverKeyPem = "";
    changed = true;
  }
  if (!db.settings.serverCertPem || !db.settings.serverKeyPem) {
    const server = createServerCertificate(db.settings.caCertPem, db.settings.caKeyPem);
    db.settings.serverCertPem = server.certPem;
    db.settings.serverKeyPem = server.keyPem;
    changed = true;
  }
  if (!db.settings.loginSamplesBootstrapped) {
    const maya = db.users.find((user) => user.id === "maya");
    if (maya && !maya.emergency) {
      if (!maya.passwordHash) {
        const password = sampleSecret();
        maya.passwordHash = hashPassword(password);
        db.settings.shownLocalPasswords[maya.id] = password;
      }
      if (!maya.ssl && db.settings.caCertPem && db.settings.caKeyPem) {
        maya.ssl = issueClientCertificate(db.settings.caCertPem, db.settings.caKeyPem, maya.upn);
      }
    }
    db.settings.loginSamplesBootstrapped = true;
    changed = true;
  }
  return changed;
}
