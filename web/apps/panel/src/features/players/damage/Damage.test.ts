import { describe, expect, it } from 'vitest';
import type { DamageReachView } from '@isle/api';
import type { FeedEvent } from '../../../components/feed/describe';
import { damageMatch, suspectsOf } from './Damage';

type FarBite = DamageReachView['far'][number];
const A = '76561198000000011';
const B = '76561198000000012';
const far = (id: number, attacker: string, distM: number, limitM: number, t = 1000 + id): FarBite => ({
  id, t, type: 'damage', attacker, victim: B, amount: 50, ticks: 1, attackerName: attacker === A ? 'Rex' : undefined,
  attackerSpecies: 'BP_Tyrannosaurus_C', reach: { distM, limitM, basis: 'learned', far: true },
});

describe('suspectsOf', () => {
  it('groups the far bites by attacker: count, farthest, times its limit, last; AI left out', () => {
    const out = suspectsOf([far(1, A, 20, 10), far(2, A, 30, 10), far(3, B, 15, 10), far(4, 'ai', 50, 10)]);
    expect(out.map((p) => p.steamId)).toEqual([A, B]);
    expect(out[0]).toMatchObject({ count: 2, maxM: 30, maxTimes: 3, last: 1002, name: 'Rex' });
  });
});

describe('damageMatch', () => {
  const ev = (farBite: boolean): FeedEvent => ({ id: 1, t: 1, type: 'damage', attacker: A, attackerName: 'Rex Tester', victim: B, victimName: 'Carno',
    attackerSpecies: 'BP_Tyrannosaurus_C', victimSpecies: 'BP_Carnotaurus_C', reach: { distM: 9, limitM: 8, basis: 'learned', far: farBite } });
  it('"Chỉ đòn xa" keeps only far bites', () => {
    expect(damageMatch(ev(true), '', 'far')).toBe(true);
    expect(damageMatch(ev(false), '', 'far')).toBe(false);
    expect(damageMatch({ ...ev(false), reach: undefined }, '', 'far')).toBe(false);
  });
  it('searches names, SteamIDs and species', () => {
    expect(damageMatch(ev(false), 'carnotaurus', 'all')).toBe(true);
    expect(damageMatch(ev(false), '0000011', 'all')).toBe(true);
    expect(damageMatch(ev(false), 'stego', 'all')).toBe(false);
  });
});
