// FR-5.1: policy-as-code. One pure function decides every probe; the matrix tests cover each cell.
export type Role = 'super_admin' | 'league_organizer' | 'club_manager' | 'player' | 'viewer';

export interface Principal {
  sub: string;
  role: Role;
  tenant_id: string | null;
  league_ids: string[];
  club_id: string | null;
  player_id: string | null;
}

export type Action =
  | 'tenants.create'
  | 'league.fixtures.write'
  | 'club.roster.write'
  | 'club.products.write'
  | 'player.update'
  | 'club.read'
  | 'platform.config.read';

export interface Target {
  tenant_id?: string | null;
  league_id?: string;
  club_id?: string;
  player_id?: string;
}

export function can(p: Principal, action: Action, t: Target = {}): boolean {
  if (p.role === 'super_admin') return true;
  // Tenant isolation is absolute for everyone else.
  if (t.tenant_id !== undefined && t.tenant_id !== p.tenant_id) return false;
  switch (action) {
    case 'tenants.create':
    case 'platform.config.read':
      return false;
    case 'league.fixtures.write':
      return p.role === 'league_organizer' && !!t.league_id && p.league_ids.includes(t.league_id);
    case 'club.roster.write':
    case 'club.products.write':
      return p.role === 'club_manager' && !!t.club_id && t.club_id === p.club_id;
    case 'player.update':
      if (p.role === 'club_manager') return !!t.club_id && t.club_id === p.club_id;
      if (p.role === 'player') return !!t.player_id && t.player_id === p.player_id;
      return false;
    case 'club.read':
      return true; // any role inside the same tenant (checked above)
  }
}
