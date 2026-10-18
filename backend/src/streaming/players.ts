import { Db } from '../db/db.service.js';

// A "player" for Day 2 purposes: a seeded scenario player, a roster player, or a user id.
export async function playerExists(db: Db, id: string): Promise<boolean> {
  if (typeof id !== 'string' || !id) return false;
  if (await db.get('scenario_player', id)) return true;
  if (await db.get('roster_player', id)) return true;
  const r = await db.query(`SELECT 1 FROM docs WHERE kind='user' AND (data->>'user_id'=$1 OR data->>'player_id'=$1) LIMIT 1`, [id]);
  return r.rowCount! > 0;
}
