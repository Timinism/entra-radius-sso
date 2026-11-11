import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import { emptyDatabase, seedDatabase } from "./seed";
import type { Database, Stage } from "./types";

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

export function normalizeDatabase(value: unknown): Database {
  if (!isRecord(value) || value.seeded !== true) return seedDatabase();
  const base = emptyDatabase();
  const settings = isRecord(value.settings) ? value.settings : {};
  return {
    version: 1,
    seeded: true,
    devices: Array.isArray(value.devices) ? (value.devices as Database["devices"]) : [],
    policies: Array.isArray(value.policies) ? (value.policies as Database["policies"]) : [],
    users: Array.isArray(value.users) ? (value.users as Database["users"]) : [],
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
    },
  };
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
  if (!isRecord(value) || value.seeded !== true) return { db: seedDatabase(), dirty: true };
  const db = normalizeDatabase(value);
  if (db.settings.cookieKey) return { db, dirty: false };
  db.settings.cookieKey = randomBytes(32).toString("base64url");
  return { db, dirty: true };
}

async function loadFile(stage: Stage): Promise<{ db: Database; dirty: boolean }> {
  try {
    const raw = await readFile(dataFile(stage), "utf8");
    return finishLoad(JSON.parse(raw) as unknown);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === "ENOENT") return { db: seedDatabase(), dirty: true };
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
    if (result.rowCount === 0) return { db: seedDatabase(), dirty: true };
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
