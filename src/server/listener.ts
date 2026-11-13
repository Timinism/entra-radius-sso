import { createSocket, type Socket } from "node:dgram";
import { createServer, type TLSSocket } from "node:tls";

import { handlePacket, waitForPacket } from "../lib/engine";
import { normalizeIp, peerPresented, takeRadiusPackets, tlsIdentity } from "../lib/radsec";
import { listenerStage, radiusListenerEnabled, readState } from "../lib/store";

type ListenerStatus = {
  bound: boolean;
  authPort: number;
  acctPort: number;
  error: string | null;
  tlsBound: boolean;
  tlsPort: number;
  tlsError: string | null;
};

const globalState = globalThis as typeof globalThis & {
  __harborRadius?: boolean;
  __harborListener?: ListenerStatus;
};

export const listenerStatus: ListenerStatus =
  globalState.__harborListener ??
  (globalState.__harborListener = {
    bound: false,
    authPort: 11812,
    acctPort: 11813,
    error: null,
    tlsBound: false,
    tlsPort: 11814,
    tlsError: null,
  });

const waits = new Map<string, Promise<Buffer | null>>();
let active = 0;

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return fallback;
  return value;
}

function listen(socket: Socket, portNumber: number, label: string): Promise<void> {
  return new Promise((resolve) => {
    const fail = (error: Error) => {
      listenerStatus.error = `${label} ${error.message}`;
      listenerStatus.bound = false;
      resolve();
    };
    socket.once("error", fail);
    socket.bind(portNumber, "0.0.0.0", () => {
      socket.off("error", fail);
      socket.on("error", (error) => {
        listenerStatus.error = error.message;
        listenerStatus.bound = false;
      });
      resolve();
    });
  });
}

export async function startRadiusListener(): Promise<void> {
  if (globalState.__harborRadius || !radiusListenerEnabled()) return;
  globalState.__harborRadius = true;
  listenerStatus.authPort = port("HARBOR_RADIUS_PORT", 11812);
  listenerStatus.acctPort = port("HARBOR_ACCT_PORT", 11813);
  listenerStatus.tlsPort = port("HARBOR_TLS_PORT", 11814);
  const stage = listenerStage();
  const auth = createSocket("udp4");
  const acct = createSocket("udp4");
  const onMessage = (socket: Socket) => (message: Buffer, remote: { address: string; port: number }) => {
    void receive(socket, message, remote, stage);
  };
  auth.on("message", onMessage(auth));
  acct.on("message", onMessage(acct));
  await listen(auth, listenerStatus.authPort, "Authentication");
  await listen(acct, listenerStatus.acctPort, "Accounting");
  if (!listenerStatus.error) listenerStatus.bound = true;
  await listenTls(stage);
  const udp = listenerStatus.bound
    ? `UDP ${listenerStatus.authPort} and ${listenerStatus.acctPort}`
    : `UDP did not bind (${listenerStatus.error ?? "unknown"})`;
  const tls = listenerStatus.tlsBound
    ? `TLS ${listenerStatus.tlsPort}`
    : `TLS did not bind (${listenerStatus.tlsError ?? "unknown"})`;
  console.info(`[harbor] RADIUS listening on ${udp}; ${tls}`);
}

async function listenTls(stage: ReturnType<typeof listenerStage>): Promise<void> {
  try {
    const db = await readState(stage);
    if (!db.settings.serverCertPem || !db.settings.serverKeyPem || !db.settings.caCertPem) {
      listenerStatus.tlsError = "Harbor has no TLS certificate yet.";
      return;
    }
    const server = createServer(
      {
        cert: db.settings.serverCertPem,
        key: db.settings.serverKeyPem,
        ca: db.settings.caCertPem,
        requestCert: true,
        rejectUnauthorized: false,
      },
      (socket) => onTls(socket, stage),
    );
    await new Promise<void>((resolve) => {
      const fail = (error: Error) => {
        listenerStatus.tlsError = error.message;
        listenerStatus.tlsBound = false;
        resolve();
      };
      server.once("error", fail);
      server.listen(listenerStatus.tlsPort, "0.0.0.0", () => {
        server.off("error", fail);
        server.on("error", (error) => {
          listenerStatus.tlsError = error.message;
          listenerStatus.tlsBound = false;
        });
        listenerStatus.tlsBound = true;
        listenerStatus.tlsError = null;
        resolve();
      });
    });
  } catch (error) {
    listenerStatus.tlsError = error instanceof Error ? error.message : "TLS listener failed.";
    listenerStatus.tlsBound = false;
  }
}

function onTls(socket: TLSSocket, stage: ReturnType<typeof listenerStage>): void {
  const peer = socket.getPeerCertificate();
  if (peerPresented(peer) && !socket.authorized) {
    socket.destroy();
    return;
  }
  const identity = tlsIdentity(peerPresented(peer) ? peer : null, socket.authorized);
  const remote = normalizeIp(socket.remoteAddress);
  let buffer: Buffer = Buffer.alloc(0);
  let chain: Promise<void> = Promise.resolve();
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const taken = takeRadiusPackets(buffer);
    if (taken.error) {
      socket.destroy();
      return;
    }
    buffer = taken.rest;
    for (const packet of taken.packets) {
      const current = packet;
      chain = chain
        .then(async () => {
          if (active >= 80) return;
          active += 1;
          try {
            const result = await handlePacket(stage, current, remote, "radius", {
              tlsUserUpn: identity.userUpn,
              tlsDeviceName: identity.deviceName,
            });
            if (result.kind === "drop") return;
            if (result.kind === "reply") {
              socket.write(result.packet);
              return;
            }
            const id = result.approval.id;
            let waiting = waits.get(id);
            if (!waiting) {
              waiting = waitForPacket(stage, id).finally(() => {
                waits.delete(id);
              });
              waits.set(id, waiting);
            }
            const reply = await waiting;
            if (reply) socket.write(reply);
          } finally {
            active -= 1;
          }
        })
        .catch((error: unknown) => {
          const messageText = error instanceof Error ? error.message : "handler failed";
          console.error(`[harbor] TLS RADIUS request failed: ${messageText}`);
        });
    }
  });
}

async function receive(
  socket: Socket,
  message: Buffer,
  remote: { address: string; port: number },
  stage: ReturnType<typeof listenerStage>,
): Promise<void> {
  if (active >= 80) return;
  try {
    const result = await handlePacket(stage, message, remote.address, "radius");
    if (result.kind === "drop") return;
    if (result.kind === "reply") {
      socket.send(result.packet, remote.port, remote.address);
      return;
    }
    const id = result.approval.id;
    let waiting = waits.get(id);
    if (!waiting) {
      active += 1;
      waiting = waitForPacket(stage, id).finally(() => {
        active -= 1;
        waits.delete(id);
      });
      waits.set(id, waiting);
    }
    const packet = await waiting;
    if (packet) socket.send(packet, remote.port, remote.address);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "handler failed";
    console.error(`[harbor] RADIUS request failed: ${messageText}`);
  }
}
