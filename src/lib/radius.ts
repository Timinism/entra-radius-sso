import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { DisplayAttr } from "./types";

export type WireAttr = {
  type: number;
  value: Buffer;
  vendorId?: number;
  vendorType?: number;
};

export type DecodedPacket = {
  code: number;
  identifier: number;
  length: number;
  authenticator: Buffer;
  attributes: WireAttr[];
};

const CODE_NAME: Record<number, string> = {
  1: "Access-Request",
  2: "Access-Accept",
  3: "Access-Reject",
  4: "Accounting-Request",
  5: "Accounting-Response",
  11: "Access-Challenge",
};

const SERVICE_TYPE: Record<number, string> = {
  1: "Login-User",
  2: "Framed",
  6: "Administrative-User",
  7: "NAS-Prompt",
};

const PA_NAME: Record<number, string> = {
  1: "PaloAlto-Admin-Role",
  2: "PaloAlto-Admin-Access-Domain",
  3: "PaloAlto-Panorama-Admin-Role",
  4: "PaloAlto-Panorama-Access-Domain",
  5: "PaloAlto-User-Group",
  6: "PaloAlto-User-Domain",
  7: "PaloAlto-Client-Source-IP",
  8: "PaloAlto-Client-OS",
  9: "PaloAlto-Client-Hostname",
  10: "PaloAlto-GlobalProtect-Client-Version",
};

export function codeName(code: number): string {
  return CODE_NAME[code] ?? `Code-${code}`;
}

export function utf8Attr(type: number, text: string): WireAttr {
  return { type, value: Buffer.from(text, "utf8") };
}

export function u32Attr(type: number, value: number): WireAttr {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return { type, value: buf };
}

export function ipv4Attr(type: number, ip: string): WireAttr {
  const parts = ip.split(".").map((part) => Number(part));
  return { type, value: Buffer.from(parts) };
}

export function vendorAttr(vendorId: number, vendorType: number, text: string): WireAttr {
  return {
    type: 26,
    vendorId,
    vendorType,
    value: Buffer.from(text, "utf8"),
  };
}

export function encodeAttributes(attributes: WireAttr[]): Buffer {
  const parts: Buffer[] = [];
  for (const attr of attributes) {
    if (attr.vendorId !== undefined && attr.vendorType !== undefined) {
      if (attr.value.length > 247) {
        throw new Error("Vendor attribute is too long.");
      }
      const innerLength = attr.value.length + 2;
      const buf = Buffer.alloc(6 + innerLength);
      buf[0] = 26;
      buf[1] = 6 + innerLength;
      buf.writeUInt32BE(attr.vendorId, 2);
      buf[6] = attr.vendorType;
      buf[7] = innerLength;
      attr.value.copy(buf, 8);
      parts.push(buf);
      continue;
    }
    if (attr.value.length > 253) {
      throw new Error("Attribute is too long.");
    }
    const buf = Buffer.alloc(2 + attr.value.length);
    buf[0] = attr.type;
    buf[1] = buf.length;
    attr.value.copy(buf, 2);
    parts.push(buf);
  }
  return Buffer.concat(parts);
}

export function decodePacket(packet: Buffer): DecodedPacket | { error: string } {
  if (packet.length < 20) return { error: "Packet is shorter than a RADIUS header." };
  const length = packet.readUInt16BE(2);
  if (length < 20 || length > 4096 || length > packet.length) {
    return { error: "Packet length is not valid." };
  }
  const body = packet.subarray(0, length);
  const attributes: WireAttr[] = [];
  let offset = 20;
  while (offset < body.length) {
    if (offset + 2 > body.length) return { error: "Attribute header is truncated." };
    const type = body[offset];
    const attrLength = body[offset + 1];
    if (attrLength < 2 || offset + attrLength > body.length) {
      return { error: "Attribute length is not valid." };
    }
    const raw = body.subarray(offset + 2, offset + attrLength);
    if (type === 26 && raw.length >= 5) {
      const vendorId = raw.readUInt32BE(0);
      let inner = 4;
      let produced = 0;
      while (inner + 2 <= raw.length) {
        const vendorType = raw[inner];
        const vendorLength = raw[inner + 1];
        if (vendorLength < 2 || inner + vendorLength > raw.length) break;
        attributes.push({
          type: 26,
          vendorId,
          vendorType,
          value: Buffer.from(raw.subarray(inner + 2, inner + vendorLength)),
        });
        produced += 1;
        inner += vendorLength;
      }
      if (produced === 0) {
        attributes.push({ type, value: Buffer.from(raw) });
      }
    } else {
      attributes.push({ type, value: Buffer.from(raw) });
    }
    offset += attrLength;
  }
  return {
    code: body[0],
    identifier: body[1],
    length,
    authenticator: Buffer.from(body.subarray(4, 20)),
    attributes,
  };
}

export function hidePassword(password: string, secret: string, requestAuth: Buffer): Buffer {
  const secretBuf = Buffer.from(secret, "utf8");
  const plain = Buffer.from(password, "utf8");
  const padded = Buffer.alloc(Math.max(16, Math.ceil(plain.length / 16) * 16));
  plain.copy(padded);
  const out = Buffer.alloc(padded.length);
  let previous: Buffer = requestAuth;
  for (let offset = 0; offset < padded.length; offset += 16) {
    const hash = createHash("md5").update(secretBuf).update(previous).digest();
    for (let i = 0; i < 16; i += 1) out[offset + i] = padded[offset + i] ^ hash[i];
    previous = out.subarray(offset, offset + 16);
  }
  return out;
}

export function revealPassword(hidden: Buffer, secret: string, requestAuth: Buffer): string {
  if (hidden.length === 0 || hidden.length % 16 !== 0 || hidden.length > 128) return "";
  const secretBuf = Buffer.from(secret, "utf8");
  const out = Buffer.alloc(hidden.length);
  let previous: Buffer = requestAuth;
  for (let offset = 0; offset < hidden.length; offset += 16) {
    const hash = createHash("md5").update(secretBuf).update(previous).digest();
    const block = hidden.subarray(offset, offset + 16);
    for (let i = 0; i < 16; i += 1) out[offset + i] = block[i] ^ hash[i];
    previous = block;
  }
  let end = out.length;
  while (end > 0 && out[end - 1] === 0) end -= 1;
  return out.subarray(0, end).toString("utf8");
}

function messageAuthenticatorOffset(packet: Buffer): number {
  let offset = 20;
  while (offset + 2 <= packet.length) {
    const type = packet[offset];
    const attrLength = packet[offset + 1];
    if (attrLength < 2 || offset + attrLength > packet.length) return -1;
    if (type === 80 && attrLength === 18) return offset + 2;
    offset += attrLength;
  }
  return -1;
}

export function messageAuthenticatorStatus(
  packet: Buffer,
  secret: string,
): "absent" | "valid" | "invalid" {
  const offset = messageAuthenticatorOffset(packet);
  if (offset < 0) return "absent";
  const presented = packet.subarray(offset, offset + 16);
  const copy = Buffer.from(packet);
  copy.fill(0, offset, offset + 16);
  const mac = createHmac("md5", Buffer.from(secret, "utf8")).update(copy).digest();
  if (mac.length !== presented.length) return "invalid";
  return timingSafeEqual(mac, presented) ? "valid" : "invalid";
}

export function accountingAuthenticatorValid(packet: Buffer, secret: string): boolean {
  if (packet.length < 20) return false;
  const presented = packet.subarray(4, 20);
  const copy = Buffer.from(packet);
  copy.fill(0, 4, 20);
  const expected = createHash("md5").update(copy).update(Buffer.from(secret, "utf8")).digest();
  return timingSafeEqual(expected, presented);
}

export function buildResponse(options: {
  code: number;
  identifier: number;
  requestAuthenticator: Buffer;
  secret: string;
  attributes: WireAttr[];
  messageAuthenticator: boolean;
}): Buffer {
  const attributes = [...options.attributes];
  if (options.messageAuthenticator) {
    attributes.push({ type: 80, value: Buffer.alloc(16) });
  }
  const encoded = encodeAttributes(attributes);
  const length = 20 + encoded.length;
  const packet = Buffer.alloc(length);
  packet[0] = options.code;
  packet[1] = options.identifier;
  packet.writeUInt16BE(length, 2);
  options.requestAuthenticator.copy(packet, 4);
  encoded.copy(packet, 20);
  if (options.messageAuthenticator) {
    const offset = messageAuthenticatorOffset(packet);
    if (offset > 0) {
      packet.fill(0, offset, offset + 16);
      const mac = createHmac("md5", Buffer.from(options.secret, "utf8")).update(packet).digest();
      mac.copy(packet, offset);
    }
  }
  const responseAuth = createHash("md5")
    .update(packet)
    .update(Buffer.from(options.secret, "utf8"))
    .digest();
  responseAuth.copy(packet, 4);
  return packet;
}

export function responseAuthenticatorValid(
  packet: Buffer,
  secret: string,
  requestAuthenticator: Buffer,
): boolean {
  if (packet.length < 20 || requestAuthenticator.length !== 16) return false;
  const presented = packet.subarray(4, 20);
  const copy = Buffer.from(packet);
  requestAuthenticator.copy(copy, 4);
  const expected = createHash("md5").update(copy).update(Buffer.from(secret, "utf8")).digest();
  return timingSafeEqual(expected, presented);
}

export function attrText(attr: WireAttr): string {
  return attr.value.toString("utf8");
}

export function usernameOf(attributes: WireAttr[]): string {
  const found = attributes.find((attr) => attr.type === 1 && attr.vendorId === undefined);
  return found ? attrText(found).trim() : "";
}

export function nasIpOf(attributes: WireAttr[]): string | null {
  const found = attributes.find((attr) => attr.type === 4 && attr.value.length === 4);
  if (!found) return null;
  return [...found.value].join(".");
}

export function hasGlobalProtectHint(attributes: WireAttr[]): boolean {
  return attributes.some(
    (attr) =>
      attr.vendorId === 25461 &&
      attr.vendorType !== undefined &&
      attr.vendorType >= 7 &&
      attr.vendorType <= 10,
  );
}

function printable(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "");
}

export function describeAttribute(attr: WireAttr): DisplayAttr {
  if (attr.vendorId === 9 && attr.vendorType === 1) {
    return {
      name: "Cisco-AVPair",
      value: printable(attrText(attr)),
      id: "26:9:1",
    };
  }
  if (attr.vendorId === 25461 && attr.vendorType !== undefined) {
    return {
      name: PA_NAME[attr.vendorType] ?? `PaloAlto-${attr.vendorType}`,
      value: printable(attrText(attr)),
      id: `26:25461:${attr.vendorType}`,
    };
  }
  if (attr.type === 2) {
    return { name: "User-Password", value: "hidden", id: "2" };
  }
  if (attr.type === 80) {
    return { name: "Message-Authenticator", value: "present", id: "80" };
  }
  if (attr.type === 4 && attr.value.length === 4) {
    return { name: "NAS-IP-Address", value: [...attr.value].join("."), id: "4" };
  }
  if (attr.type === 6 && attr.value.length === 4) {
    const code = attr.value.readUInt32BE(0);
    return {
      name: "Service-Type",
      value: SERVICE_TYPE[code] ?? String(code),
      id: "6",
    };
  }
  const names: Record<number, string> = {
    1: "User-Name",
    18: "Reply-Message",
    24: "State",
    25: "Class",
    32: "NAS-Identifier",
    40: "Acct-Status-Type",
  };
  return {
    name: names[attr.type] ?? `Attribute-${attr.type}`,
    value: printable(attrText(attr)),
    id: String(attr.type),
  };
}

export function describeAttributes(attributes: WireAttr[]): DisplayAttr[] {
  return attributes.map(describeAttribute);
}

export function buildAccessRequest(options: {
  identifier: number;
  username: string;
  password: string;
  secret: string;
  nasIp: string;
  nasIdentifier: string;
  globalProtect: boolean;
  authenticator: Buffer;
}): Buffer {
  const hidden = hidePassword(options.password, options.secret, options.authenticator);
  const attributes: WireAttr[] = [
    utf8Attr(1, options.username),
    { type: 2, value: hidden },
    ipv4Attr(4, options.nasIp),
    utf8Attr(32, options.nasIdentifier),
  ];
  if (options.globalProtect) {
    attributes.push(vendorAttr(25461, 9, "staff-laptop"));
  }
  attributes.push({ type: 80, value: Buffer.alloc(16) });
  const encoded = encodeAttributes(attributes);
  const packet = Buffer.alloc(20 + encoded.length);
  packet[0] = 1;
  packet[1] = options.identifier;
  packet.writeUInt16BE(packet.length, 2);
  options.authenticator.copy(packet, 4);
  encoded.copy(packet, 20);
  const offset = messageAuthenticatorOffset(packet);
  if (offset > 0) {
    const mac = createHmac("md5", Buffer.from(options.secret, "utf8")).update(packet).digest();
    mac.copy(packet, offset);
  }
  return packet;
}
