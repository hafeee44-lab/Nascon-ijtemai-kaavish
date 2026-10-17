// In-memory stand-in for Db used by unit tests of the store and roster services.
// It understands exactly the SQL those services issue.
export class FakeDb {
  docs = new Map<string, any>();
  inventory = new Map<string, { stock: number; reserved: number }>();
  audit: { seq: number; audit_id: string; player_id: string; data: any }[] = [];
  pool = this;

  private k = (kind: string, id: string) => `${kind}\u0000${id}`;

  async get(kind: string, id: string) {
    const v = this.docs.get(this.k(kind, id));
    return v === undefined ? null : structuredClone(v);
  }
  getForUpdate(_c: unknown, kind: string, id: string) {
    return this.get(kind, id);
  }
  async put(kind: string, id: string, data: unknown) {
    this.docs.set(this.k(kind, id), structuredClone(data));
  }
  async list(kind: string) {
    return [...this.docs.entries()].filter(([key]) => key.startsWith(kind + '\u0000')).map(([, v]) => structuredClone(v));
  }
  async tx<T>(fn: (c: any) => Promise<T>): Promise<T> {
    const snapshot = { docs: new Map(this.docs), inventory: new Map([...this.inventory].map(([k, v]) => [k, { ...v }])), audit: [...this.audit] };
    try {
      return await fn(this);
    } catch (e) {
      Object.assign(this, snapshot);
      throw e;
    }
  }

  async query(sql: string, p: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const q = sql.replace(/\s+/g, ' ').trim();
    const ok = (rows: any[]) => ({ rows, rowCount: rows.length });
    let m: RegExpMatchArray | null;
    if ((m = q.match(/^INSERT INTO docs\(kind,id,data\) VALUES\('(\w+)',\$1,\$2\) ON CONFLICT DO NOTHING/))) {
      if (this.docs.has(this.k(m[1], p[0]))) return ok([]);
      this.docs.set(this.k(m[1], p[0]), JSON.parse(p[1]));
      return ok([{ id: p[0] }]);
    }
    if ((m = q.match(/^DELETE FROM docs WHERE kind='(\w+)' AND id=\$1/))) {
      this.docs.delete(this.k(m[1], p[0]));
      return ok([]);
    }
    if (q.startsWith("DELETE FROM docs WHERE kind='roster_request'")) {
      for (const [key, v] of this.docs) if (key.startsWith('roster_request\u0000') && v.league_id === p[0]) this.docs.delete(key);
      return ok([]);
    }
    if (q.startsWith('UPDATE inventory SET stock = stock - $2, reserved = reserved + $2')) {
      const inv = this.inventory.get(p[0]);
      if (!inv || inv.stock < p[1]) return ok([]);
      inv.stock -= p[1];
      inv.reserved += p[1];
      return ok([{ stock: inv.stock }]);
    }
    if (q.startsWith('UPDATE inventory SET stock = stock + $2, reserved = reserved - $2')) {
      const inv = this.inventory.get(p[0])!;
      inv.stock += p[1];
      inv.reserved -= p[1];
      return ok([]);
    }
    if (q.startsWith('UPDATE inventory SET reserved = reserved - $2')) {
      this.inventory.get(p[0])!.reserved -= p[1];
      return ok([]);
    }
    if (q.startsWith('SELECT stock, reserved FROM inventory')) {
      const inv = this.inventory.get(p[0]);
      return ok(inv ? [{ ...inv }] : []);
    }
    if (q === 'SELECT count(*)::int AS n FROM roster_audit') return ok([{ n: this.audit.length }]);
    if (q === 'SELECT count(*)::int AS n FROM roster_audit WHERE player_id=$1') return ok([{ n: this.audit.filter((a) => a.player_id === p[0]).length }]);
    if (q.startsWith('INSERT INTO roster_audit')) {
      this.audit.push({ seq: this.audit.length + 1, audit_id: p[0], player_id: p[1], data: JSON.parse(p[2]) });
      return ok([]);
    }
    if (q.startsWith('DELETE FROM roster_audit WHERE player_id=$1')) {
      this.audit = this.audit.filter((a) => a.player_id !== p[0]);
      return ok([]);
    }
    if (q.startsWith('SELECT data FROM roster_audit WHERE player_id=$1')) return ok(this.audit.filter((a) => a.player_id === p[0]).map((a) => ({ data: a.data })));
    throw new Error('FakeDb: unsupported SQL ' + q);
  }
}
