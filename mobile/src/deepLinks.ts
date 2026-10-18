export type DeepLinkRoute =
  | { name: 'match-live'; id: string }
  | { name: 'costream'; id: string }
  | { name: 'player'; id: string }
  | { name: 'club'; id: string }
  | { name: 'qr'; code: string };

const validId = (value: string) => /^[a-z0-9][a-z0-9_-]*$/i.test(value);

export function parseAppDeepLink(value: string): DeepLinkRoute | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/i.exec(value.trim());
  if (!match) return null;
  const protocol = `${match[1].toLowerCase()}:`;
  const host = match[2].split(':', 1)[0].toLowerCase();
  let parts: string[];
  try {
    parts = match[3].split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }

  if (protocol === 'nascon:') {
    const id = parts[0];
    if (!id || !validId(id)) return null;
    if (host === 'entity') {
      if (id.startsWith('match-')) return { name: 'match-live', id };
      if (id.startsWith('player-')) return { name: 'player', id };
      if (id.startsWith('club-')) return { name: 'club', id };
    }
    if (host === 'stream' && id.startsWith('cs-session-')) return { name: 'costream', id };
    return null;
  }

  if (protocol !== 'http:' && protocol !== 'https:') return null;
  if (parts[0] === 'q' && parts[1] && validId(parts[1])) return { name: 'qr', code: parts[1] };
  if (parts[0] === 'web' && parts[1] === 'matches' && parts[2] && validId(parts[2]))
    return { name: 'match-live', id: parts[2] };
  if (parts[0] === 'web' && parts[1] === 'costream' && parts[2]?.startsWith('cs-session-') && validId(parts[2]))
    return { name: 'costream', id: parts[2] };
  if (parts[0] === 'web' && parts[1] === 'players' && parts[2]?.startsWith('player-') && validId(parts[2]))
    return { name: 'player', id: parts[2] };
  if (parts[0] === 'web' && parts[1] === 'clubs' && parts[2]?.startsWith('club-') && validId(parts[2]))
    return { name: 'club', id: parts[2] };
  return null;
}