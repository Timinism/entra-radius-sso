import { createSocket, type Socket } from "node:dgram";

import { handlePacket, waitForPacket } from "../lib/engine";
import { listenerStage, radiusListenerEnabled } from "../lib/store";

type ListenerStatus = {
  bound: boolean;
  authPort: number;
  acctPort: number;
  error: string | null;
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
  console.info(
    listenerStatus.bound
      ? `[harbor] RADIUS listening on UDP ${listenerStatus.authPort} and ${listenerStatus.acctPort}`
      : `[harbor] RADIUS did not bind: ${listenerStatus.error ?? "unknown"}`,
  );
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
