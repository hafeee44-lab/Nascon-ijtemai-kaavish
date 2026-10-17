import { canonical, lotsKey, sign } from './canonical.js';

describe('canonical + signatures (spec Appendix A)', () => {
  it('matches test vector 1', () => {
    const payload = { team_id: 't1', event_type: 'goal' };
    expect(canonical(payload)).toBe('{"event_type":"goal","team_id":"t1"}');
    expect(sign('evt-1', payload, 'demo-salt')).toBe(
      '972a8b558690b19121cc5bea84978f85e8eb15a3735018db36616bab1d7ec501',
    );
  });

  it('matches test vector 2 (drawing of lots)', () => {
    expect(lotsKey(42, 'lg-1', 't1')).toBe('0613316991ce0ac31e88d6003e3ff4d5e21bb072ac5f81b42c0cdc6598453293');
    expect(lotsKey(42, 'lg-1', 't2')).toBe('e3e3a14e22727f936e1f288cf5d02a8a9362b1da13c5432725fc10b2c7955dd9');
    expect(lotsKey(42, 'lg-1', 't3')).toBe('c8f28e3c2f1eb6c4f636b4f57050e3362a2b39c07fda9b61742a26dd20397028');
  });

  it('sorts nested keys, keeps array order and non-ASCII', () => {
    expect(canonical({ b: [3, { z: 1, a: 'ü' }], a: null, c: true })).toBe('{"a":null,"b":[3,{"a":"ü","z":1}],"c":true}');
  });
});
