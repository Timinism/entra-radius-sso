import { connect, type PeerCertificate, type TLSSocket } from "node:tls";

export type FramedPackets = {
  packets: Buffer[];
  rest: Buffer;
  error: string | null;
};

export function takeRadiusPackets(buffer: Buffer): FramedPackets {
  const packets: Buffer[] = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 20 || length > 4096) {
      return { packets, rest: Buffer.alloc(0), error: "RADIUS length is not valid." };
    }
    if (buffer.length - offset < length) break;
    packets.push(Buffer.from(buffer.subarray(offset, offset + length)));
    offset += length;
  }
  return { packets, rest: Buffer.from(buffer.subarray(offset)), error: null };
}

export function tlsIdentity(certificate: PeerCertificate | null, authorized: boolean): {
  userUpn: string | null;
  deviceName: string | null;
} {
  if (!certificate || !authorized) return { userUpn: null, deviceName: null };
  const commonNameValue = certificate.subject?.CN;
  const commonName = (Array.isArray(commonNameValue) ? commonNameValue[0] : commonNameValue)?.trim() ?? "";
  const alt = certificate.subjectaltname ?? "";
  const email = /email:([^,\s]+)/i.exec(alt)?.[1] ?? (commonName.includes("@") ? commonName : "");
  if (email) return { userUpn: email, deviceName: null };
  if (commonName) return { userUpn: null, deviceName: commonName };
  return { userUpn: null, deviceName: null };
}

export function peerPresented(certificate: PeerCertificate | null): boolean {
  return Boolean(certificate && certificate.raw && certificate.raw.length > 0);
}

export function exchangeTls(options: {
  host: string;
  port: number;
  caPem: string;
  certPem?: string;
  keyPem?: string;
  packet: Buffer;
  timeoutMs?: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, packet?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error || !packet) reject(error ?? new Error("SSL login did not answer."));
      else resolve(packet);
    };
    const socket: TLSSocket = connect(
      {
        host: options.host,
        port: options.port,
        ca: options.caPem,
        cert: options.certPem,
        key: options.keyPem,
        servername: "harbor",
        rejectUnauthorized: true,
      },
      () => {
        socket.write(options.packet);
      },
    );
    let buffer: Buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      finish(new Error("SSL login timed out."));
    }, options.timeoutMs ?? 8000);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const taken = takeRadiusPackets(buffer);
      if (taken.error) {
        socket.destroy();
        finish(new Error(taken.error));
        return;
      }
      buffer = taken.rest;
      const packet = taken.packets[0];
      if (packet) {
        socket.end();
        finish(null, packet);
      }
    });
    socket.on("error", (error) => {
      finish(error);
    });
  });
}

export function normalizeIp(address: string | undefined): string {
  if (!address) return "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}
