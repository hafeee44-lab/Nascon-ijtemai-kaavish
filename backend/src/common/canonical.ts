import { createHash, createHmac } from 'node:crypto';

// Spec 5.3: recursively sorted keys (by code point), no whitespace, non-ASCII unescaped.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

export function salt(): string {
  return process.env.DAY1_SALT ?? '';
}

// signature = HMAC_SHA256(DAY1_SALT, id + "|" + canonical(payload)), lowercase hex.
export function sign(id: string, payload: unknown, key: string = salt()): string {
  return createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(Buffer.from(id + '|' + canonical(payload), 'utf8'))
    .digest('hex');
}

// Spec 5.10 draw_lots key: SHA256_hex(seed|league_id|team_id).
export function lotsKey(seed: number, leagueId: string, teamId: string): string {
  return createHash('sha256').update(`${seed}|${leagueId}|${teamId}`, 'utf8').digest('hex');
}
