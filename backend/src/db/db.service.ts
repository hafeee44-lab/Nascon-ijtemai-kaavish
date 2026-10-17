import { Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';

// Plain SQL over node-postgres. Domain records live in `docs` (kind, id, jsonb);
// tables that need atomic/append-only guarantees get their own schema.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (
  kind text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (kind, id));
CREATE TABLE IF NOT EXISTS match_events (
  match_id text NOT NULL, seq int NOT NULL, event_id text NOT NULL UNIQUE,
  type text NOT NULL, payload jsonb NOT NULL, signature text,
  request jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seq));
CREATE TABLE IF NOT EXISTS inventory (
  variant_id text PRIMARY KEY,
  stock int NOT NULL CHECK (stock >= 0),
  reserved int NOT NULL DEFAULT 0 CHECK (reserved >= 0));
CREATE TABLE IF NOT EXISTS roster_audit (
  seq bigserial PRIMARY KEY, audit_id text NOT NULL UNIQUE,
  player_id text NOT NULL, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value jsonb NOT NULL);
`;

export type Tx = pg.PoolClient;

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://nascon:nascon@localhost:5432/nascon',
    max: 30,
  });

  async init() {
    for (let i = 0; ; i++) {
      try {
        await this.pool.query(SCHEMA);
        return;
      } catch (e) {
        if (i > 60) throw e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params);
  }

  async tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async get<T = any>(kind: string, id: string, c: Tx | pg.Pool = this.pool): Promise<T | null> {
    const r = await c.query('SELECT data FROM docs WHERE kind=$1 AND id=$2', [kind, id]);
    return r.rows[0]?.data ?? null;
  }

  async getForUpdate<T = any>(c: Tx, kind: string, id: string): Promise<T | null> {
    const r = await c.query('SELECT data FROM docs WHERE kind=$1 AND id=$2 FOR UPDATE', [kind, id]);
    return r.rows[0]?.data ?? null;
  }

  async put(kind: string, id: string, data: unknown, c: Tx | pg.Pool = this.pool) {
    await c.query(
      `INSERT INTO docs(kind,id,data) VALUES($1,$2,$3)
       ON CONFLICT (kind,id) DO UPDATE SET data=EXCLUDED.data`,
      [kind, id, JSON.stringify(data)],
    );
  }

  async list<T = any>(kind: string, c: Tx | pg.Pool = this.pool): Promise<T[]> {
    const r = await c.query('SELECT data FROM docs WHERE kind=$1 ORDER BY id', [kind]);
    return r.rows.map((x) => x.data);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
