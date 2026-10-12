// A D1Database for tests on top of Node's built-in SQLite (Node 22+), with the real migrations.
// @ts-expect-error Node's types aren't installed (the Worker never runs on Node)
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error same
import { readFileSync, readdirSync } from "node:fs";

class Stmt {
  constructor(private db: any, private sql: string, private args: unknown[] = []) {}
  bind(...a: unknown[]) {
    return new Stmt(this.db, this.sql, a);
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.args) as T) ?? null;
  }
  async run() {
    this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: {} };
  }
  async all<T>() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.args) as T[] };
  }
}

export class FakeD1 {
  db: any;
  constructor() {
    this.db = new DatabaseSync(":memory:");
    const dir = new URL("../migrations/", (import.meta as unknown as { url: string }).url);
    for (const f of (readdirSync(dir) as string[]).sort()) this.db.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  prepare(sql: string) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts: Stmt[]) {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }
  rows(sql: string, ...args: unknown[]): any[] {
    return this.db.prepare(sql).all(...args);
  }
}
