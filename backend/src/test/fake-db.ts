// In-memory stand-in for Db used by unit tests of the store and roster services.
// It understands exactly the SQL those services issue.
export class FakeDb {
  docs = new Map<string, any>();
  inventory = new Map<string, { stock: number; reserved: number }>();
  audit: { seq: number; audit_id: string; player_id: string; data: any }[] = [];
  dlq: any[] = [];
  chat: any[] = [];
  telemetry = new Map<string, number>();
  prices: { seq: number; variant_id: string; price_minor: number; effective_at: string; created_by: string }[] = [];
  restocks: any[] = [];
  followRows: { follower_id: string; athlete_id: string }[] = [];
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
    const snapshot = { docs: new Map([...this.docs].map(([k, v]) => [k, structuredClone(v)])), inventory: new Map([...this.inventory].map(([k, v]) => [k, { ...v }])), audit: [...this.audit], dlq: [...this.dlq] };
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
    if ((m = q.match(/^INSERT INTO docs\(kind,id,data\) VALUES\('(\w+)',\$1,'(\{\})'\) ON CONFLICT DO NOTHING/))) {
      if (!this.docs.has(this.k(m[1], p[0]))) this.docs.set(this.k(m[1], p[0]), {});
      return ok([]);
    }
    if (q.startsWith("SELECT 1 FROM docs WHERE kind='user'"))
      return ok([...this.docs].filter(([k, v]) => k.startsWith('user\u0000') && (v.user_id === p[0] || v.player_id === p[0])).map(() => ({ '?column?': 1 })));
    if (q.startsWith('SELECT price_minor FROM variant_prices')) {
      const rows = this.prices.filter((x) => x.variant_id === p[0] && Date.parse(x.effective_at) <= Date.now())
        .sort((a, b) => Date.parse(b.effective_at) - Date.parse(a.effective_at) || b.seq - a.seq);
      return ok(rows.slice(0, 1).map((x) => ({ price_minor: x.price_minor })));
    }
    if (q.startsWith('INSERT INTO variant_prices')) {
      this.prices.push({ seq: this.prices.length + 1, variant_id: p[0], price_minor: p[1], effective_at: p[2], created_by: p[3] });
      return ok([]);
    }
    if (q.startsWith('SELECT price_minor, effective_at, created_by FROM variant_prices'))
      return ok(this.prices.filter((x) => x.variant_id === p[0]).sort((a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at) || a.seq - b.seq));
    if (q.startsWith('SELECT variant_id, delta, reason, actor, created_at FROM inventory_audit')) return ok(this.restocks.filter((x) => x.variant_id === p[0]));
    if (q.startsWith('SELECT count(*)::int AS n FROM follows WHERE athlete_id=$1')) return ok([{ n: this.followRows.filter((f) => f.athlete_id === p[0]).length }]);
    if (q === 'SELECT stock FROM inventory WHERE variant_id=$1') {
      const inv = this.inventory.get(p[0]);
      return ok(inv ? [{ stock: inv.stock }] : []);
    }
    if (q.startsWith("SELECT count(*)::int AS n FROM docs WHERE kind='stream_key'"))
      return ok([{ n: [...this.docs].filter(([k, v]) => k.startsWith('stream_key\u0000') && v.status === 'active').length }]);
    if (q.startsWith('INSERT INTO dlq')) {
      this.dlq.push(JSON.parse(p[1]));
      return ok([]);
    }
    if (q === 'SELECT data FROM dlq ORDER BY seq') return ok(this.dlq.map((data) => ({ data })));
    if (q === 'SELECT count(*)::int AS n FROM dlq') return ok([{ n: this.dlq.length }]);
    if (q.startsWith('INSERT INTO chat_messages')) {
      const row = { seq: this.chat.length + 1, room: p[0], sender: p[1], text: p[2], flagged: p[3], reason: p[4], created_at: new Date().toISOString() };
      this.chat.push(row);
      return ok([{ seq: row.seq, created_at: row.created_at }]);
    }
    if (q.startsWith('SELECT seq, sender, text, flagged, reason, created_at FROM chat_messages'))
      return ok(this.chat.filter((c) => c.room === p[0]).slice(-50).reverse());
    if (q.startsWith("UPDATE docs SET data = jsonb_set(data, '{scan_count}'")) {
      const d = this.docs.get(this.k('qr', p[0]));
      if (!d) return ok([]);
      d.scan_count = (d.scan_count ?? 0) + 1;
      return ok([{ n: d.scan_count }]);
    }
    if (q.startsWith('INSERT INTO qr_telemetry')) {
      const key = p.join('|');
      this.telemetry.set(key, (this.telemetry.get(key) ?? 0) + 1);
      return ok([]);
    }
    if (q.startsWith("SELECT COALESCE(sum((data->>'scan_count')::int),0)::int AS n FROM docs WHERE kind='qr'"))
      return ok([{ n: [...this.docs].filter(([k]) => k.startsWith('qr\u0000')).reduce((s, [, v]) => s + (v.scan_count ?? 0), 0) }]);
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
