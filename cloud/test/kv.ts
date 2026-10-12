// In-memory KV with TTLs, enough of the KVNamespace API for the Worker.
export class FakeKV {
  m = new Map<string, { v: string; exp: number }>();
  writes = 0;
  async get(k: string, type?: string): Promise<any> {
    const e = this.m.get(k);
    if (!e || (e.exp && e.exp < Date.now())) return null;
    return type === "json" ? JSON.parse(e.v) : e.v;
  }
  async put(k: string, v: string, o?: { expirationTtl?: number }) {
    this.writes++;
    this.m.set(k, { v, exp: o && o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 });
  }
  async delete(k: string) {
    this.m.delete(k);
  }
  keys(prefix: string) {
    return [...this.m.keys()].filter(k => k.startsWith(prefix));
  }
}

