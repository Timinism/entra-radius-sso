import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import { ensureLoginMaterial } from "./certs";
import { emptyDatabase, seedDatabase } from "./seed";
import type { Database, Device, DirectoryUser, LoginMethod, SslCredential, Stage } from "./types";

const chains = new Map<string, Promise<unknown>>();

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function listenerStage(): Stage {
  return process.env.VERCEL_ENV === "preview" ? "preview" : "production";
}

export function radiusListenerEnabled(): boolean {
  if (process.env.HARBOR_DISABLE_RADIUS === "1") return false;
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  if (process.env.VERCEL_ENV === "preview") return false;
  return true;
}

function enqueue<T>(stage: Stage, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(stage) ?? Promise.resolve();
  const run = previous.then(task, task);
  chains.set(
    stage,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function clone(db: Database): Database {
  return JSON.parse(JSON.stringify(db)) as Database;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const LOGIN_METHODS: LoginMethod[] = ["ssl", "sso", "local"];

export function normalizeDatabase(value: unknown): Database {
  if (!isRecord(value) || value.seeded !== true) return seedDatabase();
  const base = emptyDatabase();
  const settings = isRecord(value.settings) ? value.settings : {};
  return {
    version: 1,
    seeded: true,
    devices: Array.isArray(value.devices) ? value.devices.map(normalizeDevice).filter((device) => device !== null) : [],
    policies: Array.isArray(value.policies) ? (value.policies as Database["policies"]) : [],
    users: Array.isArray(value.users) ? value.users.map(normalizeUser).filter((user) => user !== null) : [],
    approvals: Array.isArray(value.approvals) ? (value.approvals as Database["approvals"]) : [],
    events: Array.isArray(value.events) ? (value.events as Database["events"]) : [],
    settings: {
      ...base.settings,
      tenantId: stringOr(settings.tenantId, ""),
      clientId: stringOr(settings.clientId, ""),
      breakglassEnabled: settings.breakglassEnabled !== false,
      breakglassPassword: stringOr(settings.breakglassPassword, ""),
      requireMessageAuthenticator: settings.requireMessageAuthenticator === true,
      timeoutSeconds: clampTimeout(settings.timeoutSeconds),
      radiusHost: stringOr(settings.radiusHost, ""),
      cookieKey: stringOr(settings.cookieKey, base.settings.cookieKey),
      caCertPem: stringOr(settings.caCertPem, ""),
      caKeyPem: stringOr(settings.caKeyPem, ""),
      serverCertPem: stringOr(settings.serverCertPem, ""),
      serverKeyPem: stringOr(settings.serverKeyPem, ""),
      shownLocalPasswords: stringMap(settings.shownLocalPasswords),
      loginSamplesBootstrapped: settings.loginSamplesBootstrapped === true,
    },
  };
}

function normalizeDevice(value: unknown): Device | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const device = value as Device;
  device.logins = normalizeLogins(value.logins);
  return device;
}

function normalizeLogins(value: unknown): LoginMethod[] {
  if (!Array.isArray(value)) return [...LOGIN_METHODS];
  const picked = LOGIN_METHODS.filter((method) => value.includes(method));
  return picked.length > 0 ? picked : [...LOGIN_METHODS];
}

function normalizeUser(value: unknown): DirectoryUser | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const user = value as DirectoryUser;
  if (typeof user.passwordHash !== "string") user.passwordHash = null;
  user.ssl = sslCredential(value.ssl);
  return user;
}

function sslCredential(value: unknown): SslCredential | null {
  if (!isRecord(value)) return null;
  const serial = stringOr(value.serial, "");
  const fingerprint = stringOr(value.fingerprint, "");
  const certPem = stringOr(value.certPem, "");
  const keyPem = stringOr(value.keyPem, "");
  const exportPassword = stringOr(value.exportPassword, "");
  if (!serial || !fingerprint || !certPem || !keyPem || !exportPassword) return null;
  return { serial, fingerprint, certPem, keyPem, exportPassword };
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^[A-Za-z0-9._-]{1,40}$/.test(key) && typeof item === "string" && item.length <= 80) out[key] = item;
  }
  return out;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function clampTimeout(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 45;
  return Math.max(15, Math.min(90, Math.trunc(number)));
}

function trim(db: Database): void {
  db.events.sort((a, b) => (a.at < b.at ? 1 : -1));
  db.events.splice(300);
  const pending = db.approvals.filter((approval) => approval.status === "pending");
  const done = db.approvals
    .filter((approval) => approval.status !== "pending")
    .sort((a, b) => ((a.resolvedAt ?? a.createdAt) < (b.resolvedAt ?? b.createdAt) ? 1 : -1))
    .slice(0, 120);
  db.approvals = [...pending, ...done];
}

function dataFile(stage: Stage): string {
  const dir = process.env.HARBOR_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, `harbor-${stage}.json`);
}

function finishLoad(value: unknown): { db: Database; dirty: boolean } {
  const fresh = !isRecord(value) || value.seeded !== true;
  const db = fresh ? seedDatabase() : normalizeDatabase(value);
  const material = ensureLoginMaterial(db);
  let dirty = fresh || material;
  if (!db.settings.cookieKey) {
    db.settings.cookieKey = randomBytes(32).toString("base64url");
    dirty = true;
  }
  return { db, dirty };
}

async function loadFile(stage: Stage): Promise<{ db: Database; dirty: boolean }> {
  try {
    const raw = await readFile(dataFile(stage), "utf8");
    return finishLoad(JSON.parse(raw) as unknown);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === "ENOENT") return finishLoad(null);
    throw new Error("Harbor could not read its saved directory.");
  }
}

async function saveFile(stage: Stage, db: Database): Promise<void> {
  const file = dataFile(stage);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(db), "utf8");
  await rename(temporary, file);
}

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Database is unavailable.");
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(
          `CREATE TABLE IF NOT EXISTS harbor_state (
            stage text PRIMARY KEY,
            data jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          )`,
        );
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function loadPostgres(stage: Stage): Promise<{ db: Database; dirty: boolean }> {
  try {
    await ensureSchema();
    const result = await getPool().query<{ data: unknown }>("SELECT data FROM harbor_state WHERE stage = $1", [
      stage,
    ]);
    if (result.rowCount === 0) return finishLoad(null);
    return finishLoad(result.rows[0]?.data);
  } catch (error) {
    if (error instanceof Error && error.message === "Database is unavailable.") throw error;
    throw new Error("Database is unavailable.");
  }
}

async function savePostgres(stage: Stage, db: Database): Promise<void> {
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO harbor_state (stage, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (stage) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [stage, JSON.stringify(db)],
    );
  } catch {
    throw new Error("Database is unavailable.");
  }
}

async function load(stage: Stage): Promise<{ db: Database; dirty: boolean }> {
  return process.env.DATABASE_URL ? loadPostgres(stage) : loadFile(stage);
}

async function save(stage: Stage, db: Database): Promise<void> {
  if (process.env.DATABASE_URL) await savePostgres(stage, db);
  else await saveFile(stage, db);
}

export async function readState(stage: Stage): Promise<Database> {
  return enqueue(stage, async () => {
    const loaded = await load(stage);
    if (loaded.dirty) await save(stage, loaded.db);
    return clone(loaded.db);
  });
}

export async function withState<T>(stage: Stage, change: (db: Database) => T): Promise<T> {
  return enqueue(stage, async () => {
    const loaded = await load(stage);
    const db = loaded.db;
    const result = change(db);
    trim(db);
    await save(stage, db);
    return result;
  });
}
