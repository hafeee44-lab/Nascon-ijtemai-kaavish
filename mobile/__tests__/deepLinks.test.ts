import { parseAppDeepLink } from '../src/deepLinks';

test.each([
  ['nascon://entity/match-m1', { name: 'match-live', id: 'match-m1' }],
  ['nascon://stream/cs-session-101', { name: 'costream', id: 'cs-session-101' }],
  ['nascon://entity/player-alpha-1', { name: 'player', id: 'player-alpha-1' }],
  ['https://nascon.test/q/m1-live', { name: 'qr', code: 'm1-live' }],
  ['http://nascon.test/web/costream/cs-session-101', { name: 'costream', id: 'cs-session-101' }],
])('routes %s', (url, expected) => {
  expect(parseAppDeepLink(url)).toEqual(expected);
});

test.each(['not-a-url', 'nascon://entity/unknown-1', 'nascon://entity/%E0%A4%A', 'ftp://nascon.test/q/m1-live', 'nascon://stream/match-m1'])
  ('ignores unsupported or malformed links: %s', (url) => {
    expect(parseAppDeepLink(url)).toBeNull();
  });